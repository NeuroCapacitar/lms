import type { StaffQueueDto } from '../../features/staff/queue';
import { getJson } from './http';

/** Cliente da fila operacional da Staff (M9-01): `GET /api/staff/queue`. Só mostra; o servidor decide o que cada pessoa vê e faz. */
export const fetchStaffQueue = () => getJson<StaffQueueDto>('/api/staff/queue');
