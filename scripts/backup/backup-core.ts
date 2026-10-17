/**
 * Núcleo puro do backup (M9-05): manifesto com SHA-256, nome dos objetos, retenção e frescor. Sem rede, sem disco e
 * sem `pg_dump`: quem executa (script local ou GitHub Actions administrativo) só chama estas funções, e por isso o
 * que decide "este backup é íntegro" e "este backup está velho" é testável sem banco nem R2.
 */
import { createHash } from 'node:crypto';

export type BackupKind = 'daily' | 'release';

export interface BackupManifest {
  readonly version: 1;
  readonly kind: BackupKind;
  readonly createdAt: string;
  /** Nome do objeto cifrado (`<prefixo>/<arquivo>.dump.age`). */
  readonly object: string;
  /** SHA-256 e tamanho do objeto CIFRADO (o que está no R2). */
  readonly sha256: string;
  readonly size: number;
  /** Quantidade de migrations aplicadas (`drizzle.__drizzle_migrations`) quando o dump foi feito. */
  readonly migrations: number;
  /** `server_version` do banco de origem. */
  readonly pgVersion: string;
}

const FRESHNESS_LIMIT_HOURS = 26;
const RETENTION_DEFAULT = { daily: 14, weekly: 4 } as const;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Data UTC `AAAA-MM-DD` e hora `HHMMSS` do instante, para o nome do objeto. */
function stamp(at: Date): { day: string; time: string } {
  const iso = at.toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 19).replaceAll(':', '') };
}

/** `daily/2026-10-17/hub-20261017T030000Z.dump.age`; o de release fica em `release/` e nunca é apagado pela retenção. */
export function backupObjectKey(kind: BackupKind, at: Date): string {
  const { day, time } = stamp(at);
  return `${kind}/${day}/hub-${day.replaceAll('-', '')}T${time}Z.dump.age`;
}

export function manifestKey(object: string): string {
  if (!object.endsWith('.dump.age')) throw new Error('objeto de backup inesperado');
  return `${object.slice(0, -'.dump.age'.length)}.manifest.json`;
}

export function buildManifest(input: {
  kind: BackupKind;
  createdAt: Date;
  encrypted: Uint8Array;
  migrations: number;
  pgVersion: string;
}): BackupManifest {
  if (input.encrypted.byteLength === 0) throw new Error('backup vazio');
  if (!Number.isInteger(input.migrations) || input.migrations < 0)
    throw new Error('versão de migration inválida');
  return {
    version: 1,
    kind: input.kind,
    createdAt: input.createdAt.toISOString(),
    object: backupObjectKey(input.kind, input.createdAt),
    sha256: sha256Hex(input.encrypted),
    size: input.encrypted.byteLength,
    migrations: input.migrations,
    pgVersion: input.pgVersion,
  };
}

export type ManifestCheck = { ok: true } | { ok: false; reason: 'size' | 'sha256' | 'shape' };

/** Dump corrompido, truncado ou trocado é detectado AQUI, antes de tentar decifrar ou restaurar. */
export function verifyManifest(manifest: unknown, encrypted: Uint8Array): ManifestCheck {
  if (!isManifest(manifest)) return { ok: false, reason: 'shape' };
  if (manifest.size !== encrypted.byteLength) return { ok: false, reason: 'size' };
  if (manifest.sha256 !== sha256Hex(encrypted)) return { ok: false, reason: 'sha256' };
  return { ok: true };
}

export function isManifest(value: unknown): value is BackupManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    m.version === 1 &&
    (m.kind === 'daily' || m.kind === 'release') &&
    typeof m.createdAt === 'string' &&
    !Number.isNaN(Date.parse(m.createdAt)) &&
    typeof m.object === 'string' &&
    m.object.endsWith('.dump.age') &&
    typeof m.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(m.sha256) &&
    typeof m.size === 'number' &&
    Number.isInteger(m.size) &&
    m.size > 0 &&
    typeof m.migrations === 'number' &&
    Number.isInteger(m.migrations) &&
    typeof m.pgVersion === 'string'
  );
}

export type Freshness =
  | { state: 'missing' }
  | { state: 'fresh' | 'stale'; ageHours: number; createdAt: string };

/**
 * Frescor do ÚLTIMO backup íntegro. O agendador do GitHub atrasa horas (o legado viu de 3 h 34 a 5 h 8), por isso o
 * limite é 26 h e não 24: o RPO de 24 h é a meta, o alerta existe para o backup que NÃO veio.
 */
export function backupFreshness(
  manifests: readonly BackupManifest[],
  now: Date,
  limitHours: number = FRESHNESS_LIMIT_HOURS,
): Freshness {
  let latest: BackupManifest | undefined;
  for (const m of manifests)
    if (!latest || Date.parse(m.createdAt) > Date.parse(latest.createdAt)) latest = m;
  if (!latest) return { state: 'missing' };
  const ageHours = (now.getTime() - Date.parse(latest.createdAt)) / 3_600_000;
  return {
    state: ageHours > limitHours ? 'stale' : 'fresh',
    ageHours,
    createdAt: latest.createdAt,
  };
}

/**
 * O que a retenção APAGARIA (política proposta: 14 diários + 4 semanais; ajustar ao tamanho e ao parecer jurídico).
 * Os N diários mais novos ficam; além deles, o diário mais novo de cada uma das M semanas ISO seguintes. Backups de `release` nunca entram.
 * Devolve só a lista: quem apaga decide e registra.
 */
export function planRetention(
  manifests: readonly BackupManifest[],
  policy: { daily: number; weekly: number } = RETENTION_DEFAULT,
): { keep: BackupManifest[]; remove: BackupManifest[] } {
  const daily = manifests
    .filter((m) => m.kind === 'daily')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const recent = daily.slice(0, policy.daily);
  const keep = new Set<BackupManifest>(recent);
  // Semanais: DEPOIS da janela dos diários, o diário mais novo de cada semana ISO, até `policy.weekly` semanas.
  const weeks = new Set<string>();
  for (const m of daily.slice(policy.daily)) {
    const week = isoWeek(new Date(m.createdAt));
    if (weeks.has(week)) continue;
    if (weeks.size >= policy.weekly) break;
    weeks.add(week);
    keep.add(m);
  }
  return {
    keep: manifests.filter((m) => m.kind === 'release' || keep.has(m)),
    remove: daily.filter((m) => !keep.has(m)),
  };
}

/** Semana ISO 8601 (`AAAA-Www`), em UTC. */
function isoWeek(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
