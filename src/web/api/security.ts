import { UnauthenticatedError } from './profile';

/** Cliente de "Segurança da conta" (M1-07). A sessão vive só no cookie HttpOnly. */
export interface SecurityDto {
  methods: { password: boolean; google: boolean };
  googleAvailable: boolean;
  /** Staff só entra por link de acesso: não tem senha nem Google. */
  canManageMethods: boolean;
}

/** Resultado de uma mudança de método: `reauth_required` pede o link de confirmação de identidade. */
export type ChangeResult =
  | 'ok'
  | 'reauth_required'
  | 'unauthenticated'
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'unavailable';

export async function fetchSecurity(): Promise<SecurityDto> {
  const response = await fetch('/api/me/security', { credentials: 'same-origin' });
  if (response.status === 401) throw new UnauthenticatedError();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as SecurityDto;
}

async function change(
  path: string,
  body: unknown,
): Promise<{ result: ChangeResult; url?: string }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    return { result: 'unavailable' };
  }
  if (response.ok) {
    const data = (await response.json().catch(() => null)) as { url?: string } | null;
    return data?.url ? { result: 'ok', url: data.url } : { result: 'ok' };
  }
  if (response.status === 401) return { result: 'unauthenticated' };
  if (response.status === 400) return { result: 'invalid' };
  if (response.status === 404) return { result: 'not_found' };
  if (response.status === 403) {
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { result: data?.error?.code === 'reauth_required' ? 'reauth_required' : 'forbidden' };
  }
  return { result: 'unavailable' };
}

export const setPassword = async (password: string) =>
  (await change('/api/me/security/password', { password })).result;
export const removePassword = async () =>
  (await change('/api/me/security/password/remove', {})).result;
export const unlinkGoogle = async () => (await change('/api/me/security/google/unlink', {})).result;

/** Devolve o endereço do Google para ligar a conta (o navegador vai até ele). */
export const linkGoogle = () => change('/api/me/security/google/link', {});
