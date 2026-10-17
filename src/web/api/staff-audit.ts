import type { AuditPageDto } from '../../features/staff/audit';
import { getJson } from './http';

export interface AuditFilters {
  action: string;
  targetType: string;
  targetId: string;
}

/** Cliente da leitura da auditoria (M9-01): `GET /api/staff/audit`, por cursor. Filtro vazio não vai na URL. */
export function fetchAuditPage(filters: AuditFilters, cursor?: string): Promise<AuditPageDto> {
  const query = new URLSearchParams({ limit: '25' });
  if (cursor) query.set('cursor', cursor);
  for (const [key, value] of Object.entries(filters)) {
    const trimmed = value.trim();
    if (trimmed) query.set(key, trimmed);
  }
  return getJson<AuditPageDto>(`/api/staff/audit?${query.toString()}`);
}
