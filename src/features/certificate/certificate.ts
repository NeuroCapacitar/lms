import { z } from 'zod';

/**
 * Domínio do certificado (M7-01), parte PURA: estados, código opaco e o snapshot congelado. Sem SQL, Hono nem SDK.
 * O certificado nasce de uma `CourseCompletion` e é EVIDÊNCIA: depois de congelado o snapshot não muda; mudar o nome
 * ou o layout é reemissão (certificado novo, M7-04), nunca edição.
 */
export const CERTIFICATE_STATUSES = [
  'awaiting_name',
  'queued',
  'rendering',
  'ready',
  'failed',
  'revoked',
  'superseded',
] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

/**
 * Transições permitidas. `ready` só sai para `revoked` (Admin) ou `superseded` (reemissão); `failed` volta a `queued`
 * por nova tentativa explícita; `rendering` volta a `queued` quando o erro é transitório.
 */
const CERTIFICATE_TRANSITIONS: Record<CertificateStatus, readonly CertificateStatus[]> = {
  awaiting_name: ['queued'],
  queued: ['rendering'],
  rendering: ['ready', 'failed', 'queued'],
  ready: ['revoked', 'superseded'],
  failed: ['queued'],
  revoked: [],
  superseded: [],
};

export function canTransitionCertificate(from: CertificateStatus, to: CertificateStatus): boolean {
  return CERTIFICATE_TRANSITIONS[from].includes(to);
}

/** Código opaco: 16 bytes CSPRNG em Base64URL (22 caracteres), sem prefixo e nunca reaproveitado. */
export const CERTIFICATE_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function generateCertificateCode(
  fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = fill(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

const MAX_TEXT = 200;

/**
 * O que o PDF vai dizer, congelado quando o certificado passa a `queued`. Versão 1: nome do titular, título do
 * curso, carga horária, datas, emitente e signatário (M7-06). O layout entra com o M7-03; um
 * certificado emitido mantém SEMPRE o snapshot com que nasceu.
 */
export const certificateSnapshotSchema = z.strictObject({
  version: z.literal(1),
  holderName: z.string().trim().min(1).max(MAX_TEXT),
  courseTitle: z.string().trim().min(1).max(MAX_TEXT),
  workloadHours: z.number().int().positive().nullable(),
  completedAt: z.iso.datetime(),
  requiredTotal: z.number().int().positive(),
  /** Emitente no momento da emissão (M7-06); `null` = ainda não cadastrado (o renderer do M7-02 recusa). */
  issuer: z
    .strictObject({
      legalName: z.string().min(1).max(MAX_TEXT),
      cnpj: z.string().regex(/^[0-9]{14}$/),
    })
    .nullable(),
  /** Signatário do CURSO no momento da emissão; a assinatura é só o id da mídia privada. */
  signatory: z
    .strictObject({
      name: z.string().min(1).max(MAX_TEXT),
      title: z.string().min(1).max(MAX_TEXT),
      signatureMediaId: z.uuid().nullable(),
    })
    .nullable(),
});
export type CertificateSnapshot = z.infer<typeof certificateSnapshotSchema>;

export class SnapshotInvalidError extends Error {
  constructor() {
    super('certificate_snapshot_invalid');
  }
}

/** Monta e valida o snapshot. O nome do certificado é o confirmado pela pessoa; sem ele, o nome de exibição. */
export function buildCertificateSnapshot(input: {
  certificateName: string | null;
  displayName: string;
  courseTitle: string;
  workloadHours: number | null;
  completedAt: Date;
  requiredTotal: number;
  issuer?: CertificateSnapshot['issuer'];
  signatory?: CertificateSnapshot['signatory'];
}): CertificateSnapshot {
  const holder = input.certificateName?.trim() ? input.certificateName : input.displayName;
  const parsed = certificateSnapshotSchema.safeParse({
    version: 1,
    holderName: holder.normalize('NFC'),
    courseTitle: input.courseTitle.normalize('NFC'),
    workloadHours: input.workloadHours,
    completedAt: input.completedAt.toISOString(),
    requiredTotal: input.requiredTotal,
    issuer: input.issuer ?? null,
    signatory: input.signatory ?? null,
  });
  if (!parsed.success) throw new SnapshotInvalidError();
  return parsed.data;
}
