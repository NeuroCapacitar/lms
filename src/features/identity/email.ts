import { z } from 'zod';

/** Normaliza o e-mail para comparação e armazenamento: sem espaços e em minúsculas. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Corpo de `POST /api/auth/link/request`. O Turnstile entra como `captchaToken`. */
export const linkRequestSchema = z.object({
  email: z.string().max(254).transform(normalizeEmail).pipe(z.email()),
  captchaToken: z.string().min(1).max(2048),
});

/** Corpo de `POST /api/auth/reauth/request`: vazio. O e-mail vem da sessão, nunca do corpo. */
export const reauthRequestSchema = z.strictObject({});

/** Corpo de `POST /api/auth/link/confirm`: o token do link, em texto, vindo do fragmento da URL. */
export const linkConfirmSchema = z.object({
  token: z.string().min(16).max(256),
});
