import { z } from 'zod';

import { ACCESS_LINK_PATTERN, EMAIL_PATTERN } from '../observability/patterns';

/**
 * Registro de incidentes com dados pessoais (M9-06, ADR 0033), parte pura. É o REGISTRO (o que houve, o que foi
 * decidido), não um canal de comunicação: **nunca guarda dado pessoal de quem foi afetado**. A decisão de comunicar
 * à ANPD e aos titulares é do responsável com o advogado; aqui só se registra que foi avaliada e quando.
 * Todo incidente é guardado, também os não comunicados, e não se apaga (retenção de pelo menos 5 anos, a confirmar
 * com o advogado).
 */
export const INCIDENT_CATEGORIES = [
  'exposure',
  'unauthorized_access',
  'loss',
  'alteration',
  'misdelivery',
  'other',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  exposure: 'Exposição ou vazamento',
  unauthorized_access: 'Acesso indevido',
  loss: 'Perda de dados',
  alteration: 'Alteração indevida',
  misdelivery: 'Envio à pessoa errada',
  other: 'Outro',
};

export const DATA_KINDS = [
  'name',
  'email',
  'payer_document',
  'progress',
  'certificate',
  'discussion',
  'credentials',
  'other',
] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export const DATA_KIND_LABELS: Record<DataKind, string> = {
  name: 'Nome',
  email: 'E-mail',
  payer_document: 'CPF ou CNPJ do pagador',
  progress: 'Progresso de estudo',
  certificate: 'Certificado',
  discussion: 'Discussões',
  credentials: 'Credenciais ou sessão',
  other: 'Outro',
};

export const INCIDENT_STATUSES = ['open', 'contained', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Aberto',
  contained: 'Contido',
  closed: 'Encerrado',
};

export const RISK_ASSESSMENTS = ['not_assessed', 'low', 'relevant'] as const;
export type RiskAssessment = (typeof RISK_ASSESSMENTS)[number];
export const RISK_LABELS: Record<RiskAssessment, string> = {
  not_assessed: 'Ainda não avaliado',
  low: 'Risco não relevante',
  relevant: 'Risco relevante',
};

export const COMMUNICATIONS = ['pending', 'not_required', 'communicated'] as const;
export type Communication = (typeof COMMUNICATIONS)[number];
export const COMMUNICATION_LABELS: Record<Communication, string> = {
  pending: 'Decisão pendente',
  not_required: 'Decidido: comunicação não exigida',
  communicated: 'Comunicado',
};

/** CPF e CNPJ, com ou sem pontuação. */
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const CNPJ_PATTERN = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;
/** Telefone brasileiro com DDD (a lista é de heurísticas: reduz o erro, não o elimina). */
const PHONE_PATTERN = /(?:\(\d{2}\)\s?|\b\d{2}\s)9?\d{4}[-\s]?\d{4}\b/;

/** O texto parece conter dado pessoal (e-mail, CPF, CNPJ, telefone ou link de acesso)? Heurística: a regra é não escrever. */
export function looksLikePersonalData(text: string): boolean {
  const email = new RegExp(EMAIL_PATTERN.source);
  const link = new RegExp(ACCESS_LINK_PATTERN.source);
  return [email, link, CPF_PATTERN, CNPJ_PATTERN, PHONE_PATTERN].some((pattern) =>
    pattern.test(text),
  );
}

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !looksLikePersonalData(value), { message: 'personal_data_in_text' });

const optionalText = (max: number) => text(0, max);

const isoInstant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export function createIncidentSchema() {
  return z.strictObject({
    title: text(3, 120),
    description: text(10, 2000),
    category: z.enum(INCIDENT_CATEGORIES),
    dataKinds: z.array(z.enum(DATA_KINDS)).max(DATA_KINDS.length).default([]),
    affectedCount: z.number().int().min(0).max(1_000_000).nullable().default(null),
    detectedAt: isoInstant.optional(),
    occurredAt: isoInstant.nullable().default(null),
    actionsTaken: optionalText(2000).default(''),
  });
}
export type CreateIncidentInput = z.output<ReturnType<typeof createIncidentSchema>>;

export function updateIncidentSchema() {
  return z
    .strictObject({
      status: z.enum(INCIDENT_STATUSES),
      riskAssessment: z.enum(RISK_ASSESSMENTS),
      communication: z.enum(COMMUNICATIONS),
      communicatedAt: isoInstant.nullable(),
      affectedCount: z.number().int().min(0).max(1_000_000).nullable(),
      dataKinds: z.array(z.enum(DATA_KINDS)).max(DATA_KINDS.length),
      actionsTaken: optionalText(2000),
    })
    .partial()
    .refine((value) => Object.keys(value).length > 0, { message: 'empty_update' });
}
export type UpdateIncidentInput = z.output<ReturnType<typeof updateIncidentSchema>>;

/** Ordem do ciclo: aberto, contido, encerrado (só para a frente; encerrado é definitivo). */
const STATUS_ORDER: Record<IncidentStatus, number> = { open: 0, contained: 1, closed: 2 };

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return STATUS_ORDER[to] >= STATUS_ORDER[from] && from !== 'closed';
}

/**
 * Encerrar exige a decisão jurídica REGISTRADA: o risco avaliado e a comunicação decidida (comunicada ou não exigida).
 * Sem isto um incidente fecharia sem ninguém ter decidido se havia o que comunicar.
 */
export function canClose(state: {
  riskAssessment: RiskAssessment;
  communication: Communication;
}): boolean {
  return state.riskAssessment !== 'not_assessed' && state.communication !== 'pending';
}

export interface IncidentDto {
  id: string;
  title: string;
  description: string;
  category: IncidentCategory;
  dataKinds: DataKind[];
  affectedCount: number | null;
  detectedAt: string;
  occurredAt: string | null;
  status: IncidentStatus;
  riskAssessment: RiskAssessment;
  communication: Communication;
  communicatedAt: string | null;
  actionsTaken: string | null;
  containedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
