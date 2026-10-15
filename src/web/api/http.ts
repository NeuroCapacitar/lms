import type { AccessDto } from '../../features/identity/capabilities';
import { UnauthenticatedError } from './profile';

/**
 * Leitura JSON comum às áreas logadas (aluno e Staff). Fica FORA de `staff.ts` de propósito: o aluno usa estas funções, e o
 * módulo da Staff não pode virar dependência das telas do aluno (a Staff é só online e não entra no cache do app, M8-01).
 */
export class ForbiddenError extends Error {
  constructor() {
    super('forbidden');
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (response.status === 401) throw new UnauthenticatedError();
  if (response.status === 403) throw new ForbiddenError();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const fetchAccess = () => getJson<AccessDto>('/api/me/access');
