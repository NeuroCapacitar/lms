/**
 * Cliente das rotas de acesso (M1-06). A sessão vive só no cookie HttpOnly: nada aqui lê nem
 * guarda token de sessão. O navegador envia o cabeçalho `Origin`, que o servidor confere.
 */
export type RequestLinkResult = 'sent' | 'captcha_failed' | 'invalid_email' | 'unavailable';
export type ConfirmLinkResult = 'ok' | 'invalid_or_expired' | 'unavailable';

async function postJson(path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

/** O servidor responde igual para qualquer e-mail válido: "sent" não diz se o e-mail existe. */
export async function requestLink(email: string, captchaToken: string): Promise<RequestLinkResult> {
  const response = await postJson('/api/auth/link/request', { email, captchaToken });
  if (!response) return 'unavailable';
  if (response.ok) return 'sent';
  if (response.status === 403) return 'captcha_failed';
  if (response.status === 400) return 'invalid_email';
  return 'unavailable';
}

export async function confirmLink(token: string): Promise<ConfirmLinkResult> {
  const response = await postJson('/api/auth/link/confirm', { token });
  if (!response) return 'unavailable';
  if (response.ok) return 'ok';
  if (response.status === 400) return 'invalid_or_expired';
  return 'unavailable';
}
