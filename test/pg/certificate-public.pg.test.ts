import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import type { PageMeta } from '../../src/features/catalog/course-meta.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import {
  createCertificateRenderHandler,
  type CertificateRenderer,
} from '../../src/server/certificate/certificate-store.ts';
import {
  PUBLIC_LOOKUP_LIMIT,
  lookupPublicCertificate,
  publicCertificateRoutes,
  serveCertificatePage,
} from '../../src/server/certificate/public-routes.ts';
import { saveIssuer } from '../../src/server/certificate/signer-store.ts';
import { completeLesson } from '../../src/server/learning/completion.ts';
import { enableCertificates } from '../helpers/certificate-template.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M7-08 em Postgres 18 real: a validação pública do certificado. Uma resposta IDÊNTICA para código malformado,
 * inexistente, na fila ou com falha; o DTO é fechado (nenhum dado pessoal, nota interna, caminho ou link do PDF); o
 * estado revogado/substituído aparece na hora; limite por IP; meta tags `noindex` sem eco do código recebido.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://hub.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
const LATE = new Date('2026-10-30T12:00:00.000Z');
const REQUIRED = [
  'Boas-vindas',
  'Como estudar aqui',
  'Conceito central',
  'Revisão',
  'Próximos passos',
];
const NAME = 'Maria Aparecida de Nazaré Souza';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  await tools.db.execute(
    sql`truncate table auth_throttle, certificate, certificate_template, certificate_policy, certificate_signatory, certificate_issuer, email_message, media_reference, media_asset, outbox_message, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.profile);
  await tools.db.delete(schema.user);
});

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
  }) as unknown as Env;

const get = (code: string, ip = '203.0.113.7') =>
  publicCertificateRoutes().request(
    `/certificates/${encodeURIComponent(code)}`,
    { headers: { 'cf-connecting-ip': ip } },
    env(),
  );

const okRenderer: CertificateRenderer = {
  async render({ certificateId, code }) {
    return { pdfKey: `certificates/${certificateId}/${code}.pdf`, pdfSha256: 'a'.repeat(64) };
  },
};

async function issued() {
  seq += 1;
  const fixture = await createDemoCourse(tools.db);
  const adminId = `admin-${seq}-${crypto.randomUUID()}`;
  await tools.db
    .insert(schema.user)
    .values({ id: adminId, name: 'Admin', email: `${adminId}@example.test` });
  await saveIssuer(tools.db, {
    actorId: adminId,
    legalName: 'Neuro Capacitar LTDA',
    cnpj: '11222333000181',
  });
  await enableCertificates(tools.db, { actorId: adminId, courseId: fixture.courseId });
  const userId = `aluna-${seq}-${crypto.randomUUID()}`;
  await tools.db.insert(schema.user).values({
    id: userId,
    name: NAME,
    email: `${userId}@segredo-pessoal.example.test`,
  });
  await tools.db
    .update(schema.profile)
    .set({ certificateName: NAME })
    .where(eq(schema.profile.userId, userId));
  await grantEntitlement(tools.db, {
    userId,
    courseId: fixture.courseId,
    offerId: fixture.offerId,
    source: 'free_offer',
    sourceRef: `free:${userId}:${fixture.offerId}:0`,
    accessMonths: 12,
    startsAt: T0,
    grantedBy: userId,
  });
  const rows = await tools.db
    .select({ id: schema.lesson.id, title: schema.lesson.title })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, fixture.courseId));
  const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.id]));
  for (const title of REQUIRED) {
    await completeLesson(tools.db, { userId, lessonId: byTitle[title]!, clock: () => LATE });
  }
  const [row] = await tools.db
    .select()
    .from(schema.certificate)
    .where(eq(schema.certificate.userId, userId));
  return { certificateId: row!.id, code: row!.code, userId, adminId };
}

const render = (certificateId: string) =>
  createCertificateRenderHandler({ renderer: okRenderer })({
    db: tools.db,
    payload: { certificateId },
    intentId: crypto.randomUUID(),
    correlationId: `certificate:${certificateId}`,
    idempotencyKey: `certificate:${certificateId}`,
    attempt: 1,
  });

async function ready() {
  const base = await issued();
  await render(base.certificateId);
  return base;
}

const PUBLIC_KEYS = ['courseTitle', 'issuedAt', 'issuerName', 'state', 'workloadHours'];

describe('GET /api/public/certificates/:code', () => {
  it('certificado pronto: DTO FECHADO, sem sessão, sem cache e sem indexação', async () => {
    const { code } = await ready();
    const response = await get(code);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
    expect(body).toMatchObject({
      state: 'valid',
      issuerName: expect.any(String),
      courseTitle: expect.any(String),
    });
  });

  it('o DTO nunca carrega nome, e-mail, id de pessoa, código do certificado, caminho ou hash do PDF, nota ou motivo', async () => {
    const { code, userId, certificateId } = await ready();
    const text = JSON.stringify(await (await get(code)).json());
    for (const forbidden of [
      NAME,
      'Maria',
      'segredo-pessoal',
      userId,
      certificateId,
      code,
      'certificates/',
      'a'.repeat(64),
      'cpf',
      'pdf',
    ]) {
      expect(text.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('revogado e substituído aparecem NA HORA como tais (sem cache); a nota interna não vaza', async () => {
    const { code, certificateId } = await ready();
    await tools.db.execute(
      sql`update certificate set status = 'revoked', revoked_at = now(), revocation_category = 'fraud_suspected', revocation_note = 'NOTA INTERNA SECRETA' where id = ${certificateId}`,
    );
    const revoked = await get(code);
    expect(revoked.status).toBe(200);
    const body = await revoked.json();
    expect(body).toMatchObject({ state: 'revoked' });
    expect(JSON.stringify(body)).not.toContain('SECRETA');
    expect(JSON.stringify(body)).not.toContain('fraud');

    const second = await ready();
    await tools.db.execute(
      sql`update certificate set status = 'superseded' where id = ${second.certificateId}`,
    );
    expect(await (await get(second.code)).json()).toMatchObject({ state: 'superseded' });
  });

  it('código malformado, inexistente, na fila e com falha: a MESMA resposta (404 e corpo idênticos)', async () => {
    const queued = await issued();
    const failed = await issued();
    await tools.db.execute(
      sql`update certificate set status = 'rendering' where id = ${failed.certificateId}`,
    );
    await tools.db.execute(
      sql`update certificate set status = 'failed', failure_code = 'x' where id = ${failed.certificateId}`,
    );
    const responses = await Promise.all([
      get('curto'),
      get('X'.repeat(22)),
      get('../../etc/passwd'),
      get("' or 1=1 --"),
      get(queued.code),
      get(failed.code),
      get('PRT-NAO-EXISTE-123'),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.text()));
    for (const response of responses) expect(response.status).toBe(404);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toEqual({ error: { code: 'not_found' } });
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-robots-tag')).toBe('noindex');
    }
  });

  it('limite por IP: depois do máximo, 429; outro IP não é afetado', async () => {
    const { code } = await ready();
    for (let i = 0; i < PUBLIC_LOOKUP_LIMIT.max; i += 1) {
      expect((await get(code, '198.51.100.9')).status).toBe(200);
    }
    const blocked = await get(code, '198.51.100.9');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: { code: 'rate_limited' } });
    expect((await get(code, '198.51.100.10')).status).toBe(200);
  });
});

describe('página /certificados/:code (meta tags)', () => {
  const SHELL = () => Promise.resolve(new Response('<html><head><title>Hub</title></head></html>'));
  type Captured = { meta: PageMeta; status: number };

  async function page(path: string, ip = '203.0.113.7') {
    const captured: Captured[] = [];
    const errors: unknown[] = [];
    const response = await serveCertificatePage(
      new Request(`${BASE_URL}${path}`, { headers: { 'cf-connecting-ip': ip } }),
      env(),
      {
        shell: SHELL,
        lookup: (code, address) => lookupPublicCertificate(tools.db, { code, ip: address }),
        inject: (shell, meta, status) => {
          captured.push({ meta, status });
          return new Response(shell.body, { status });
        },
        onError: (error) => errors.push(error),
      },
    );
    return { response, captured: captured[0], errors };
  }

  it('certificado válido: 200, noindex, título do estado e canônica; sem nome do titular no modo padrão', async () => {
    const { code } = await ready();
    const { response, captured } = await page(`/certificados/${code}`);
    expect(response.status).toBe(200);
    expect(captured?.meta.noindex).toBe(true);
    expect(captured?.meta.title).toBe('Certificado válido | NeuroCapacitar');
    expect(captured?.meta.canonical).toBe(`${BASE_URL}/certificados/${code}`);
    expect(captured?.meta.description).not.toContain('Maria');
    expect(captured?.meta.description).toContain('certificado de conclusão do curso');
  });

  it('revogado muda o título; desconhecido, malformado e na fila: 404 com a MESMA meta genérica, sem eco do código', async () => {
    const { code, certificateId } = await ready();
    await tools.db.execute(
      sql`update certificate set status = 'revoked', revoked_at = now(), revocation_category = 'other', revocation_note = 'x1234' where id = ${certificateId}`,
    );
    expect((await page(`/certificados/${code}`)).captured?.meta.title).toBe(
      'Certificado revogado | NeuroCapacitar',
    );
    const queued = await issued();
    const unknown = await page('/certificados/' + 'Z'.repeat(22));
    const malformed = await page('/certificados/%3Cscript%3E');
    const inQueue = await page(`/certificados/${queued.code}`);
    for (const result of [unknown, malformed, inQueue]) {
      expect(result.response.status).toBe(404);
      expect(result.captured?.meta).toEqual(unknown.captured?.meta);
      expect(result.captured?.meta.canonical).toBe(`${BASE_URL}/`);
      expect(JSON.stringify(result.captured?.meta)).not.toContain('Z'.repeat(22));
      expect(JSON.stringify(result.captured?.meta)).not.toContain('<script');
    }
  });

  it('excesso de consultas: 429 com meta genérica; caminho que não é /certificados/:code devolve a SPA como está', async () => {
    const { code } = await ready();
    for (let i = 0; i < PUBLIC_LOOKUP_LIMIT.max; i += 1)
      await page(`/certificados/${code}`, '192.0.2.50');
    const limited = await page(`/certificados/${code}`, '192.0.2.50');
    expect(limited.response.status).toBe(429);
    expect(limited.captured?.meta.canonical).toBe(`${BASE_URL}/`);
    const other = await page('/certificados/a/b');
    expect(other.captured).toBeUndefined();
  });
});
