import type { AccessDto } from '../../features/identity/capabilities';
import type { InvitationDto } from '../../features/identity/staff-invitation';
import type { TeamMemberDto } from '../../features/identity/team';
import { postAction } from './action';
import { UnauthenticatedError } from './profile';

/** Cliente da área da Staff (M1-10). A interface só mostra: o servidor decide cada ação. */
export class ForbiddenError extends Error {
  constructor() {
    super('forbidden');
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (response.status === 401) throw new UnauthenticatedError();
  if (response.status === 403) throw new ForbiddenError();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const fetchAccess = () => getJson<AccessDto>('/api/me/access');
export const fetchTeam = async () =>
  (await getJson<{ members: TeamMemberDto[] }>('/api/staff/team')).members;
export const fetchInvitations = async () =>
  (await getJson<{ invitations: InvitationDto[] }>('/api/staff/invitations')).invitations;

export const inviteStaff = async (email: string, grants: string[]) =>
  (await postAction('/api/staff/invitations', { email, grants })).result;
export const resendInvitation = async (id: string) =>
  (await postAction(`/api/staff/invitations/${id}/resend`, {})).result;
export const revokeInvitation = async (id: string) =>
  (await postAction(`/api/staff/invitations/${id}/revoke`, {})).result;

export const addGrant = async (userId: string, capability: string) =>
  (await postAction(`/api/staff/users/${userId}/grants`, { capability })).result;
export const revokeGrant = async (userId: string, capability: string) =>
  (await postAction(`/api/staff/users/${userId}/grants/revoke`, { capability })).result;
export const removeSupport = async (userId: string) =>
  (await postAction(`/api/staff/users/${userId}/support/revoke`, {})).result;
export const suspendAccount = async (userId: string) =>
  (await postAction(`/api/staff/users/${userId}/suspend`, {})).result;
export const reactivateAccount = async (userId: string) =>
  (await postAction(`/api/staff/users/${userId}/reactivate`, {})).result;
