import type { InvitationDto } from '../../features/identity/staff-invitation';
import type { TeamMemberDto } from '../../features/identity/team';
import { postAction } from './action';
import { getJson } from './http';

/** Cliente da área da Staff (M1-10). A interface só mostra: o servidor decide cada ação. */
export { ForbiddenError } from './http';

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
