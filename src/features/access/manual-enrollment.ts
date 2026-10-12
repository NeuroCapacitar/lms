import { z } from 'zod';

import { normalizeEmail } from '../identity/email';

/**
 * Matrícula manual pela Staff (M3-06): corpos e DTOs. Puro. O servidor valida de novo cada campo e
 * decide a capability; a interface só mostra e envia. A pessoa já tem de estar cadastrada (a matrícula
 * não cria usuário): ela é achada pelo e-mail.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const months = z.number().int().min(1).max(600);
const reason = z.string().trim().min(3).max(500);
/** Chave de idempotência gerada pela tela: um envio repetido com a mesma chave não duplica o direito. */
const requestId = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);

/** `POST /api/staff/enrollments` (capability `access.grant`). */
export const manualGrantSchema = z.strictObject({
  email: z.string().max(254).transform(normalizeEmail).pipe(z.email()),
  courseId: z.string().regex(UUID),
  months,
  reason,
  requestId,
});

/** `POST /api/staff/courses/:courseId/enrollments/:userId/suspend` (capability `access.grant`). */
export const suspendEnrollmentSchema = z.strictObject({ reason });

/** `POST /api/staff/entitlements/:id/adjust` (capability `enrollment.support_edit`). */
export const adjustGrantSchema = z.strictObject({ months, reason, requestId });

/** Página da lista de inscritos: `page` a partir de 1, `pageSize` de 1 a 100. */
export const enrolleeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
});

export type EnrolleeStatus = 'active' | 'expired' | 'suspended' | 'inactive';

export interface EnrolleeDto {
  userId: string;
  name: string;
  email: string;
  status: EnrolleeStatus;
  /** A maior expiração dos direitos não revogados (ISO 8601). */
  expiresAt: string | null;
  anchorAt: string;
  suspendedReason: string | null;
  progress: { completed: number; total: number; percent: number };
  courseCompletedAt: string | null;
  /** O direito de matrícula manual mais recente e não revogado: o único que o Suporte pode ajustar. */
  manualGrant: { entitlementId: string; expiresAt: string } | null;
}

export interface EnrolleePageDto {
  items: EnrolleeDto[];
  total: number;
  page: number;
  pageSize: number;
}
