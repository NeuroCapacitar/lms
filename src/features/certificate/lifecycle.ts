import { z } from 'zod';

import type { CertificateStatus } from './certificate';
import { hasUnsafeCharacters } from './issuer';

/**
 * Ciclo de vida do certificado (M7-04), contratos puros: revogar (só Admin, com categoria padronizada e nota interna),
 * reemitir (grant, com motivo) e os DTOs do aluno e da Staff. A nota de revogação e o motivo são INTERNOS: nunca vão
 * ao aluno nem à página pública.
 */
export const REVOCATION_CATEGORIES = [
  'wrong_data',
  'issued_in_error',
  'fraud_suspected',
  'other',
] as const;
export type RevocationCategory = (typeof REVOCATION_CATEGORIES)[number];

export const REVOCATION_LABELS: Record<RevocationCategory, string> = {
  wrong_data: 'Dado incorreto no certificado',
  issued_in_error: 'Emitido por engano',
  fraud_suspected: 'Suspeita de fraude',
  other: 'Outro motivo',
};

const note = z
  .string()
  .transform((value) => value.normalize('NFC').trim().replaceAll(/\s+/g, ' '))
  .pipe(z.string().min(5).max(500))
  .refine((value) => !hasUnsafeCharacters(value));

export const revokeInputSchema = z.strictObject({
  category: z.enum(REVOCATION_CATEGORIES),
  note,
});

export const reissueInputSchema = z.strictObject({ reason: note });

/** O que a PESSOA vê dos próprios certificados: nada de nota interna, motivo ou caminho do arquivo. */
export interface MyCertificateDto {
  id: string;
  courseTitle: string;
  status: CertificateStatus;
  code: string;
  readyAt: string | null;
  /** Só `ready` baixa. */
  canDownload: boolean;
}

/** O que a Staff vê de cada certificado. */
export interface StaffCertificateDto {
  id: string;
  courseId: string;
  courseTitle: string;
  holderName: string;
  holderEmail: string;
  status: CertificateStatus;
  code: string;
  failureCode: string | null;
  readyAt: string | null;
  revokedAt: string | null;
  revocationCategory: RevocationCategory | null;
  predecessorId: string | null;
  createdAt: string;
  /** Pedido reembolsado deste curso (o reembolso NÃO revoga o certificado; a Staff decide). */
  refundedAt: string | null;
  /** Já foi substituído por outro certificado (só o mais recente é reemitível). */
  hasSuccessor: boolean;
}
