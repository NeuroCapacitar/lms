import type { StaffPanelDto } from '../../features/staff/panel';
import { getJson } from './http';

/** Cliente do painel de fatos da Staff (M9-01): `GET /api/staff/panel`. Só contagens; o servidor decide o que cada pessoa vê. */
export const fetchStaffPanel = () => getJson<StaffPanelDto>('/api/staff/panel');
