/**
 * Decisão de acesso (M3-01), pura: sem banco, relógio nem biblioteca de data. O Entitlement é a FONTE
 * do direito; esta função é a ÚNICA que transforma direitos e estados em "tem acesso?". Quem chama
 * entrega os dados lidos do banco e o `agora`; a expiração é avaliada a cada chamada (nunca por cron,
 * nunca pelo cliente).
 */

const MIN_ACCESS_MONTHS = 1;
const MAX_ACCESS_MONTHS = 600;

/**
 * Soma N meses de calendário (UTC), mantendo a hora. Dia que não existe no mês de destino vira o
 * ÚLTIMO dia dele: 31/jan + 1 mês = 28 (ou 29) de fevereiro, nunca março. A conta parte sempre da
 * data original, então não acumula erro.
 */
export function addCalendarMonths(from: Date, months: number): Date {
  if (!Number.isInteger(months) || months < MIN_ACCESS_MONTHS || months > MAX_ACCESS_MONTHS) {
    throw new RangeError(
      `prazo inválido: ${months} (use de ${MIN_ACCESS_MONTHS} a ${MAX_ACCESS_MONTHS} meses)`,
    );
  }
  const total = from.getUTCFullYear() * 12 + from.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const result = new Date(from.getTime());
  result.setUTCFullYear(year, month, Math.min(from.getUTCDate(), lastDay));
  return result;
}

export interface EntitlementWindow {
  startsAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** A maior expiração entre os direitos NÃO revogados (regra de empilhamento: o maior, não a soma). */
export function effectiveExpiry(entitlements: readonly EntitlementWindow[]): Date | null {
  let latest: Date | null = null;
  for (const item of entitlements) {
    if (item.revokedAt !== null) continue;
    if (latest === null || item.expiresAt.getTime() > latest.getTime()) latest = item.expiresAt;
  }
  return latest;
}

/** `ok` tem acesso; os demais dizem POR QUE não. */
type AccessReason = 'ok' | 'no_access' | 'suspended' | 'expired';

export interface AccessInput {
  /** `null` = a pessoa nunca teve matrícula neste curso. */
  enrollment: { anchorAt: Date; suspendedAt: Date | null } | null;
  /** Conta suspensa (M1-08). */
  accountSuspended: boolean;
  entitlements: readonly EntitlementWindow[];
  now: Date;
}

export interface AccessResult {
  hasAccess: boolean;
  reason: AccessReason;
  /** Âncora do drip; `null` sem matrícula. Nunca muda depois de definida. */
  anchorAt: Date | null;
  /** A maior expiração entre os direitos não revogados; `null` se não há nenhum. */
  expiresAt: Date | null;
}

/**
 * Sem matrícula: `no_access`. Conta ou matrícula suspensa: `suspended` (vale mesmo com direito
 * válido). Algum direito não revogado com `starts_at <= agora < expires_at`: `ok`. Havia direitos
 * mas nenhum vale agora: `expired`; só direitos revogados (ou nenhum): `no_access`.
 */
export function decideAccess(input: AccessInput): AccessResult {
  const { enrollment, entitlements, now } = input;
  if (enrollment === null) {
    return { hasAccess: false, reason: 'no_access', anchorAt: null, expiresAt: null };
  }
  const base = {
    anchorAt: enrollment.anchorAt,
    expiresAt: effectiveExpiry(entitlements),
  };
  if (input.accountSuspended || enrollment.suspendedAt !== null) {
    return { hasAccess: false, reason: 'suspended', ...base };
  }
  const live = entitlements.some(
    (item) =>
      item.revokedAt === null &&
      item.startsAt.getTime() <= now.getTime() &&
      now.getTime() < item.expiresAt.getTime(),
  );
  if (live) return { hasAccess: true, reason: 'ok', ...base };
  const hadAny = entitlements.some(
    (item) => item.revokedAt === null && item.expiresAt.getTime() <= now.getTime(),
  );
  return { hasAccess: false, reason: hadAny ? 'expired' : 'no_access', ...base };
}

/** O que a interface recebe da decisão de acesso: sem a âncora (a tela do curso chega no M3-03). */
export interface AccessDto {
  hasAccess: boolean;
  reason: AccessReason;
  /** ISO 8601; a maior expiração dos direitos não revogados, ou `null`. */
  expiresAt: string | null;
}

export function toAccessDto(result: AccessResult): AccessDto {
  return {
    hasAccess: result.hasAccess,
    reason: result.reason,
    expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
  };
}
