/**
 * Cliente das rotas de acesso (M1-06). A sessão vive só no cookie HttpOnly: nada aqui lê nem
 * guarda token de sessão. O navegador envia o cabeçalho `Origin`, que o servidor confere.
 */
export type RequestLinkResult =
  | 'sent'
  | 'captcha_failed'
  | 'invalid_email'
  | 'email_limit'
  | 'unavailable';
export type ConfirmLinkResult = 'ok' | 'invalid_or_expired' | 'unavailable';
export type AcceptInvitationResult =
  | 'ok'
  | 'unauthenticated'
  | 'invalid_or_expired'
  | 'suspended'
  | 'unverified'
  | 'rate_limited'
  | 'unavailable';
export type PasswordSignInResult =
  | 'ok'
  | 'invalid_credentials'
  | 'captcha_failed'
  | 'rate_limited'
  | 'unavailable';
export type RequestReauthResult = 'sent' | 'unauthenticated' | 'rate_limited' | 'unavailable';
export type ConfirmReauthResult = ConfirmLinkResult | 'unauthenticated';

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
  if (response.status === 503) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === 'email_unavailable') return 'email_limit';
  }
  return 'unavailable';
}

export async function confirmReauth(token: string): Promise<ConfirmReauthResult> {
  const response = await postJson('/api/auth/reauth/confirm', { token });
  if (!response) return 'unavailable';
  if (response.ok) return 'ok';
  if (response.status === 401) return 'unauthenticated';
  if (response.status === 400) return 'invalid_or_expired';
  return 'unavailable';
}

export async function confirmLink(token: string): Promise<ConfirmLinkResult> {
  const response = await postJson('/api/auth/link/confirm', { token });
  if (!response) return 'unavailable';
  if (response.ok) return 'ok';
  if (response.status === 400) return 'invalid_or_expired';
  return 'unavailable';
}

/** Aceita o convite de Staff na sessão atual. O servidor compara o e-mail da sessão com o do convite. */
export async function acceptStaffInvitation(token: string): Promise<AcceptInvitationResult> {
  const response = await postJson('/api/staff/invitations/accept', { token });
  if (!response) return 'unavailable';
  if (response.ok) return 'ok';
  if (response.status === 401) return 'unauthenticated';
  if (response.status === 400) return 'invalid_or_expired';
  if (response.status === 429) return 'rate_limited';
  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    return body?.error?.code === 'email_not_verified' ? 'unverified' : 'suspended';
  }
  return 'unavailable';
}

/** Login por senha. Toda falha de credencial é a mesma (não diz se o e-mail existe nem se é de Staff). */
export async function signInWithPassword(
  email: string,
  password: string,
  captchaToken: string,
): Promise<PasswordSignInResult> {
  const response = await postJson('/api/auth/password/sign-in', { email, password, captchaToken });
  if (!response) return 'unavailable';
  if (response.ok) return 'ok';
  if (response.status === 401) return 'invalid_credentials';
  if (response.status === 403) return 'captcha_failed';
  if (response.status === 429) return 'rate_limited';
  return 'unavailable';
}

/** O Google está configurado neste ambiente? Falha de rede = não mostra o botão. */
export async function fetchAuthOptions(): Promise<{ google: boolean }> {
  try {
    const response = await fetch('/api/auth/options', { credentials: 'same-origin' });
    if (!response.ok) return { google: false };
    const body = (await response.json()) as { google?: boolean };
    return { google: body.google === true };
  } catch {
    return { google: false };
  }
}

/** Pede o endereço do Google para entrar. O navegador então vai até ele. */
export async function startGoogleSignIn(): Promise<string | null> {
  const response = await postJson('/api/auth/google/start', {});
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { url?: string } | null;
  return body?.url ?? null;
}

/** Pede o link de reautenticação para o e-mail da própria sessão (o corpo é vazio de propósito). */
export async function requestReauth(): Promise<RequestReauthResult> {
  const response = await postJson('/api/auth/reauth/request', {});
  if (!response) return 'unavailable';
  if (response.ok) return 'sent';
  if (response.status === 401) return 'unauthenticated';
  if (response.status === 429) return 'rate_limited';
  return 'unavailable';
}

/**
 * Encerra a sessão deste aparelho (`POST /api/auth/sign-out`, a única rota nativa do Better Auth
 * exposta). Devolve `true` quando o servidor confirmou; o cookie some na resposta.
 */
export async function signOut(): Promise<boolean> {
  const response = await postJson('/api/auth/sign-out', {});
  return response?.ok ?? false;
}
