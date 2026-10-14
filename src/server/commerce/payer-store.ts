import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { payment } from '../../db/schema';
import {
  formatDocument,
  maskDocument,
  normalizeDocument,
} from '../../features/commerce/finance-view';
import type { ProviderPayment } from '../../features/commerce/payment-evidence';
import { auditEvent } from '../auth/access-store';
import {
  DecryptionError,
  SecretBoxConfigError,
  UnknownKeyVersionError,
  openSecret,
  parseKeyring,
  sealSecret,
} from '../security/secret-box';
import type { PaymentReader } from './payment-reader';

/**
 * Dados do pagador (M6-08). Depois da confirmação do pagamento lê o cliente no Asaas (`GET /v3/customers/{id}`) e guarda
 * o NOME e o CPF/CNPJ informado; o documento só é guardado CIFRADO (AES-GCM, chave versionada do Worker
 * `FINANCE_SECRETS_MASTER_KEY`, AAD amarrado ao pagamento) e aparece MASCARADO por padrão; revelar completo grava
 * auditoria (sem o número). A leitura é melhor esforço: falha aqui NUNCA afeta a concessão do acesso.
 */

const aadOf = (paymentId: string) => `payment-payer-document:${paymentId}`;

/** Cria o "depois da concessão" do caso de uso de evidência: lê o pagador uma vez por pagamento. */
export function createPayerEnricher(deps: {
  reader: PaymentReader;
  masterKey: string | undefined;
  now?: () => Date;
}): (db: Database, read: ProviderPayment) => Promise<void> {
  return async (db, read) => {
    if (!read.customerId) return;
    try {
      const [local] = await db
        .select({ id: payment.id, readAt: payment.payerInfoReadAt })
        .from(payment)
        .where(and(eq(payment.provider, 'asaas'), eq(payment.providerPaymentId, read.id)));
      if (!local || local.readAt !== null) return;

      const customer = await deps.reader.getCustomer(read.customerId);
      if (!customer) return;
      const name = customer.name ? customer.name.trim().slice(0, 200) : null;
      const digits = normalizeDocument(customer.document);
      const readAt = (deps.now ?? (() => new Date()))();

      if (digits && !deps.masterKey) {
        // Sem a chave NÃO se guarda o documento (nunca em claro): guarda o nome e tenta de novo quando houver chave.
        await db
          .update(payment)
          .set({ payerName: name })
          .where(and(eq(payment.id, local.id), isNull(payment.payerInfoReadAt)));
        return;
      }
      if (digits) {
        const sealed = await sealSecret(
          await parseKeyring(deps.masterKey),
          digits,
          aadOf(local.id),
        );
        await db
          .update(payment)
          .set({
            payerName: name,
            payerDocumentCiphertext: sealed.ciphertext,
            payerDocumentNonce: sealed.nonce,
            payerDocumentKeyVersion: sealed.keyVersion,
            payerDocumentMasked: maskDocument(digits),
            payerInfoReadAt: readAt,
          })
          .where(and(eq(payment.id, local.id), isNull(payment.payerInfoReadAt)));
        return;
      }
      // O Asaas não devolveu documento ("não informado"): guarda o nome e marca como lido.
      await db
        .update(payment)
        .set({ payerName: name, payerInfoReadAt: readAt })
        .where(and(eq(payment.id, local.id), isNull(payment.payerInfoReadAt)));
    } catch {
      // melhor esforço: o acesso já foi decidido e a leitura se repete no próximo evento
    }
  };
}

export class NoDocumentError extends Error {
  constructor() {
    super('no_document');
  }
}
export class DocumentVaultUnavailableError extends Error {
  constructor() {
    super('document_vault_unavailable');
  }
}

/**
 * Revela o CPF/CNPJ completo. A AUDITORIA é gravada ANTES de devolver (sem ela, nada sai); o log e a auditoria guardam
 * só quem, quando e qual pagamento, NUNCA o número.
 */
export async function revealPayerDocument(
  db: Database,
  input: { paymentId: string; actorId: string; masterKey: string | undefined },
): Promise<string> {
  const [row] = await db.select().from(payment).where(eq(payment.id, input.paymentId));
  if (
    !row ||
    row.payerDocumentCiphertext === null ||
    row.payerDocumentNonce === null ||
    row.payerDocumentKeyVersion === null
  ) {
    throw new NoDocumentError();
  }
  let digits: string;
  try {
    digits = await openSecret(
      await parseKeyring(input.masterKey),
      {
        ciphertext: row.payerDocumentCiphertext,
        nonce: row.payerDocumentNonce,
        keyVersion: row.payerDocumentKeyVersion,
      },
      aadOf(row.id),
    );
  } catch (error) {
    if (
      error instanceof SecretBoxConfigError ||
      error instanceof UnknownKeyVersionError ||
      error instanceof DecryptionError
    ) {
      throw new DocumentVaultUnavailableError();
    }
    throw error;
  }
  await db.transaction((tx) =>
    auditEvent(tx, {
      actorId: input.actorId,
      action: 'finance.document.reveal',
      targetType: 'payment',
      targetId: row.id,
      details: { orderId: row.orderId },
    }),
  );
  return formatDocument(digits);
}
