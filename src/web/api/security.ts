import { postAction, type ActionResult } from './action';
import { UnauthenticatedError } from './profile';

/** Cliente de "Segurança da conta" (M1-07). A sessão vive só no cookie HttpOnly. */
export interface SecurityDto {
  methods: { password: boolean; google: boolean };
  googleAvailable: boolean;
  /** Staff só entra por link de acesso: não tem senha nem Google. */
  canManageMethods: boolean;
}

/** Resultado de uma mudança de método: `reauth_required` pede o link de confirmação de identidade. */
export type ChangeResult = ActionResult;

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
  const { result, data } = await postAction<{ url?: string }>(path, body);
  return data?.url ? { result, url: data.url } : { result };
}

export const setPassword = async (password: string) =>
  (await change('/api/me/security/password', { password })).result;
export const removePassword = async () =>
  (await change('/api/me/security/password/remove', {})).result;
export const unlinkGoogle = async () => (await change('/api/me/security/google/unlink', {})).result;

/** Devolve o endereço do Google para ligar a conta (o navegador vai até ele). */
export const linkGoogle = () => change('/api/me/security/google/link', {});
