import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { MAX_ATTEMPTS, retryDelayMs } from '../../features/async/intents';

/**
 * Lease por linha (M4-01), compartilhado pela outbox e pela inbox: as duas tabelas têm as mesmas
 * colunas de estado e de lease. O SQL cru mora SÓ neste arquivo, em funções nomeadas e testadas.
 *
 * Regras: o tempo do lease vem do `now()` do BANCO (nunca do relógio do Worker); o claim usa
 * `FOR UPDATE SKIP LOCKED` (sem advisory lock); cada claim incrementa `lease_version` (fencing) e
 * toda conclusão exige `id` E `lease_version` vigentes. Zero linhas afetadas = lease perdido: o
 * worker descarta o resultado e NÃO repete o efeito.
 */
export type LeasedTable = 'outbox_message' | 'inbox_event';

export interface ClaimedRow {
  id: string;
  attempts: number;
  leaseVersion: number;
  correlationId: string;
  payload: unknown;
  /** Só a outbox tem `kind` e `dedupeKey`; a inbox tem `provider`. */
  kind: string | null;
  provider: string | null;
  /** Base da chave de idempotência das chamadas externas do handler. */
  dedupeKey: string | null;
}

export type FailureKind = 'transient' | 'permanent';

export type FailureOutcome = 'retry' | 'dead' | 'failed' | 'lease_lost';

// O nome da tabela vem de uma união fechada (nunca de entrada externa).
const table = (name: LeasedTable) => sql.identifier(name);

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

/**
 * Reivindica até `limit` linhas: `pending` com `available_at <= now()` e `leased` com lease vencido.
 * Antes, o que já esgotou as tentativas e perdeu o lease (consumidor que morre sempre no mesmo item)
 * vai para `dead`, em vez de ser reexecutado para sempre.
 */
export async function claimRows(
  db: Database,
  name: LeasedTable,
  limit: number,
  owner: string,
  leaseSeconds: number,
  onlyId?: string,
): Promise<ClaimedRow[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('claim_limit_invalid');
  }
  if (!owner || owner.length > 100) throw new RangeError('lease_owner_invalid');
  if (!Number.isFinite(leaseSeconds) || leaseSeconds <= 0) {
    throw new RangeError('lease_seconds_invalid');
  }
  const outbox = name === 'outbox_message';
  const orderBy = outbox ? sql`priority, available_at, id` : sql`available_at, id`;
  const priority = outbox ? sql`target.priority` : sql`0 as priority`;
  const identity = outbox
    ? sql`target.kind, null::text as provider, target.dedupe_key`
    : sql`null::text as kind, target.provider, null::text as dedupe_key`;
  const only = onlyId === undefined ? sql`true` : sql`id = ${onlyId}`;

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      update ${table(name)}
         set state = 'dead', lease_owner = null, lease_until = null, finished_at = now(),
             updated_at = now(), last_error_code = 'lease_expired_attempts_exhausted'
       where state = 'leased' and lease_until < now() and attempts >= ${MAX_ATTEMPTS}`);
    const result = await tx.execute(sql`
      with claimed as (
      update ${table(name)} as target
         set state = 'leased', lease_owner = ${owner},
             lease_until = now() + make_interval(secs => ${leaseSeconds}),
             lease_version = target.lease_version + 1, attempts = target.attempts + 1,
             updated_at = now()
       where target.id in (
         select id from ${table(name)}
          where ((state = 'pending' and available_at <= now())
             or (state = 'leased' and lease_until < now()))
            and ${only}
          order by ${orderBy}
          for update skip locked
          limit ${limit})
      returning target.id, target.attempts, target.lease_version, target.correlation_id,
                target.payload, target.available_at, ${priority}, ${identity})
      select * from claimed order by ${orderBy}`);
    return rowsOf(result).map((row) => ({
      id: row.id as string,
      attempts: row.attempts as number,
      leaseVersion: row.lease_version as number,
      correlationId: row.correlation_id as string,
      payload: row.payload,
      kind: (row.kind as string | null) ?? null,
      provider: (row.provider as string | null) ?? null,
      dedupeKey: (row.dedupe_key as string | null) ?? null,
    }));
  });
}

/** Conclui com sucesso. `false` = lease perdido (a linha mudou de dono ou de estado): descarte o resultado. */
export async function completeRow(
  db: Database,
  name: LeasedTable,
  id: string,
  leaseVersion: number,
): Promise<boolean> {
  const result = await db.execute(sql`
    update ${table(name)}
       set state = 'delivered', lease_owner = null, lease_until = null, finished_at = now(),
           updated_at = now(), last_error_code = null
     where id = ${id} and lease_version = ${leaseVersion} and state = 'leased'
    returning id`);
  return rowsOf(result).length === 1;
}

/**
 * Registra uma falha com o lease vigente. `transient`: volta a `pending` com backoff e jitter, ou vai
 * para `dead` se as tentativas esgotaram. `permanent`: vai para `failed` (espera decisão humana).
 * Nunca apaga a linha.
 */
export async function failRow(
  db: Database,
  name: LeasedTable,
  id: string,
  leaseVersion: number,
  failure: { kind: FailureKind; code: string },
  random: () => number = Math.random,
): Promise<FailureOutcome> {
  const code = failure.code.slice(0, 100);
  const current = await db.execute(sql`
    select attempts from ${table(name)}
     where id = ${id} and lease_version = ${leaseVersion} and state = 'leased'`);
  const found = rowsOf(current)[0];
  if (!found) return 'lease_lost';
  const attempts = found.attempts as number;

  const terminal =
    failure.kind === 'permanent' ? 'failed' : attempts >= MAX_ATTEMPTS ? 'dead' : undefined;
  const result = terminal
    ? await db.execute(sql`
        update ${table(name)}
           set state = ${terminal}, lease_owner = null, lease_until = null, finished_at = now(),
               updated_at = now(), last_error_code = ${code}
         where id = ${id} and lease_version = ${leaseVersion} and state = 'leased'
        returning id`)
    : await db.execute(sql`
        update ${table(name)}
           set state = 'pending', lease_owner = null, lease_until = null,
               available_at = now() + make_interval(secs => ${retryDelayMs(attempts, random) / 1000}),
               updated_at = now(), last_error_code = ${code}
         where id = ${id} and lease_version = ${leaseVersion} and state = 'leased'
        returning id`);
  if (rowsOf(result).length !== 1) return 'lease_lost';
  return terminal ?? 'retry';
}

/**
 * Devolve a linha à fila SEM contar como falha (ex.: kill switch ligado, cota diária esgotada): quem
 * tem o lease a repõe em `pending` para daqui a `delaySeconds`. A tentativa do claim é devolvida.
 */
export async function requeueRow(
  db: Database,
  name: LeasedTable,
  id: string,
  leaseVersion: number,
  delaySeconds: number,
): Promise<boolean> {
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) throw new RangeError('delay_invalid');
  const result = await db.execute(sql`
    update ${table(name)}
       set state = 'pending', lease_owner = null, lease_until = null,
           available_at = now() + make_interval(secs => ${delaySeconds}),
           attempts = greatest(attempts - 1, 0), updated_at = now()
     where id = ${id} and lease_version = ${leaseVersion} and state = 'leased'
    returning id`);
  return rowsOf(result).length === 1;
}

/**
 * Apaga o que passou da retenção: `delivered` e `superseded` depois de `doneDays`; `failed` e `dead`
 * depois de `problemDays`. A contagem parte de `finished_at`. Devolve quantas linhas saíram.
 */
export async function purgeRows(
  db: Database,
  name: LeasedTable,
  retention: { doneDays: number; problemDays: number },
): Promise<number> {
  const result = await db.execute(sql`
    delete from ${table(name)}
     where (state in ('delivered', 'superseded')
            and finished_at < now() - make_interval(days => ${retention.doneDays}))
        or (state in ('failed', 'dead')
            and finished_at < now() - make_interval(days => ${retention.problemDays}))
    returning id`);
  return rowsOf(result).length;
}

/** Como a linha está agora, vista por quem NÃO conseguiu o claim (mensagem duplicada ou adiantada). */
export interface RowSnapshot {
  state: string;
  /** Segundos até a linha poder ser reivindicada (0 se já pode). Tempo do banco. */
  waitSeconds: number;
}

export async function peekRow(
  db: Database,
  name: LeasedTable,
  id: string,
): Promise<RowSnapshot | undefined> {
  const result = await db.execute(sql`
    select state, greatest(0, ceil(extract(epoch from (available_at - now()))))::int as wait_seconds
      from ${table(name)} where id = ${id}`);
  const found = rowsOf(result)[0];
  return found
    ? { state: found.state as string, waitSeconds: found.wait_seconds as number }
    : undefined;
}

/**
 * Encerra como `dead` uma linha AINDA não final (`pending` ou `leased`), sem exigir o lease: é a
 * decisão do sistema (mensagem na DLQ, envelope inválido), não de um worker. `false` = já estava final
 * ou não existe. Nunca apaga.
 */
export async function markRowDead(
  db: Database,
  name: LeasedTable,
  id: string,
  code: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    update ${table(name)}
       set state = 'dead', lease_owner = null, lease_until = null, finished_at = now(),
           updated_at = now(), last_error_code = ${code.slice(0, 100)}
     where id = ${id} and state in ('pending', 'leased')
    returning id`);
  return rowsOf(result).length === 1;
}
