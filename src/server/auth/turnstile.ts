export interface TurnstileInput {
  secret: string;
  token: string;
  ip?: string | undefined;
  fetchImpl?: typeof fetch;
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Confere o token do Turnstile. Falha de rede ou resposta estranha = não passou (fecha por padrão). */
export async function verifyTurnstile(input: TurnstileInput): Promise<boolean> {
  const form = new URLSearchParams({ secret: input.secret, response: input.token });
  if (input.ip) form.set('remoteip', input.ip);
  try {
    const response = await (input.fetchImpl ?? fetch)(SITEVERIFY, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
