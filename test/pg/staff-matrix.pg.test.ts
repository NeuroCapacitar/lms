import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import {
  ALL_CAPABILITIES,
  DELEGABLE_CAPABILITIES,
  isDelegable,
  type Capability,
} from '../../src/features/identity/capabilities.ts';
import { STAFF_ENDPOINTS, type StaffEndpoint } from '../../src/features/identity/staff-matrix.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-01 (passo 1) em Postgres 18 real: a matriz capacidade × tela × endpoint da Staff é CONFERIDA contra o servidor. Toda rota
 * `/api/staff/*` registrada precisa estar na matriz (e vice-versa), e cada linha é exercitada por CHAMADA DIRETA de API: sem sessão,
 * quem não é da Staff, conta suspensa, Suporte sem o grant e Suporte com OUTRO grant são negados; quem tem a capacidade passa pelo
 * portão; o que exige reautenticação a pede. O corpo enviado é inválido de propósito: o portão vem antes, então "passar" aqui é
 * receber qualquer resposta que não seja uma recusa de autorização (400 e 404 contam).
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const SOME_ID = '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const REFUSALS = new Set(['forbidden', 'account_suspended', 'reauth_required', 'unauthenticated']);

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let application: ReturnType<typeof apiApp>;
let seq = 0;

interface Person {
  headers: Headers;
}
let student: Person;
let suspendedAdmin: Person;
let support: Person;
let admin: Person;
let adminNoReauth: Person;
/** Suporte com UM grant (com e sem a prova de reautenticação), por capacidade delegável. */
const granted = new Map<Capability, { fresh: Person; noReauth: Person }>();

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;

async function newPerson(
  options: {
    role?: 'support' | 'admin';
    grant?: Capability;
    reauth?: boolean;
    suspended?: boolean;
  } = {},
): Promise<Person> {
  seq += 1;
  const user = tools.test.createUser({ email: `matriz${seq}@example.test`, name: `Matriz ${seq}` });
  await tools.test.saveUser(user);
  if (options.role)
    await grantRole(tools.db, { actorId: null, targetId: user.id, role: options.role });
  if (options.grant) {
    await tools.db
      .insert(schema.staffGrant)
      .values({ userId: user.id, capability: options.grant as never, grantedBy: user.id });
  }
  const session = await tools.test.login({ userId: user.id });
  // Suspende DEPOIS de abrir a sessão (o banco recusa criar sessão para conta suspensa): é a sessão já aberta que o servidor nega.
  if (options.suspended) {
    await tools.db.insert(schema.userSuspension).values({ userId: user.id, reason: 'teste' });
  }
  if (options.reauth) {
    await tools.db
      .insert(schema.reauthProof)
      .values({ sessionId: session.session.id, verifiedAt: new Date() });
  }
  return { headers: session.headers };
}

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  application = apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => true });
  student = await newPerson();
  suspendedAdmin = await newPerson({ role: 'admin', suspended: true });
  support = await newPerson({ role: 'support', reauth: true });
  admin = await newPerson({ role: 'admin', reauth: true });
  adminNoReauth = await newPerson({ role: 'admin' });
  for (const capability of DELEGABLE_CAPABILITIES) {
    granted.set(capability, {
      fresh: await newPerson({ role: 'support', grant: capability, reauth: true }),
      noReauth: await newPerson({ role: 'support', grant: capability }),
    });
  }
}, 120_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

/** Chamadas independentes em lotes (cada uma abre a própria conexão): 80 linhas × vários perfis seriam minutos em fila. */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  }
  return out;
}
const BATCH = 8;
const SLOW = 600_000;

type Verdict = 'ok' | 'unauthenticated' | 'forbidden' | 'account_suspended' | 'reauth_required';

/** Chamada direta à API real. `ok` = passou pelo portão de autorização (qualquer outra resposta, inclusive 400/404). */
async function gate(endpoint: StaffEndpoint, person: Person | null): Promise<Verdict> {
  const path = endpoint.path.replace(/:lane\b/, 'general').replace(/:[A-Za-z]+/g, SOME_ID);
  const headers = new Headers(person?.headers);
  headers.set('origin', BASE_URL);
  const hasBody = endpoint.method !== 'GET';
  if (hasBody) headers.set('content-type', 'application/json');
  const response = await application.request(
    path,
    { method: endpoint.method, headers, body: hasBody ? '[]' : undefined },
    env(),
  );
  if (response.status === 401) return 'unauthenticated';
  if (response.status === 403) {
    const code = ((await response.json().catch(() => null)) as { error?: { code?: string } } | null)
      ?.error?.code;
    if (code && REFUSALS.has(code)) return code as Verdict;
  }
  return 'ok';
}

const required = (endpoint: StaffEndpoint): readonly Capability[] =>
  endpoint.requires.kind === 'capability'
    ? [endpoint.requires.capability]
    : endpoint.requires.kind === 'any'
      ? endpoint.requires.capabilities
      : [];

/** Quem TEM a capacidade da linha: o Admin e, se delegável ou `staff.read`, o Suporte certo. */
function holders(endpoint: StaffEndpoint): { fresh: Person; noReauth: Person }[] {
  const result = [{ fresh: admin, noReauth: adminNoReauth }];
  for (const capability of required(endpoint)) {
    if (capability === 'staff.read') result.push({ fresh: support, noReauth: support });
    else if (isDelegable(capability)) result.push(granted.get(capability)!);
  }
  return result;
}

describe('a matriz declarada é a das rotas reais', () => {
  it('toda rota /api/staff/* registrada está na matriz e nenhuma linha da matriz sobra', () => {
    const registered = new Set(
      application.routes
        .filter((route) => route.path.startsWith('/api/staff/') && route.method !== 'ALL')
        .map((route) => `${route.method} ${route.path}`),
    );
    const declared = STAFF_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(new Set(declared).size, 'linha repetida na matriz').toBe(declared.length);
    expect([...registered].filter((key) => !declared.includes(key))).toEqual([]);
    expect(declared.filter((key) => !registered.has(key))).toEqual([]);
  });

  it('só usa capacidades que existem; toda capacidade de Staff aparece na matriz ou está reservada de propósito', () => {
    const used = new Set(STAFF_ENDPOINTS.flatMap((endpoint) => required(endpoint)));
    for (const capability of used) expect(ALL_CAPABILITIES).toContain(capability);
    // Reservadas (sem endpoint próprio hoje): `certificate.template` e
    // `certificate.revoke` usam `staff.manage` como "só Admin" (mesmo efeito, ver docs/spec/staff-matrix.md).
    const reserved = ['certificate.template', 'certificate.revoke'];
    expect(ALL_CAPABILITIES.filter((c) => !used.has(c)).sort()).toEqual(reserved.sort());
  });

  it('o documento docs/spec/staff-matrix.md lista todas as linhas (não diverge do dado)', () => {
    const text = readFileSync(new URL('../../docs/spec/staff-matrix.md', import.meta.url), 'utf8');
    const missing = STAFF_ENDPOINTS.filter(
      (endpoint) => !text.includes(`\`${endpoint.method} ${endpoint.path}\``),
    ).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(missing).toEqual([]);
  });
});

interface Probe {
  endpoint: StaffEndpoint;
  who: string;
  person: Person | null;
  expected: Verdict;
}

/** Roda as sondas em lotes e devolve só as que não deram o veredito esperado. */
async function mismatches(probes: Probe[]): Promise<string[]> {
  const verdicts = await inBatches(probes, BATCH, (probe) => gate(probe.endpoint, probe.person));
  return probes.flatMap((probe, index) =>
    verdicts[index] === probe.expected
      ? []
      : [
          `${probe.endpoint.method} ${probe.endpoint.path} (${probe.who}): esperado ${probe.expected}, veio ${verdicts[index]}`,
        ],
  );
}

const capabilityRows = STAFF_ENDPOINTS.filter((endpoint) => endpoint.requires.kind !== 'session');

describe('cada linha, por chamada direta de API', () => {
  it(
    'sem sessão: 401 em todas',
    async () => {
      const probes = STAFF_ENDPOINTS.map((endpoint) => ({
        endpoint,
        who: 'sem sessão',
        person: null,
        expected: 'unauthenticated' as Verdict,
      }));
      expect(await mismatches(probes)).toEqual([]);
    },
    SLOW,
  );

  it(
    'quem não é da Staff (sem papel) é negado em toda linha de capacidade; o convite só pede sessão',
    async () => {
      const probes = STAFF_ENDPOINTS.map((endpoint) => ({
        endpoint,
        who: 'sem papel',
        person: student,
        expected: (endpoint.requires.kind === 'session' ? 'ok' : 'forbidden') as Verdict,
      }));
      expect(await mismatches(probes)).toEqual([]);
    },
    SLOW,
  );

  it(
    'Admin suspenso: tudo negado, mesmo com papel',
    async () => {
      const probes = capabilityRows.map((endpoint) => ({
        endpoint,
        who: 'Admin suspenso',
        person: suspendedAdmin,
        expected: 'account_suspended' as Verdict,
      }));
      expect(await mismatches(probes)).toEqual([]);
    },
    SLOW,
  );

  it(
    'Suporte SEM grant: passa só onde basta a leitura básica (staff.read); o resto é 403 "forbidden"',
    async () => {
      const probes = capabilityRows.map((endpoint) => ({
        endpoint,
        who: 'Suporte sem grant',
        person: support,
        expected: (required(endpoint).includes('staff.read') ? 'ok' : 'forbidden') as Verdict,
      }));
      expect(await mismatches(probes)).toEqual([]);
    },
    SLOW,
  );

  it(
    'quem tem a capacidade passa pelo portão; um grant de OUTRA capacidade não abre a linha',
    async () => {
      const probes: Probe[] = [];
      for (const endpoint of capabilityRows) {
        for (const { fresh } of holders(endpoint)) {
          probes.push({ endpoint, who: 'titular', person: fresh, expected: 'ok' });
        }
        if (required(endpoint).includes('staff.read')) continue;
        const other = DELEGABLE_CAPABILITIES.find(
          (capability) => !required(endpoint).includes(capability),
        )!;
        probes.push({
          endpoint,
          who: `grant ${other}`,
          person: granted.get(other)!.fresh,
          expected: 'forbidden',
        });
      }
      expect(await mismatches(probes)).toEqual([]);
    },
    SLOW,
  );

  it(
    'ações sensíveis pedem reautenticação RECENTE ao titular (as demais não); o direito é checado antes dela',
    async () => {
      const probes: Probe[] = [];
      for (const endpoint of capabilityRows) {
        for (const { noReauth } of holders(endpoint)) {
          probes.push({
            endpoint,
            who: 'titular sem reautenticação',
            person: noReauth,
            expected: endpoint.reauth ? 'reauth_required' : 'ok',
          });
        }
        if (endpoint.reauth) {
          probes.push({ endpoint, who: 'sem papel', person: student, expected: 'forbidden' });
        }
      }
      expect(await mismatches(probes)).toEqual([]);
    },
    SLOW,
  );
});
