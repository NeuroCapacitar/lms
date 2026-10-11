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

export type ActionOutcome<T> = {
  result: ActionResult;
  data?: T;
  code?: string;
  /** Corpo da resposta de erro (o servidor lista `fields` inválidos, `currentRev`, `problems`...). */
  error?: { code?: string; fields?: string[]; currentRev?: number; problems?: unknown[] };
};

export const postAction = <T = Record<string, never>>(path: string, body: unknown) =>
  sendAction<T>('POST', path, body);

/** Como `postAction`, com o método escolhido (`PUT` do rascunho, `PATCH` de oferta e curso). */
export async function sendAction<T = Record<string, never>>(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  body: unknown,
): Promise<ActionOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    return { result: 'unavailable' };
  }
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: ActionOutcome<T>['error'] })
    | null;
  const error = data?.error;
  const code = error?.code;
  if (response.ok) return data ? { result: 'ok', data } : { result: 'ok' };
  const failure = (result: ActionResult): ActionOutcome<T> => ({
    result,
    ...(code ? { code } : {}),
    ...(error ? { error } : {}),
  });
  if (response.status === 401) return failure('unauthenticated');
  if (response.status === 400 || response.status === 422) return failure('invalid');
  if (response.status === 404) return failure('not_found');
  if (response.status === 409) return failure('conflict');
  if (response.status === 429) return failure('rate_limited');
  if (response.status === 403) {
    return failure(code === 'reauth_required' ? 'reauth_required' : 'forbidden');
  }
  return { result: 'unavailable' };
}
