export interface TurnstileInput {
  secret: string;
  token: string;
  ip?: string | undefined;
  fetchImpl?: typeof fetch;
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Só o MOTIVO (códigos de erro da Cloudflare): nunca o token, o segredo nem o IP. Serve para saber por que um pedido legítimo foi recusado. */
function logFailure(reason: string, codes?: unknown) {
  const errorCodes = Array.isArray(codes)
    ? codes.filter((c) => typeof c === 'string').slice(0, 5)
    : [];
  console.warn(JSON.stringify({ level: 'warn', source: 'turnstile', reason, errorCodes }));
}

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
    if (!response.ok) {
      logFailure(`http_${response.status}`);
      return false;
    }
    const result = (await response.json()) as { success?: boolean; 'error-codes'?: unknown };
    if (result.success === true) return true;
    logFailure('rejected', result['error-codes']);
    return false;
  } catch {
    logFailure('network_or_timeout');
    return false;
  }
}
