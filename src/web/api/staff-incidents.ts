import type {
  Communication,
  DataKind,
  IncidentCategory,
  IncidentDto,
  IncidentStatus,
  RiskAssessment,
} from '../../features/privacy/incident';
import { sendAction, postAction } from './action';
import { getJson } from './http';

/** Cliente do registro de incidentes com dados pessoais (M9-06): só mostra e pede; o servidor decide cada coisa. */
export const fetchIncidents = () =>
  getJson<{ items: IncidentDto[] }>('/api/staff/privacy/incidents').then((body) => body.items);

export interface NewIncident {
  title: string;
  description: string;
  category: IncidentCategory;
  dataKinds: DataKind[];
  affectedCount: number | null;
  /** ISO com fuso; vazio = agora (o servidor carimba). */
  detectedAt?: string;
  occurredAt: string | null;
  actionsTaken: string;
}

export const createIncident = (incident: NewIncident) =>
  postAction<{ item: IncidentDto }>('/api/staff/privacy/incidents', incident);

export interface IncidentPatch {
  status?: IncidentStatus;
  riskAssessment?: RiskAssessment;
  communication?: Communication;
  communicatedAt?: string | null;
  affectedCount?: number | null;
  dataKinds?: DataKind[];
  actionsTaken?: string;
}

export const updateIncident = (id: string, patch: IncidentPatch) =>
  sendAction<{ item: IncidentDto }>('PATCH', `/api/staff/privacy/incidents/${id}`, patch);
