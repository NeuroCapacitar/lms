import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { SCRUBBED_HOLDER_NAME, purgeLogKey } from '../../src/features/certificate/retention.ts';
import { toPublicDto } from '../../src/features/certificate/public.ts';
import {
  CertificateNotFoundError,
  openCertificateDownload,
} from '../../src/server/certificate/lifecycle-store.ts';
import { lookupPublicCertificate } from '../../src/server/certificate/public-routes.ts';
import { hasDueRevokedPdf, purgeRevokedPdfs } from '../../src/server/certificate/purge-store.ts';
import { sha256Hex } from '../../src/server/crypto.ts';
import { createCronJobs } from '../../src/server/async/jobs.ts';
import { createMemoryStorage, type MemoryStorage } from '../../src/server/media/memory-storage.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse, type DemoFixture } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M7-05 em Postgres 18 real: a retenção do PDF de certificado REVOGADO. O prazo é contado no relógio do banco a partir de `revoked_at`;
 * a purga apaga o objeto, deixa o registro durável fora do banco, tira o nome do snapshot e mantém o TOMBSTONE (código, estado,
 * `revoked_at` e o SHA-256); é repetível, tolera falha do R2 e dump restaurado; nunca toca certificado válido ou reemitido; e o banco
 * (gatilho e restrição) só deixa passar a transição de purga, e só desta forma.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const DAYS = 90;
const DAY = 86_400_000;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let demo: DemoFixture;
let storage: MemoryStorage;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  demo = await createDemoCourse(tools.db);
}, 120_000);
// Cada teste começa sem certificados (um que falha de propósito deixaria um vencido para o seguinte). TRUNCATE não passa pelo gatilho de DELETE.
beforeEach(async () => {
  await tools.db.execute(sql`truncate table certificate`);
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});

const snapshotOf = (holderName: string) => ({
  version: 1,
  holderName,
  courseTitle: 'Curso Demonstrativo',
  workloadHours: 20,
  completedAt: '2026-06-01T12:00:00.000Z',
  requiredTotal: 5,
  issuer: { legalName: 'NeuroCapacitar Ltda', cnpj: '12345678000199' },
  signatory: { name: 'Dra. Assinante', title: 'Coordenação', signatureMediaId: null },
  layout: null,
  backgroundMediaId: null,
});

interface Made {
  id: string;
  code: string;
  key: string | null;
  sha256: string | null;
  userId: string;
  bytes: Uint8Array;
}

async function person() {
  seq += 1;
  const id = `purga-${seq}`;
  await tools.db
    .insert(schema.user)
    .values({ id, name: `Pessoa ${seq}`, email: `purga${seq}@purga.example.test` });
  await tools.db
    .insert(schema.enrollment)
    .values({ userId: id, courseId: demo.courseId, anchorAt: new Date(Date.now() - 200 * DAY) });
  await tools.db
    .insert(schema.courseCompletion)
    .values({ userId: id, courseId: demo.courseId, requiredTotal: 5 });
  return id;
}

/** Um certificado no estado pedido. `revokedMinutesAgo` negativo = revogado no futuro do prazo (ainda dentro dele). */
async function certificate(options: {
  status?: 'revoked' | 'ready' | 'superseded';
  revokedMinutesAgo?: number;
  withPdf?: boolean;
  predecessorId?: string;
  userId?: string;
  note?: string;
}): Promise<Made> {
  const status = options.status ?? 'revoked';
  const userId = options.userId ?? (await person());
  seq += 1;
  const code = String(seq).padStart(22, 'k');
  const bytes = new TextEncoder().encode(`%PDF-1.7 certificado ${seq}`);
  const withPdf = options.withPdf ?? true;
  const key = withPdf ? `certificates/${crypto.randomUUID()}.pdf` : null;
  const sha256 = withPdf ? await sha256Hex(bytes) : null;
  if (key) storage.upload(key, bytes, 'application/pdf');
  const [row] = await tools.db
    .insert(schema.certificate)
    .values({
      userId,
      courseId: demo.courseId,
      code,
      status,
      snapshot: snapshotOf('Maria Aparecida de Souza'),
      pdfKey: key,
      pdfSha256: sha256,
      readyAt: new Date(Date.now() - 300 * DAY),
      ...(options.predecessorId ? { predecessorId: options.predecessorId } : {}),
      ...(status === 'revoked'
        ? {
            revokedAt: new Date(Date.now() - (options.revokedMinutesAgo ?? 0) * 60_000),
            revocationCategory: 'erro_de_emissao',
            revocationNote: options.note ?? 'Nota interna com o CPF 123.456.789-00 da pessoa',
          }
        : {}),
    })
    .returning({ id: schema.certificate.id });
  return { id: row!.id, code, key, sha256, userId, bytes };
}

const inDays = (days: number, extraMinutes = 0) => days * 24 * 60 + extraMinutes;
const rowOf = async (id: string) =>
  (await tools.db.select().from(schema.certificate).where(eq(schema.certificate.id, id)))[0]!;
const purge = () => purgeRevokedPdfs(tools.db, storage, { days: DAYS });

describe('o prazo', () => {
  it('antes do prazo NADA acontece; depois dele o PDF é eliminado (limite de 1 minuto para cada lado)', async () => {
    storage = createMemoryStorage();
    const early = await certificate({ revokedMinutesAgo: inDays(DAYS, -1) }); // 1 min ANTES de vencer
    const late = await certificate({ revokedMinutesAgo: inDays(DAYS, 1) }); // 1 min DEPOIS
    expect(await hasDueRevokedPdf(tools.db, DAYS)).toBe(true);

    const result = await purge();
    expect(result).toEqual({ purged: 1, failed: 0 });
    expect((await rowOf(early.id)).pdfKey).toBe(early.key);
    expect(storage.has('private', early.key!)).toBe(true);
    expect((await rowOf(late.id)).pdfKey).toBeNull();
    expect(storage.has('private', late.key!)).toBe(false);
  });

  it('o prazo é em dias do relógio do banco (UTC): o fuso da sessão não muda o resultado', async () => {
    storage = createMemoryStorage();
    const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 5) });
    await tools.db.execute(sql`set time zone 'Pacific/Kiritimati'`);
    try {
      expect(await hasDueRevokedPdf(tools.db, DAYS)).toBe(true);
      expect((await purge()).purged).toBe(1);
    } finally {
      await tools.db.execute(sql`set time zone 'UTC'`);
    }
    expect((await rowOf(made.id)).pdfPurgedAt).not.toBeNull();
  });
});

describe('o que a purga faz', () => {
  it('apaga o objeto, grava o registro durável, tira só o nome do snapshot, apaga a nota interna, mantém o tombstone e audita', async () => {
    storage = createMemoryStorage();
    const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 60) });
    const before = await rowOf(made.id);
    await purge();
    const after = await rowOf(made.id);

    expect(storage.has('private', made.key!)).toBe(false);
    // Tombstone: código, estado, revoked_at e o SHA-256 do PDF continuam.
    expect(after.code).toBe(made.code);
    expect(after.status).toBe('revoked');
    expect(after.revokedAt?.getTime()).toBe(before.revokedAt?.getTime());
    expect(after.pdfSha256).toBe(made.sha256);
    expect(after.pdfKey).toBeNull();
    expect(after.pdfPurgedAt).not.toBeNull();
    // Snapshot: só o nome do titular muda; a nota interna (podia ter dado pessoal) some.
    expect((after.snapshot as { holderName: string }).holderName).toBe(SCRUBBED_HOLDER_NAME);
    expect({ ...(after.snapshot as object), holderName: 'x' }).toEqual({
      ...(before.snapshot as object),
      holderName: 'x',
    });
    expect(after.revocationNote).toBeNull();
    expect(after.revocationCategory).toBe('erro_de_emissao');

    // Registro durável FORA do banco: sem nome, sem o código em claro, só o hash.
    const log = new TextDecoder().decode((await storage.read('private', purgeLogKey(made.id)))!);
    expect(JSON.parse(log)).toMatchObject({
      certificateId: made.id,
      codeSha256: await sha256Hex(made.code),
      pdfSha256: made.sha256,
      retentionDays: DAYS,
      objectKey: made.key,
    });
    expect(log).not.toContain('Maria');
    expect(log).not.toContain(made.code);
    expect(storage.contentTypeOf('private', purgeLogKey(made.id))).toBe('application/json');

    const audit = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, made.id));
    expect(audit.map((entry) => entry.action)).toEqual(['certificate.pdf_purged']);
    expect(audit[0]!.actorId).toBeNull();
  });

  it('é idempotente: rodar de novo não faz nada nem duplica a auditoria', async () => {
    storage = createMemoryStorage();
    const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 60) });
    expect((await purge()).purged).toBe(1);
    expect(await purge()).toEqual({ purged: 0, failed: 0 });
    const audit = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, made.id));
    expect(audit).toHaveLength(1);
  });

  it('erro do R2: nada muda no banco, o certificado fica para o ciclo seguinte e a repetição conclui', async () => {
    storage = createMemoryStorage();
    const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 60) });
    storage.failNextDelete = true;
    expect(await purge()).toEqual({ purged: 0, failed: 1 });
    expect((await rowOf(made.id)).pdfKey).toBe(made.key);
    expect((await rowOf(made.id)).pdfPurgedAt).toBeNull();
    expect(await purge()).toEqual({ purged: 1, failed: 0 });
    expect((await rowOf(made.id)).pdfKey).toBeNull();
  });

  it('um que falha não impede os outros do mesmo lote', async () => {
    storage = createMemoryStorage();
    const first = await certificate({ revokedMinutesAgo: inDays(DAYS, 120) });
    const second = await certificate({ revokedMinutesAgo: inDays(DAYS, 60) });
    storage.failNextDelete = true; // derruba o primeiro (o mais antigo é processado antes)
    expect(await purge()).toEqual({ purged: 1, failed: 1 });
    expect((await rowOf(first.id)).pdfKey).toBe(first.key);
    expect((await rowOf(second.id)).pdfKey).toBeNull();
  });

  it('dump restaurado de ANTES da purga (a linha ainda aponta para o PDF, o objeto já não existe): a purga reexecuta e conclui', async () => {
    storage = createMemoryStorage();
    const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 60) });
    await storage.delete('private', made.key!); // o R2 já foi limpo antes do dump ser restaurado
    expect(await purge()).toEqual({ purged: 1, failed: 0 });
    expect((await rowOf(made.id)).pdfPurgedAt).not.toBeNull();
  });

  it('respeita o limite do lote: o resto fica para o ciclo seguinte', async () => {
    storage = createMemoryStorage();
    const made = [
      await certificate({ revokedMinutesAgo: inDays(DAYS, 300) }),
      await certificate({ revokedMinutesAgo: inDays(DAYS, 200) }),
      await certificate({ revokedMinutesAgo: inDays(DAYS, 100) }),
    ];
    expect(await purgeRevokedPdfs(tools.db, storage, { days: DAYS, limit: 2 })).toEqual({
      purged: 2,
      failed: 0,
    });
    expect((await rowOf(made[2]!.id)).pdfKey).toBe(made[2]!.key); // o mais recente fica
    expect(await purge()).toEqual({ purged: 1, failed: 0 });
  });
});

describe('o que a purga NUNCA toca', () => {
  it('certificado válido, substituído e revogado SEM PDF, mesmo antigos; e o REEMITIDO não é purgado junto', async () => {
    storage = createMemoryStorage();
    const valid = await certificate({ status: 'ready' });
    const superseded = await certificate({ status: 'superseded' });
    const noPdf = await certificate({ revokedMinutesAgo: inDays(DAYS, 500), withPdf: false });
    const revoked = await certificate({ revokedMinutesAgo: inDays(DAYS, 500) });
    const successor = await certificate({
      status: 'ready',
      predecessorId: revoked.id,
      userId: revoked.userId,
    });

    expect(await purge()).toEqual({ purged: 1, failed: 0 });
    for (const kept of [valid, superseded, successor]) {
      expect((await rowOf(kept.id)).pdfKey).toBe(kept.key);
      expect(storage.has('private', kept.key!)).toBe(true);
    }
    expect((await rowOf(noPdf.id)).pdfPurgedAt).toBeNull();
    expect((await rowOf(revoked.id)).pdfPurgedAt).not.toBeNull();
  });
});

describe('depois da purga', () => {
  it('a validação pública continua dizendo "revogado" (sem nome, mesmo no modo que mostra o nome); o download some', async () => {
    storage = createMemoryStorage();
    const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 60) });
    await purge();

    const lookup = await lookupPublicCertificate(tools.db, { code: made.code, ip: 'teste-purga' });
    expect(lookup.kind).toBe('found');
    if (lookup.kind !== 'found') return;
    expect(lookup.dto).toMatchObject({
      state: 'revoked',
      courseTitle: 'Curso Demonstrativo',
      issuerName: 'NeuroCapacitar Ltda',
    });
    expect(lookup.dto.holderName).toBeUndefined();
    // Mesmo se o modo do nome mudar um dia, o nome eliminado nunca aparece.
    for (const mode of ['full', 'masked'] as const) {
      const dto = toPublicDto(
        {
          status: 'revoked',
          courseTitle: 'C',
          workloadHours: null,
          issuedAt: new Date(),
          issuerName: 'E',
          holderName: SCRUBBED_HOLDER_NAME,
        },
        mode,
      );
      expect(dto?.holderName).toBeUndefined();
    }

    await expect(
      openCertificateDownload(tools.db, storage, { userId: made.userId, certificateId: made.id }),
    ).rejects.toBeInstanceOf(CertificateNotFoundError);
  });
});

describe('o banco só deixa passar a transição de purga', () => {
  const attempt = (id: string, change: ReturnType<typeof sql>) =>
    tools.db.execute(sql`update certificate set ${change} where id = ${id}::uuid`);

  it('sem purga, o PDF e o nome continuam travados (o que valia antes)', async () => {
    storage = createMemoryStorage();
    const made = await certificate({});
    await expect(attempt(made.id, sql`pdf_key = null, pdf_sha256 = null`)).rejects.toThrow();
    await expect(
      attempt(made.id, sql`snapshot = jsonb_set(snapshot, '{holderName}', '"Outra Pessoa"')`),
    ).rejects.toThrow();
  });

  it('purgar só vale para REVOGADO, com o nome exatamente "[removido]", o SHA-256 igual e nada mais mudado no snapshot', async () => {
    storage = createMemoryStorage();
    const valid = await certificate({ status: 'ready' });
    await expect(attempt(valid.id, sql`pdf_key = null, pdf_purged_at = now()`)).rejects.toThrow();

    const revoked = await certificate({});
    const scrub = sql`jsonb_set(snapshot, '{holderName}', '"[removido]"')`;
    // nome errado
    await expect(
      attempt(
        revoked.id,
        sql`pdf_key = null, pdf_purged_at = now(), snapshot = jsonb_set(snapshot, '{holderName}', '"Outro"')`,
      ),
    ).rejects.toThrow();
    // mexe em outro campo do snapshot junto
    await expect(
      attempt(
        revoked.id,
        sql`pdf_key = null, pdf_purged_at = now(), snapshot = jsonb_set(${scrub}, '{courseTitle}', '"Outro curso"')`,
      ),
    ).rejects.toThrow();
    // SHA-256 trocado
    await expect(
      attempt(
        revoked.id,
        sql`pdf_key = null, pdf_sha256 = 'abc', pdf_purged_at = now(), snapshot = ${scrub}`,
      ),
    ).rejects.toThrow();
    // sem apagar a chave
    await expect(
      attempt(revoked.id, sql`pdf_purged_at = now(), snapshot = ${scrub}`),
    ).rejects.toThrow();
    expect((await rowOf(revoked.id)).pdfPurgedAt).toBeNull();
  });

  it('depois de purgado é definitivo: não volta atrás, não ganha PDF, não muda o snapshot, não se apaga a linha', async () => {
    storage = createMemoryStorage();
    const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 60) });
    await purge();
    await expect(attempt(made.id, sql`pdf_purged_at = null`)).rejects.toThrow();
    await expect(attempt(made.id, sql`pdf_key = 'certificates/novo.pdf'`)).rejects.toThrow();
    await expect(
      attempt(made.id, sql`snapshot = jsonb_set(snapshot, '{holderName}', '"Volta o nome"')`),
    ).rejects.toThrow();
    await expect(attempt(made.id, sql`status = 'ready'`)).rejects.toThrow();
    await expect(
      tools.db.execute(sql`delete from certificate where id = ${made.id}::uuid`),
    ).rejects.toThrow();
  });
});

describe('o job do Cron (certificate.purge_revoked_pdf)', () => {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async head(key: string) {
      const found = objects.get(key);
      return found ? { size: found.length } : null;
    },
    async get(key: string) {
      const found = objects.get(key);
      return found
        ? { size: found.length, body: null, arrayBuffer: async () => found.buffer.slice(0) }
        : null;
    },
    async put(key: string, body: Uint8Array) {
      objects.set(key, body.slice());
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  const job = createCronJobs({}).find(
    (candidate) => candidate.name === 'certificate.purge_revoked_pdf',
  )!;
  const context = (retention: string | undefined, withR2 = true) => {
    const alerts: { code: string }[] = [];
    return {
      alerts,
      value: {
        db: tools.db,
        env: {
          ...(withR2 ? { MEDIA_PRIVATE: bucket, MEDIA_PUBLIC: bucket } : {}),
          ...(retention === undefined ? {} : { REVOKED_PDF_RETENTION_DAYS: retention }),
        } as never,
        alert: (event: { code: string }) => void alerts.push(event),
        owner: 'teste',
      },
    };
  };

  it('está na lista de jobs do Cron', () => {
    expect(job).toBeDefined();
  });

  it.each([undefined, '', '   '])(
    'variável %j (prazo não definido pelo advogado): o job NEM ACORDA e nada é apagado, nem alerta',
    async (retention) => {
      storage = createMemoryStorage();
      const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 60 * 24 * 10) });
      const { value, alerts } = context(retention);
      expect(await job.probe!(value)).toBe(false);
      expect(alerts).toEqual([]);
      expect((await rowOf(made.id)).pdfKey).toBe(made.key);
    },
  );

  it.each(['abc', '0', '-1', '90 dias'])(
    'valor inválido %j: não assume prazo nenhum, não apaga nada e ALERTA',
    async (retention) => {
      storage = createMemoryStorage();
      const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 60 * 24 * 10) });
      const { value, alerts } = context(retention);
      expect(await job.probe!(value)).toBe(false);
      expect(alerts).toEqual([{ code: 'revoked_pdf_retention_invalid' }]);
      expect((await rowOf(made.id)).pdfKey).toBe(made.key);
    },
  );

  it('prazo válido mas sem R2 neste ambiente: não há o que apagar, o job não acorda', async () => {
    storage = createMemoryStorage();
    await certificate({ revokedMinutesAgo: inDays(DAYS, 60) });
    expect(await job.probe!(context('90', false).value)).toBe(false);
  });

  it('prazo válido, R2 e certificado vencido: a sonda diz que há trabalho, o job purga e a sonda seguinte diz que não há mais', async () => {
    storage = createMemoryStorage();
    objects.clear();
    const made = await certificate({ revokedMinutesAgo: inDays(DAYS, 60) });
    objects.set(made.key!, made.bytes);
    const { value } = context('90');
    expect(await job.probe!(value)).toBe(true);
    expect(await job.run(value)).toEqual({ count: 1 });
    expect(objects.has(made.key!)).toBe(false);
    expect(objects.has(purgeLogKey(made.id))).toBe(true);
    expect((await rowOf(made.id)).pdfPurgedAt).not.toBeNull();
    expect(await job.probe!(value)).toBe(false);
  });
});
