import { z } from 'zod';

import { DELEGABLE_CAPABILITIES } from './capabilities';
import { normalizeEmail } from './email';

/** Validade do convite de Staff (proposta: 7 dias; confirmar com o responsável). */
export const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Convite como a tela de equipe o recebe (nunca traz o token). */
export interface InvitationDto {
  id: string;
  email: string;
  status: InvitationStatus;
  grants: string[];
  expiresAt: string;
  createdAt: string;
}

/** Estado exibido: `expired` é calculado (pendente com `expires_at` no passado). */
export type InvitationStatus = 'pending' | 'expired' | 'accepted' | 'revoked';

/**
 * Corpo de `POST /api/staff/invitations`. Só o papel de Suporte é convidável (o Admin nasce do
 * bootstrap) e os grants iniciais são só delegáveis: capability exclusiva do Admin é recusada aqui,
 * no repositório e pelo CHECK do banco.
 */
export const inviteStaffSchema = z.strictObject({
  email: z.string().max(254).transform(normalizeEmail).pipe(z.email()),
  grants: z
    .array(z.enum(DELEGABLE_CAPABILITIES))
    .max(DELEGABLE_CAPABILITIES.length)
    .default([])
    .transform((grants) => [...new Set(grants)]),
});

/** Corpo de `POST /api/staff/invitations/accept`: o token, vindo do fragmento da URL do e-mail. */
export const acceptInvitationSchema = z.strictObject({
  token: z.string().min(16).max(256),
});
