import type { OperationsSnapshot, OpsAlert } from '../../features/ops/operations';
import { postAction } from './action';
import { getJson } from './http';

/** Cliente da tela "Operação" (M4-05). A tela só mostra e pede: o servidor decide cada ação. */
export interface OperationsResponse {
  snapshot: OperationsSnapshot;
  alerts: OpsAlert[];
}

export const fetchOperations = () => getJson<OperationsResponse>('/api/staff/operations');

export const requeueItem = async (id: string, reason: string) =>
  (await postAction(`/api/staff/operations/outbox/${id}/requeue`, { reason })).result;

export const pauseQueue = async (lane: 'finance' | 'general', paused: boolean, reason: string) =>
  (await postAction(`/api/staff/operations/queues/${lane}/pause`, { paused, reason })).result;
