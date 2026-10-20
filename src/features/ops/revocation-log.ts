/**
 * Registro das REVOGAÇÕES e SUSPENSÕES fora do banco (M9-05, ADR 0034), parte pura. Depois de restaurar um backup, o que a
 * Staff revogou ou suspendeu DEPOIS dele "volta a valer" (a auditoria também foi restaurada). Cada ação é registrada no R2
 * privado (`revocation-log/`), que sobrevive a uma restauração do Neon, e o passo de reconciliação a reaplica.
 *
 * O registro tem SÓ ids, a ação e o instante: nunca motivo, nota, nome nem e-mail (o texto livre fica na auditoria).
 */
export const REVOCATION_ACTIONS = [
  'certificate.revoke',
  'entitlement.revoke',
  'enrollment.suspend',
  'enrollment.reinstate',
  'account.suspend',
  'account.reactivate',
] as const;
export type RevocationAction = (typeof REVOCATION_ACTIONS)[number];

export interface RevocationLogEntry {
  version: 1;
  /** Id da linha de auditoria que originou o registro (a ordem cronológica). */
  auditId: number;
  action: RevocationAction;
  /** Certificado, direito, conta ou `curso:pessoa` (matrícula). */
  targetId: string;
  userId: string | null;
  courseId: string | null;
  /** Só do certificado (`erro_de_emissao`...). */
  category: string | null;
  occurredAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `revocation-log/000000000042-certificate.revoke.json`: o prefixo numérico faz a listagem sair em ordem. */
export function revocationLogKey(entry: Pick<RevocationLogEntry, 'auditId' | 'action'>): string {
  return `revocation-log/${String(entry.auditId).padStart(12, '0')}-${entry.action}.json`;
}

export function parseRevocationEntry(value: unknown): RevocationLogEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (entry.version !== 1) return null;
  if (typeof entry.auditId !== 'number' || !Number.isInteger(entry.auditId) || entry.auditId < 1)
    return null;
  if (!(REVOCATION_ACTIONS as readonly unknown[]).includes(entry.action)) return null;
  if (
    typeof entry.targetId !== 'string' ||
    entry.targetId.length === 0 ||
    entry.targetId.length > 200
  )
    return null;
  for (const key of ['userId', 'category'] as const) {
    const field = entry[key];
    if (field !== null && (typeof field !== 'string' || field.length === 0 || field.length > 200))
      return null;
  }
  if (entry.courseId !== null && (typeof entry.courseId !== 'string' || !UUID.test(entry.courseId)))
    return null;
  if (typeof entry.occurredAt !== 'string' || Number.isNaN(Date.parse(entry.occurredAt)))
    return null;
  return {
    version: 1,
    auditId: entry.auditId,
    action: entry.action as RevocationAction,
    targetId: entry.targetId,
    userId: entry.userId as string | null,
    courseId: entry.courseId as string | null,
    category: entry.category as string | null,
    occurredAt: entry.occurredAt,
  };
}

/** O que reaplicar: o ESTADO FINAL de cada alvo, na ordem da auditoria. */
export type ReplayStep =
  | {
      kind: 'certificate.revoke';
      certificateId: string;
      category: string | null;
      occurredAt: string;
    }
  | { kind: 'entitlement.revoke'; entitlementId: string }
  | { kind: 'account'; userId: string; suspended: boolean }
  | { kind: 'enrollment'; userId: string; courseId: string; suspended: boolean };

/**
 * Reduz o registro ao que reaplicar. Revogar certificado e direito é definitivo (o banco impede desfazer): basta uma vez.
 * Suspender e reativar PODEM ser desfeitos: o que vale é o ÚLTIMO evento de cada conta ou matrícula (senão uma suspensão
 * já levantada voltaria a bloquear a pessoa).
 */
export function planReplay(entries: readonly RevocationLogEntry[]): ReplayStep[] {
  const ordered = [...entries].sort((a, b) => a.auditId - b.auditId);
  const certificates = new Map<string, ReplayStep>();
  const entitlements = new Map<string, ReplayStep>();
  const accounts = new Map<string, ReplayStep>();
  const enrollments = new Map<string, ReplayStep>();
  for (const entry of ordered) {
    switch (entry.action) {
      case 'certificate.revoke':
        if (!certificates.has(entry.targetId))
          certificates.set(entry.targetId, {
            kind: 'certificate.revoke',
            certificateId: entry.targetId,
            category: entry.category,
            occurredAt: entry.occurredAt,
          });
        break;
      case 'entitlement.revoke':
        if (!entitlements.has(entry.targetId))
          entitlements.set(entry.targetId, {
            kind: 'entitlement.revoke',
            entitlementId: entry.targetId,
          });
        break;
      case 'account.suspend':
      case 'account.reactivate':
        accounts.set(entry.targetId, {
          kind: 'account',
          userId: entry.targetId,
          suspended: entry.action === 'account.suspend',
        });
        break;
      case 'enrollment.suspend':
      case 'enrollment.reinstate':
        if (entry.userId && entry.courseId)
          enrollments.set(`${entry.courseId}:${entry.userId}`, {
            kind: 'enrollment',
            userId: entry.userId,
            courseId: entry.courseId,
            suspended: entry.action === 'enrollment.suspend',
          });
        break;
    }
  }
  return [
    ...certificates.values(),
    ...entitlements.values(),
    ...accounts.values(),
    ...enrollments.values(),
  ];
}
