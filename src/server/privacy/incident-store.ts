import { desc, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import type { Database } from '../../db/client';
import { privacyIncident } from '../../db/schema';
import {
  canClose,
  canTransition,
  type CreateIncidentInput,
  type DataKind,
  type IncidentCategory,
  type IncidentDto,
  type IncidentStatus,
  type Communication,
  type RiskAssessment,
  type UpdateIncidentInput,
} from '../../features/privacy/incident';
import { auditEvent } from '../auth/access-store';

export class IncidentNotFoundError extends Error {
  constructor() {
    super('incident_not_found');
  }
}
/** Encerrado é definitivo. */
export class IncidentClosedError extends Error {
  constructor() {
    super('incident_closed');
  }
}
/** O estado pedido não é possível: volta atrás no ciclo, ou encerra sem a decisão jurídica registrada. */
export class IncidentRuleError extends Error {
  constructor(
    readonly code: 'invalid_transition' | 'decision_required' | 'communicated_at_required',
  ) {
    super(code);
  }
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

function toDto(row: typeof privacyIncident.$inferSelect): IncidentDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category as IncidentCategory,
    dataKinds: row.dataKinds as DataKind[],
    affectedCount: row.affectedCount,
    detectedAt: row.detectedAt.toISOString(),
    occurredAt: iso(row.occurredAt),
    status: row.status as IncidentStatus,
    riskAssessment: row.riskAssessment as RiskAssessment,
    communication: row.communication as Communication,
    communicatedAt: iso(row.communicatedAt),
    actionsTaken: row.actionsTaken,
    containedAt: iso(row.containedAt),
    closedAt: iso(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Do mais recente para o mais antigo. Só o registro: nunca dado pessoal de quem foi afetado. */
export async function listIncidents(db: Database): Promise<IncidentDto[]> {
  const rows = await db
    .select()
    .from(privacyIncident)
    .orderBy(desc(privacyIncident.detectedAt), desc(privacyIncident.createdAt))
    .limit(500);
  return rows.map(toDto);
}

export async function createIncident(
  db: Database,
  actorId: string,
  input: CreateIncidentInput,
): Promise<IncidentDto> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(privacyIncident)
      .values({
        title: input.title,
        description: input.description,
        category: input.category,
        dataKinds: [...new Set(input.dataKinds)],
        affectedCount: input.affectedCount,
        detectedAt: input.detectedAt ?? new Date(),
        occurredAt: input.occurredAt,
        actionsTaken: input.actionsTaken === '' ? null : input.actionsTaken,
        createdBy: actorId,
      })
      .returning();
    await auditEvent(tx, {
      actorId,
      action: 'privacy.incident_create',
      targetType: 'privacy_incident',
      targetId: row!.id,
      details: { category: input.category },
    });
    return toDto(row!);
  });
}

/**
 * Atualiza o que mudou, sob trava da linha. O ciclo só anda para a frente (aberto, contido, encerrado) e ENCERRAR exige
 * o risco avaliado e a comunicação decidida. `contained_at` e `closed_at` são carimbados aqui, uma vez. A auditoria diz
 * QUAIS campos mudaram, nunca o texto.
 */
export async function updateIncident(
  db: Database,
  actorId: string,
  id: string,
  patch: UpdateIncidentInput,
): Promise<IncidentDto> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(privacyIncident)
      .where(eq(privacyIncident.id, id))
      .for('update');
    if (!current) throw new IncidentNotFoundError();
    if (current.status === 'closed') throw new IncidentClosedError();

    const status = patch.status ?? (current.status as IncidentStatus);
    const risk = patch.riskAssessment ?? (current.riskAssessment as RiskAssessment);
    const communication = patch.communication ?? (current.communication as Communication);
    if (!canTransition(current.status as IncidentStatus, status))
      throw new IncidentRuleError('invalid_transition');
    if (status === 'closed' && !canClose({ riskAssessment: risk, communication }))
      throw new IncidentRuleError('decision_required');

    const communicatedAt =
      communication === 'communicated'
        ? (patch.communicatedAt ?? current.communicatedAt ?? null)
        : null;
    if (communication === 'communicated' && communicatedAt === null)
      throw new IncidentRuleError('communicated_at_required');

    const set: PgUpdateSetSource<typeof privacyIncident> = {
      status,
      riskAssessment: risk,
      communication,
      communicatedAt,
      updatedAt: sql`now()`,
    };
    if (patch.affectedCount !== undefined) set.affectedCount = patch.affectedCount;
    if (patch.dataKinds !== undefined) set.dataKinds = [...new Set(patch.dataKinds)];
    if (patch.actionsTaken !== undefined)
      set.actionsTaken = patch.actionsTaken === '' ? null : patch.actionsTaken;
    if (status !== 'open' && current.containedAt === null) set.containedAt = sql`now()`;
    if (status === 'closed') set.closedAt = sql`now()`;

    const [row] = await tx
      .update(privacyIncident)
      .set(set)
      .where(eq(privacyIncident.id, id))
      .returning();
    await auditEvent(tx, {
      actorId,
      action: 'privacy.incident_update',
      targetType: 'privacy_incident',
      targetId: id,
      details: { fields: Object.keys(patch).sort(), status },
    });
    return toDto(row!);
  });
}
