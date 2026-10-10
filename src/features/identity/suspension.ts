import { z } from 'zod';

/** ID de usuário aceito na rota (Better Auth e bootstrap geram texto curto: letras, dígitos, `_` e `-`). */
export const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Corpo de `POST /api/staff/users/:id/suspend`: motivo curto e opcional (sem dado pessoal). */
export const suspendUserSchema = z.strictObject({
  reason: z.string().trim().min(1).max(200).optional(),
});
