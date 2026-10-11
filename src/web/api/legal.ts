import type { LegalStatusDto } from '../../features/identity/legal';

/** Cliente do aceite dos Termos e da Política (M1-09). A sessão vive só no cookie HttpOnly. */
export type AcceptLegalResult = 'ok' | 'changed' | 'unauthenticated' | 'unavailable';

/** Estado do aceite da pessoa logada; `null` quando não há sessão (nada a aceitar ainda). */
export async function fetchLegal(): Promise<LegalStatusDto | null> {
  const response = await fetch('/api/me/legal', { credentials: 'same-origin' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as LegalStatusDto;
}

/** Envia os IDs das versões que a pessoa viu e a declaração de 18+. `changed`: saiu versão nova. */
export async function acceptLegal(documentVersionIds: string[]): Promise<AcceptLegalResult> {
  let response: Response;
  try {
    response = await fetch('/api/me/legal/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ adultDeclaration: true, documentVersionIds }),
    });
  } catch {
    return 'unavailable';
  }
  if (response.ok) return 'ok';
  if (response.status === 401) return 'unauthenticated';
  if (response.status === 409) return 'changed';
  return 'unavailable';
}
