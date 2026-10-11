/**
 * POST de uma ação de interface. Mapeia o HTTP para um resultado que a tela entende; o servidor
 * continua sendo quem decide tudo (isto nunca autoriza nada). `reauth_required` pede o link de
 * confirmação de identidade (M1-05).
 */
export type ActionResult =
  | 'ok'
  | 'reauth_required'
  | 'unauthenticated'
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable';

export async function postAction<T = Record<string, never>>(
  path: string,
  body: unknown,
): Promise<{ result: ActionResult; data?: T; code?: string }> {
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
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: string } })
    | null;
  const code = data?.error?.code;
  if (response.ok) return data ? { result: 'ok', data } : { result: 'ok' };
  if (response.status === 401) return { result: 'unauthenticated', ...(code ? { code } : {}) };
  if (response.status === 400) return { result: 'invalid', ...(code ? { code } : {}) };
  if (response.status === 404) return { result: 'not_found', ...(code ? { code } : {}) };
  if (response.status === 409) return { result: 'conflict', ...(code ? { code } : {}) };
  if (response.status === 429) return { result: 'rate_limited', ...(code ? { code } : {}) };
  if (response.status === 403) {
    return {
      result: code === 'reauth_required' ? 'reauth_required' : 'forbidden',
      ...(code ? { code } : {}),
    };
  }
  return { result: 'unavailable' };
}
