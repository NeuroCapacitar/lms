import type { ProfileDto, ProfilePatch } from '../../features/identity/profile';

/** Cliente de `GET /api/me` e `GET/PATCH /api/me/profile`. A sessão vive no cookie HttpOnly. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('unauthenticated');
  }
}

class RequestFailedError extends Error {}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new UnauthenticatedError();
  if (!response.ok) throw new RequestFailedError(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchProfile(): Promise<ProfileDto> {
  return readJson<ProfileDto>(await fetch('/api/me/profile', { credentials: 'same-origin' }));
}

export async function saveProfile(patch: ProfilePatch): Promise<ProfileDto> {
  return readJson<ProfileDto>(
    await fetch('/api/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch),
    }),
  );
}
