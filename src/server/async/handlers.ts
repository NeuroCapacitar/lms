import {
  createCertificateRenderHandler,
  type CertificateHandlerDeps,
} from '../certificate/certificate-store';
import type { PaymentReader } from '../commerce/payment-reader';
import { createRefundHandler } from '../commerce/refund-store';
import type { RefundProvider } from '../commerce/refund-provider';
import { createEmailHandler, type EmailHandlerDeps } from '../email/send-handler';
import { createInterestFanoutHandler } from '../interest/fanout';
import { PermanentError, type HandlerRegistry } from './handler-types';

export {
  DeferError,
  PermanentError,
  TransientError,
  type HandlerContext,
  type HandlerRegistry,
} from './handler-types';

/** O que os handlers de produção precisam do ambiente (montado em `queue-entry.ts`). */
export interface HandlerDeps {
  email: EmailHandlerDeps;
  /** Reembolso (M6-05). Sem o Asaas configurado a intenção falha de forma PERMANENTE (a Staff refaz o pedido depois). */
  finance?: { provider: RefundProvider; reader: PaymentReader } | undefined;
  /** Renderer do certificado (M7-02). Sem ele o certificado vai a `failed` com `renderer_not_configured` e pode ser repetido. */
  certificate?: CertificateHandlerDeps | undefined;
}

/**
 * Handlers de produção, um por `kind`. O `system.demo` não tem efeito externo (existe para provar o fluxo);
 * os demais entram com o seu marco (e-mail no M4-04, financeiro no M6, certificado no M7). Regras de todo
 * handler: efeitos externos NUNCA dentro de transação PG; idempotente (a entrega é at-least-once); relê o
 * estado do provider antes de repetir; lança `TransientError` ou `PermanentError`.
 */
export function createHandlers(deps: HandlerDeps): HandlerRegistry {
  return {
    'system.demo': async () => {},
    'email.send': createEmailHandler(deps.email),
    'interest.fanout': createInterestFanoutHandler(),
    'certificate.render': createCertificateRenderHandler(deps.certificate ?? {}),
    'finance.refund': deps.finance
      ? createRefundHandler(deps.finance)
      : async () => {
          throw new PermanentError('refund_not_configured');
        },
  };
}
