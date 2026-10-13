import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { MAX_ATTEMPTS, PRIORITY } from '../../src/features/async/intents.ts';
import {
  InboxPayloadTooLargeError,
  claimInbox,
  completeInbox,
  failInbox,
  purgeInbox,
  recordInboxEvent,
} from '../../src/server/async/inbox-store.ts';
import {
  DedupeKeyConflictError,
  InvalidIntentError,
  claimOutbox,
  completeOutbox,
  enqueueIntent,
  failOutbox,
  purgeOutbox,
  requeueOutbox,
} from '../../src/server/async/outbox-store.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M4-01 em Postgres 18 real: a outbox (intenções) e a inbox (eventos externos) são a fonte da verdade.
 * Claim exclusivo por `FOR UPDATE SKIP LOCKED` com duas conexões, lease com tempo do banco, fencing por
 * `lease_version`, backoff, esgotamento para `dead`, dedupe, rollback sem intenção órfã e retenção.
 */
let database: TestSchema;
let main: OpenDatabase;
let seq = 0;

const uuid = () => crypto.randomUUID();
const key = () => `teste:${(seq += 1)}:${uuid()}`;

async function enqueue(
  options: { priority?: number; availableAt?: Date; dedupeKey?: string } = {},
) {
  return main.db.transaction((tx) =>
    enqueueIntent(tx, {
      kind: 'system.demo',
      dedupeKey: options.dedupeKey ?? key(),
      payload: { subjectId: uuid() },
      correlationId: 'corr-teste',
      priority: options.priority,
      availableAt: options.availableAt,
    }),
  );
}

async function row(id: string) {
  const [found] = await main.db
    .select()
    .from(schema.outboxMessage)
    .where(eq(schema.outboxMessage.id, id));
  return found!;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  database = await createTestSchema();
  main = await openDatabase(database.connectionString);
});
afterAll(async () => {
  await main.close();
  await database.drop();
});
beforeEach(async () => {
  await main.db.execute(sql`truncate table outbox_message, inbox_event`);
});

describe('enqueueIntent', () => {
  it('grava a intenção pendente, na fila do kind, com os valores padrão', async () => {
    const { id, created } = await enqueue();
    expect(created).toBe(true);
    const saved = await row(id);
    expect(saved).toMatchObject({
      kind: 'system.demo',
      queue: 'general',
      state: 'pending',
      attempts: 0,
      leaseVersion: 0,
      priority: PRIORITY.transactional,
      correlationId: 'corr-teste',
    });
    expect(saved.leaseOwner).toBeNull();
  });

  it('a mesma dedupeKey não duplica: devolve a intenção existente', async () => {
    const first = await enqueue({ dedupeKey: 'unica' });
    const second = await enqueue({ dedupeKey: 'unica' });
    expect(second).toEqual({ id: first.id, created: false });
    const counted = await main.db.execute(sql`select count(*)::int as total from outbox_message`);
    expect((counted.rows[0] as { total: number }).total).toBe(1);
  });

  it('dedupeKey de OUTRO kind é conflito, nunca a intenção alheia', async () => {
    await main.db.execute(sql`
      insert into outbox_message (kind, queue, dedupe_key, payload, correlation_id)
      values ('outro.kind', 'general', 'colide', '{}'::jsonb, 'c')`);
    await expect(enqueue({ dedupeKey: 'colide' })).rejects.toBeInstanceOf(DedupeKeyConflictError);
  });

  it('rollback da transação de domínio não deixa intenção órfã', async () => {
    await expect(
      main.db.transaction(async (tx) => {
        await enqueueIntent(tx, {
          kind: 'system.demo',
          dedupeKey: 'some-no-rollback',
          payload: { subjectId: uuid() },
          correlationId: 'c',
        });
        throw new Error('falha de domínio depois de enfileirar');
      }),
    ).rejects.toThrow('falha de domínio');
    const rows = await main.db
      .select()
      .from(schema.outboxMessage)
      .where(eq(schema.outboxMessage.dedupeKey, 'some-no-rollback'));
    expect(rows).toHaveLength(0);
  });

  it('rejeita payload com dado pessoal ou fora do contrato', async () => {
    const attempt = (payload: unknown) =>
      main.db.transaction((tx) =>
        enqueueIntent(tx, {
          kind: 'system.demo',
          dedupeKey: key(),
          payload: payload as never,
          correlationId: 'c',
        }),
      );
    await expect(attempt({ subjectId: uuid(), email: 'ana@example.com' })).rejects.toBeInstanceOf(
      InvalidIntentError,
    );
    await expect(attempt({ subjectId: 'ana@example.com' })).rejects.toBeInstanceOf(
      InvalidIntentError,
    );
    await expect(attempt({})).rejects.toBeInstanceOf(InvalidIntentError);
  });

  it('rejeita kind desconhecido', async () => {
    await expect(
      main.db.transaction((tx) =>
        enqueueIntent(tx, {
          kind: 'nao.existe' as never,
          dedupeKey: key(),
          payload: {} as never,
          correlationId: 'c',
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidIntentError);
  });

  it('chamada fora da transação: o tipo recusa e, se contornado, a execução também', async () => {
    const outside = () =>
      enqueueIntent(
        // @ts-expect-error o `Database` comum não é uma transação: o tipo impede a chamada
        main.db,
        {
          kind: 'system.demo',
          dedupeKey: key(),
          payload: { subjectId: uuid() },
          correlationId: 'c',
        },
      );
    await expect(outside()).rejects.toThrow('invalid_intent:transaction_required');
  });
});

describe('claimOutbox', () => {
  it('duas conexões reivindicando ao mesmo tempo nunca pegam a mesma linha', async () => {
    const second = await openDatabase(database.connectionString);
    try {
      for (let index = 0; index < 40; index += 1) await enqueue();
      const [a, b] = await Promise.all([
        claimOutbox(main.db, 25, 'worker-a'),
        claimOutbox(second.db, 25, 'worker-b'),
      ]);
      const ids = [...a, ...b].map((claimedRow) => claimedRow.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(40);
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(0);
      for (const claimedRow of [...a, ...b]) {
        expect(claimedRow.leaseVersion).toBe(1);
        expect(claimedRow.attempts).toBe(1);
      }
    } finally {
      await second.close();
    }
  });

  it('não reivindica o que ainda não venceu (available_at futuro) nem o que já está com lease válido', async () => {
    await enqueue({ availableAt: new Date(Date.now() + 3_600_000) });
    const ready = await enqueue();
    const first = await claimOutbox(main.db, 10, 'worker-a');
    expect(first.map((claimedRow) => claimedRow.id)).toEqual([ready.id]);
    expect(await claimOutbox(main.db, 10, 'worker-b')).toHaveLength(0);
  });

  it('respeita a prioridade: login antes de transacional antes de marketing', async () => {
    const marketing = await enqueue({ priority: PRIORITY.marketing });
    const transactional = await enqueue({ priority: PRIORITY.transactional });
    const login = await enqueue({ priority: PRIORITY.login });
    const claimed = await claimOutbox(main.db, 10, 'worker-a');
    expect(claimed.map((claimedRow) => claimedRow.id)).toEqual([
      login.id,
      transactional.id,
      marketing.id,
    ]);
  });

  it('lease expirado é reassumido (com o relógio do banco) e o worker antigo não conclui', async () => {
    const { id } = await enqueue();
    const [old] = await claimOutbox(main.db, 1, 'worker-antigo', 0.05);
    expect(old!.leaseVersion).toBe(1);
    await sleep(150);

    const [fresh] = await claimOutbox(main.db, 1, 'worker-novo');
    expect(fresh!.id).toBe(id);
    expect(fresh!.leaseVersion).toBe(2);
    expect(fresh!.attempts).toBe(2);

    expect(await completeOutbox(main.db, id, old!.leaseVersion)).toBe(false);
    expect(
      await failOutbox(main.db, id, old!.leaseVersion, { kind: 'transient', code: 'tarde' }),
    ).toBe('lease_lost');
    expect(await requeueOutbox(main.db, id, old!.leaseVersion, 0)).toBe(false);
    expect((await row(id)).state).toBe('leased');

    expect(await completeOutbox(main.db, id, fresh!.leaseVersion)).toBe(true);
    const done = await row(id);
    expect(done.state).toBe('delivered');
    expect(done.leaseOwner).toBeNull();
    expect(done.finishedAt).not.toBeNull();
  });

  it('o consumidor que sempre morre no mesmo item o leva a dead, não ao reprocesso eterno', async () => {
    const { id } = await enqueue();
    await main.db.execute(sql`
      update outbox_message
         set state = 'leased', lease_owner = 'morto', lease_until = now() - interval '1 minute',
             attempts = ${MAX_ATTEMPTS}, lease_version = ${MAX_ATTEMPTS}
       where id = ${id}`);
    expect(await claimOutbox(main.db, 10, 'worker-a')).toHaveLength(0);
    const dead = await row(id);
    expect(dead.state).toBe('dead');
    expect(dead.lastErrorCode).toBe('lease_expired_attempts_exhausted');
    expect(dead.finishedAt).not.toBeNull();
  });

  it('valida os parâmetros do claim', async () => {
    await expect(claimOutbox(main.db, 0, 'w')).rejects.toThrow('claim_limit_invalid');
    await expect(claimOutbox(main.db, 101, 'w')).rejects.toThrow('claim_limit_invalid');
    await expect(claimOutbox(main.db, 1, '')).rejects.toThrow('lease_owner_invalid');
    await expect(claimOutbox(main.db, 1, 'w', 0)).rejects.toThrow('lease_seconds_invalid');
  });
});

describe('falha, nova tentativa e fim das tentativas', () => {
  it('falha transitória volta a pending com atraso (backoff) e guarda o código', async () => {
    const { id } = await enqueue();
    const [claimed] = await claimOutbox(main.db, 1, 'w');
    const outcome = await failOutbox(
      main.db,
      id,
      claimed!.leaseVersion,
      { kind: 'transient', code: 'provider_timeout' },
      () => 1,
    );
    expect(outcome).toBe('retry');
    const saved = await row(id);
    expect(saved.state).toBe('pending');
    expect(saved.lastErrorCode).toBe('provider_timeout');
    expect(saved.leaseOwner).toBeNull();
    expect(saved.finishedAt).toBeNull();
    // ~30 s à frente (1ª tentativa, jitter máximo): ainda não reivindicável agora.
    expect(saved.availableAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(await claimOutbox(main.db, 10, 'w')).toHaveLength(0);
  });

  it('falha permanente vai para failed e fica na tabela', async () => {
    const { id } = await enqueue();
    const [claimed] = await claimOutbox(main.db, 1, 'w');
    expect(
      await failOutbox(main.db, id, claimed!.leaseVersion, {
        kind: 'permanent',
        code: 'bad_input',
      }),
    ).toBe('failed');
    const saved = await row(id);
    expect(saved.state).toBe('failed');
    expect(saved.finishedAt).not.toBeNull();
    expect(await claimOutbox(main.db, 10, 'w')).toHaveLength(0);
  });

  it('esgotadas as tentativas, a falha transitória vira dead (não apaga)', async () => {
    const { id } = await enqueue();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const [claimed] = await claimOutbox(main.db, 1, 'w');
      expect(claimed!.attempts).toBe(attempt);
      const outcome = await failOutbox(main.db, id, claimed!.leaseVersion, {
        kind: 'transient',
        code: 'sempre_falha',
      });
      expect(outcome).toBe(attempt === MAX_ATTEMPTS ? 'dead' : 'retry');
      await main.db.execute(
        sql`update outbox_message set available_at = now() where id = ${id} and state = 'pending'`,
      );
    }
    const saved = await row(id);
    expect(saved.state).toBe('dead');
    expect(saved.attempts).toBe(MAX_ATTEMPTS);
    expect(saved.finishedAt).not.toBeNull();
  });

  it('requeue devolve a linha à fila sem contar a tentativa', async () => {
    const { id } = await enqueue();
    const [claimed] = await claimOutbox(main.db, 1, 'w');
    expect(await requeueOutbox(main.db, id, claimed!.leaseVersion, 0)).toBe(true);
    const saved = await row(id);
    expect(saved).toMatchObject({ state: 'pending', attempts: 0 });
    const [again] = await claimOutbox(main.db, 1, 'w');
    expect(again).toMatchObject({ id, attempts: 1, leaseVersion: 2 });
  });
});

describe('restrições do banco', () => {
  it('estado de lease incoerente é recusado', async () => {
    await expect(
      main.db.execute(sql`
        insert into outbox_message (kind, queue, dedupe_key, payload, correlation_id, state)
        values ('system.demo', 'general', 'k1', '{}'::jsonb, 'c', 'leased')`),
    ).rejects.toThrow();
    await expect(
      main.db.execute(sql`
        insert into outbox_message (kind, queue, dedupe_key, payload, correlation_id, state)
        values ('system.demo', 'general', 'k2', '{}'::jsonb, 'c', 'delivered')`),
    ).rejects.toThrow();
  });

  it('fila e estado fora do domínio, e payload que não é objeto, são recusados', async () => {
    for (const [queue, state, payload] of [
      ['outra', 'pending', '{}'],
      ['general', 'inventado', '{}'],
      ['general', 'pending', '[]'],
    ] as const) {
      await expect(
        main.db.execute(sql`
          insert into outbox_message (kind, queue, dedupe_key, payload, correlation_id, state)
          values ('system.demo', ${queue}, ${key()}, ${payload}::jsonb, 'c', ${state})`),
      ).rejects.toThrow();
    }
  });
});

describe('retenção', () => {
  it('apaga entregues e substituídas após 30 dias e failed/dead após 180, nada antes', async () => {
    const ids: Record<string, string> = {};
    for (const [name, state, days] of [
      ['entregue-velha', 'delivered', 31],
      ['entregue-nova', 'delivered', 29],
      ['substituida-velha', 'superseded', 31],
      ['dead-39', 'dead', 39],
      ['dead-velha', 'dead', 181],
      ['failed-velha', 'failed', 181],
    ] as const) {
      const { id } = await enqueue();
      ids[name] = id;
      await main.db.execute(sql`
        update outbox_message
           set state = ${state}, finished_at = now() - make_interval(days => ${days})
         where id = ${id}`);
    }
    const pending = await enqueue();
    expect(await purgeOutbox(main.db)).toBe(4);
    const remaining = (await main.db.select().from(schema.outboxMessage)).map((r) => r.id);
    expect(remaining.sort()).toEqual([ids['entregue-nova']!, ids['dead-39']!, pending.id].sort());
  });
});

describe('inbox', () => {
  const event = (eventId: string, extra: Record<string, unknown> = {}) => ({
    provider: 'asaas' as const,
    eventId,
    payload: { event: 'PAYMENT_CONFIRMED', ...extra },
    correlationId: 'corr-webhook',
  });

  it('persiste uma vez por (provider, eventId); o reenvio devolve o mesmo registro', async () => {
    const first = await recordInboxEvent(main.db, event('evt_1'));
    const again = await recordInboxEvent(main.db, event('evt_1'));
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    // O mesmo id em OUTRO provider é outro evento.
    const other = await recordInboxEvent(main.db, { ...event('evt_1'), provider: 'resend' });
    expect(other.created).toBe(true);
    expect(other.id).not.toBe(first.id);
  });

  it('recusa payload acima de 64 KiB sem gravar', async () => {
    await expect(
      recordInboxEvent(main.db, event('evt_grande', { lixo: 'x'.repeat(70_000) })),
    ).rejects.toBeInstanceOf(InboxPayloadTooLargeError);
    const rows = await main.db.select().from(schema.inboxEvent);
    expect(rows).toHaveLength(0);
  });

  it('reenvios concorrentes do mesmo evento viram UMA linha', async () => {
    const second = await openDatabase(database.connectionString);
    try {
      const results = await Promise.all([
        recordInboxEvent(main.db, event('evt_corrida')),
        recordInboxEvent(second.db, event('evt_corrida')),
      ]);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(results[0]!.id).toBe(results[1]!.id);
    } finally {
      await second.close();
    }
  });

  it('claim exclusivo entre conexões, lease com fencing e conclusão', async () => {
    const second = await openDatabase(database.connectionString);
    try {
      for (let index = 0; index < 20; index += 1) {
        await recordInboxEvent(main.db, event(`evt_${index}`));
      }
      const [a, b] = await Promise.all([
        claimInbox(main.db, 12, 'worker-a'),
        claimInbox(second.db, 12, 'worker-b'),
      ]);
      const ids = [...a, ...b].map((claimedRow) => claimedRow.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(20);
      expect(a[0]!.provider).toBe('asaas');
      expect(a[0]!.kind).toBeNull();

      const target = a[0]!;
      expect(await completeInbox(main.db, target.id, target.leaseVersion + 1)).toBe(false);
      expect(await completeInbox(main.db, target.id, target.leaseVersion)).toBe(true);
      expect(await completeInbox(main.db, target.id, target.leaseVersion)).toBe(false);
    } finally {
      await second.close();
    }
  });

  it('lease expirado da inbox é reassumido e a falha transitória/permanente segue a mesma regra', async () => {
    const { id } = await recordInboxEvent(main.db, event('evt_lease'));
    const [old] = await claimInbox(main.db, 1, 'antigo', 0.05);
    await sleep(150);
    const [fresh] = await claimInbox(main.db, 1, 'novo');
    expect(fresh).toMatchObject({ id, leaseVersion: old!.leaseVersion + 1 });
    expect(await completeInbox(main.db, id, old!.leaseVersion)).toBe(false);
    expect(
      await failInbox(main.db, id, fresh!.leaseVersion, {
        kind: 'permanent',
        code: 'evento_invalido',
      }),
    ).toBe('failed');
  });

  it('retenção: concluído 30 dias, failed/dead 180 dias', async () => {
    const kept = await recordInboxEvent(main.db, event('evt_nova'));
    for (const [eventId, state, days] of [
      ['evt_velha', 'delivered', 31],
      ['evt_dead_velha', 'dead', 181],
      ['evt_dead_recente', 'dead', 60],
    ] as const) {
      const { id } = await recordInboxEvent(main.db, event(eventId));
      await main.db.execute(sql`
        update inbox_event
           set state = ${state}, finished_at = now() - make_interval(days => ${days})
         where id = ${id}`);
    }
    expect(await purgeInbox(main.db)).toBe(2);
    const remaining = (await main.db.select().from(schema.inboxEvent)).map((r) => r.eventId);
    expect(remaining.sort()).toEqual(['evt_dead_recente', 'evt_nova']);
    expect(kept.created).toBe(true);
  });
});
