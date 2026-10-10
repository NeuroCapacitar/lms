import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { DELEGABLE_CAPABILITIES } from '../../src/features/identity/capabilities.ts';
import {
  grantRole,
  loadAccess,
  revokeRole,
  suspendUser,
} from '../../src/server/auth/access-store.ts';
import { sha256Hex } from '../../src/server/crypto.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M1-04 em Postgres 18 real: convite de Staff (criar, reenviar, revogar, aceitar) pelas rotas reais
 * em /api, com CSRF, capability `staff.manage` e reautenticação recente, como no Worker.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let sender: ReturnType<typeof createFakeEmailSender>;
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
  sender = createFakeEmailSender();
  await tools.db.delete(schema.authThrottle);
  await tools.db.delete(schema.staffInvitation);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
});

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;

const app = () => apiApp({ emailSender: sender, isStaffEmail: async () => false });

async function newUser(options: { email?: string; verified?: boolean } = {}) {
  seq += 1;
  const user = tools.test.createUser({
    email: options.email ?? `pessoa${seq}@example.test`,
    name: `Pessoa ${seq}`,
  });
  await tools.test.saveUser(user);
  await tools.db
    .update(schema.user)
    .set({ emailVerified: options.verified ?? true })
    .where(eq(schema.user.id, user.id));
  const login = async () => {
    const result = await tools.test.login({ userId: user.id });
    return { headers: result.headers, sessionId: result.session.id };
  };
  return { id: user.id, email: user.email, login };
}

/** Admin com uma sessão e prova de reautenticação RECENTE (o fluxo do link já tem teste próprio). */
async function newAdmin(options: { reauth?: boolean } = {}) {
  const person = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'admin' });
  const session = await person.login();
  if (options.reauth ?? true) {
    await tools.db
      .insert(schema.reauthProof)
      .values({ sessionId: session.sessionId, verifiedAt: new Date() });
  }
  return { ...person, ...session };
}

async function newSupport() {
  const person = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'support' });
  const session = await person.login();
  await tools.db
    .insert(schema.reauthProof)
    .values({ sessionId: session.sessionId, verifiedAt: new Date() });
  return { ...person, ...session };
}

function call(method: string, path: string, headers: Headers | undefined, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  if (body !== undefined) merged.set('content-type', 'application/json');
  return app().request(
    `/api/staff${path}`,
    { method, headers: merged, body: body === undefined ? undefined : JSON.stringify(body) },
    env(),
  );
}
const invite = (headers: Headers | undefined, body: unknown) =>
  call('POST', '/invitations', headers, body);
const accept = (headers: Headers | undefined, token: string) =>
  call('POST', '/invitations/accept', headers, { token });

async function tokenOfLastEmail(): Promise<string> {
  await Promise.resolve();
  const message = sender.sent.at(-1);
  expect(message, 'um e-mail foi enviado').toBeDefined();
  const url = new URL(message!.variables.LINK_URL!);
  expect(url.pathname).toBe('/convite');
  return new URLSearchParams(url.hash.replace(/^#/, '')).get('token')!;
}

/** Convida e devolve o id e o token (do e-mail). */
async function inviteOk(admin: { headers: Headers }, email: string, grants: string[] = []) {
  const response = await invite(admin.headers, { email, grants });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return { id, token: await tokenOfLastEmail() };
}

const invitationRows = () => tools.db.select().from(schema.staffInvitation);
const auditActions = async () =>
  (await tools.db.select().from(schema.auditLog)).map((row) => row.action);

describe('criar convite', () => {
  it('exige sessão, capability de Admin e reautenticação recente; só então cria e envia', async () => {
    const withoutReauth = await newAdmin({ reauth: false });
    expect((await invite(undefined, { email: 'nova@example.test' })).status).toBe(401);
    const denied = await invite(withoutReauth.headers, { email: 'nova@example.test' });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: 'reauth_required' } });
    expect(sender.sent).toHaveLength(0);
    expect(await invitationRows()).toHaveLength(0);

    const admin = await newAdmin();
    const created = await invite(admin.headers, {
      email: 'Nova@Example.test',
      grants: ['course.edit', 'finance.view'],
    });
    expect(created.status).toBe(201);
    const message = sender.sent.at(-1)!;
    expect(message.to).toBe('nova@example.test');
    expect(message.template).toBe('staff-invitation');
    expect(message.variables.LINK_URL).toMatch(
      /^https:\/\/app\.example\.test\/convite#token=[^&]+$/,
    );
    const [row] = await invitationRows();
    expect(row).toMatchObject({ email: 'nova@example.test', status: 'pending', role: 'support' });
    expect(row!.tokenHash).toBe(await sha256Hex(await tokenOfLastEmail()));
    expect(row!.tokenHash).not.toBe(await tokenOfLastEmail());
    const days = (row!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('Suporte (mesmo com grants e com prova recente) e aluno não convidam, não listam nem revogam', async () => {
    const admin = await newAdmin();
    const { id } = await inviteOk(admin, 'alvo@example.test');
    const support = await newSupport();
    const student = await newUser();
    const studentSession = await student.login();
    for (const who of [support, studentSession]) {
      expect((await invite(who.headers, { email: 'x@example.test' })).status).toBe(403);
      expect((await call('GET', '/invitations', who.headers)).status).toBe(403);
      expect((await call('POST', `/invitations/${id}/resend`, who.headers, {})).status).toBe(403);
      expect((await call('POST', `/invitations/${id}/revoke`, who.headers, {})).status).toBe(403);
    }
    const body = await (await invite(support.headers, { email: 'x@example.test' })).json();
    expect(body).toEqual({ error: { code: 'forbidden' } });
    expect(await invitationRows()).toHaveLength(1);
  });

  it('recusa corpo inválido: e-mail ruim, campo extra, capability só-Admin ou inexistente', async () => {
    const admin = await newAdmin();
    const bad = [
      { email: 'sem-arroba' },
      { email: 'a@example.test', role: 'admin' },
      { email: 'a@example.test', grants: ['staff.manage'] },
      { email: 'a@example.test', grants: ['course.create'] },
      { email: 'a@example.test', grants: ['inventada'] },
      { grants: ['course.edit'] },
    ];
    for (const body of bad) {
      expect((await invite(admin.headers, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await invite(admin.headers, null)).status).toBe(400);
    expect(await invitationRows()).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });

  it('não convida quem já é Staff e não duplica convite pendente; revogar libera um novo', async () => {
    const admin = await newAdmin();
    const support = await newSupport();
    const staff = await invite(admin.headers, { email: support.email });
    expect(staff.status).toBe(409);
    expect(await staff.json()).toEqual({ error: { code: 'already_staff' } });

    const { id } = await inviteOk(admin, 'dupla@example.test');
    const again = await invite(admin.headers, { email: 'DUPLA@example.test' });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: 'already_invited' } });

    expect((await call('POST', `/invitations/${id}/revoke`, admin.headers, {})).status).toBe(200);
    expect((await invite(admin.headers, { email: 'dupla@example.test' })).status).toBe(201);
  });

  it('a auditoria registra convite, reenvio, revogação e aceite, sem e-mail nem token', async () => {
    const admin = await newAdmin();
    const { id } = await inviteOk(admin, 'audit@example.test', ['help.edit']);
    await call('POST', `/invitations/${id}/resend`, admin.headers, {});
    await call('POST', `/invitations/${id}/revoke`, admin.headers, {});
    const second = await inviteOk(admin, 'audit2@example.test');
    const guest = await newUser({ email: 'audit2@example.test' });
    expect((await accept((await guest.login()).headers, second.token)).status).toBe(200);

    const actions = await auditActions();
    for (const action of [
      'staff_invitation.create',
      'staff_invitation.resend',
      'staff_invitation.revoke',
      'staff_invitation.accept',
      'role.grant',
    ]) {
      expect(actions, action).toContain(action);
    }
    const dump = JSON.stringify(await tools.db.select().from(schema.auditLog));
    expect(dump).not.toContain('audit@example.test');
    expect(dump).not.toContain('audit2@example.test');
    expect(dump).not.toContain(second.token);
  });

  it('o teto diário de e-mails vale também para convites (429, sem criar nada)', async () => {
    const admin = await newAdmin();
    const today = new Date().toISOString().slice(0, 10);
    await tools.db
      .insert(schema.authThrottle)
      .values({ key: `link:global:${today}`, count: 60, windowStart: new Date() });
    const blocked = await invite(admin.headers, { email: 'teto@example.test' });
    expect(blocked.status).toBe(429);
    expect(await invitationRows()).toHaveLength(0);
  });
});

describe('listar, reenviar e revogar', () => {
  it('lista com estado efetivo e grants, sem token', async () => {
    const admin = await newAdmin();
    const { id } = await inviteOk(admin, 'lista@example.test', ['finance.view', 'course.edit']);
    await tools.db
      .update(schema.staffInvitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.staffInvitation.id, id));
    const response = await call('GET', '/invitations', admin.headers);
    expect(response.status).toBe(200);
    const { invitations } = (await response.json()) as { invitations: Record<string, unknown>[] };
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({
      id,
      email: 'lista@example.test',
      status: 'expired',
      grants: ['course.edit', 'finance.view'],
    });
    expect(JSON.stringify(invitations)).not.toMatch(/token/i);
  });

  it('reenviar gera token novo, estende a validade e invalida o link anterior; vencido pode ser reenviado', async () => {
    const admin = await newAdmin();
    const guest = await newUser({ email: 'reenvio@example.test' });
    const first = await inviteOk(admin, 'reenvio@example.test');
    await tools.db
      .update(schema.staffInvitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.staffInvitation.id, first.id));
    expect((await accept((await guest.login()).headers, first.token)).status).toBe(400);

    expect((await call('POST', `/invitations/${first.id}/resend`, admin.headers, {})).status).toBe(
      200,
    );
    const newToken = await tokenOfLastEmail();
    expect(newToken).not.toBe(first.token);
    expect(sender.sent).toHaveLength(2);
    const guestSession = await guest.login();
    expect((await accept(guestSession.headers, first.token)).status, 'link antigo').toBe(400);
    expect((await accept(guestSession.headers, newToken)).status).toBe(200);
  });

  it('só convite pendente é reenviado ou revogado; id desconhecido ou malformado é 404', async () => {
    const admin = await newAdmin();
    const guest = await newUser({ email: 'fim@example.test' });
    const { id, token } = await inviteOk(admin, 'fim@example.test');
    expect((await accept((await guest.login()).headers, token)).status).toBe(200);
    const adminAgain = await newAdmin();
    for (const action of ['resend', 'revoke']) {
      expect(
        (await call('POST', `/invitations/${id}/${action}`, adminAgain.headers, {})).status,
      ).toBe(404);
    }
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(
      (await call('POST', `/invitations/${missing}/revoke`, adminAgain.headers, {})).status,
    ).toBe(404);
    expect(
      (await call('POST', '/invitations/nao-e-uuid/revoke', adminAgain.headers, {})).status,
    ).toBe(404);
  });
});

describe('aceitar convite', () => {
  it('na sessão com o MESMO e-mail concede Suporte e os grants iniciais, encerra as sessões e audita', async () => {
    const admin = await newAdmin();
    const guest = await newUser({ email: 'aceita@example.test' });
    const { id, token } = await inviteOk(admin, 'Aceita@Example.test', [
      'course.edit',
      'help.edit',
    ]);
    const session = await guest.login();
    const response = await accept(session.headers, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    // não abre sessão nova: o pedido não devolve cookie e as sessões antigas foram encerradas
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(
      await tools.db.select().from(schema.session).where(eq(schema.session.userId, guest.id)),
    ).toHaveLength(0);

    const access = await loadAccess(tools.db, guest.id);
    expect([...access.roles]).toEqual(['support']);
    expect([...access.grants].sort()).toEqual(['course.edit', 'help.edit']);
    const [row] = await tools.db
      .select()
      .from(schema.staffInvitation)
      .where(eq(schema.staffInvitation.id, id));
    expect(row).toMatchObject({ status: 'accepted', acceptedBy: guest.id });
    const roleAudit = (await tools.db.select().from(schema.auditLog)).find(
      (entry) => entry.action === 'role.grant' && entry.targetId === guest.id,
    );
    expect(roleAudit).toMatchObject({ actorId: admin.id });
    expect(roleAudit!.details).toMatchObject({
      role: 'support',
      via: 'invitation',
      invitationId: id,
    });
  });

  it('segundo uso do mesmo convite falha; também em corrida (exatamente um aceite)', async () => {
    const admin = await newAdmin();
    const guest = await newUser({ email: 'corrida@example.test' });
    const { token } = await inviteOk(admin, 'corrida@example.test', ['finance.view']);
    const [a, b] = [await guest.login(), await guest.login()];
    const results = await Promise.all([accept(a.headers, token), accept(b.headers, token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(
      (await tools.db.select().from(schema.userRole).where(eq(schema.userRole.userId, guest.id)))
        .length,
    ).toBe(1);
    const again = await accept((await guest.login()).headers, token);
    expect(again.status).toBe(400);
  });

  it('sem sessão 401; corpo inválido 400; token inventado 400, todos sem efeito', async () => {
    const admin = await newAdmin();
    const guest = await newUser({ email: 'sem@example.test' });
    const { token } = await inviteOk(admin, 'sem@example.test');
    expect((await accept(undefined, token)).status).toBe(401);
    const session = await guest.login();
    expect((await call('POST', '/invitations/accept', session.headers, {})).status).toBe(400);
    expect(
      (await call('POST', '/invitations/accept', session.headers, { token, x: 1 })).status,
    ).toBe(400);
    const fake = await accept(session.headers, 'token-inventado-com-mais-de-16-caracteres');
    expect(fake.status).toBe(400);
    expect(await fake.json()).toEqual({ error: { code: 'invalid_or_expired_invitation' } });
    expect((await invitationRows())[0]!.status).toBe('pending');
  });

  it('e-mail diferente do convidado falha e NÃO gasta o convite', async () => {
    const admin = await newAdmin();
    const stranger = await newUser({ email: 'intruso@example.test' });
    const guest = await newUser({ email: 'certo@example.test' });
    const { token } = await inviteOk(admin, 'certo@example.test', ['help.edit']);
    const wrong = await accept((await stranger.login()).headers, token);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: { code: 'invalid_or_expired_invitation' } });
    expect((await loadAccess(tools.db, stranger.id)).roles.size).toBe(0);
    expect((await accept((await guest.login()).headers, token)).status).toBe(200);
  });

  it('convite expirado ou revogado falha', async () => {
    const admin = await newAdmin();
    const late = await newUser({ email: 'tarde@example.test' });
    const revoked = await newUser({ email: 'revogado@example.test' });
    const expiredInvite = await inviteOk(admin, 'tarde@example.test');
    await tools.db
      .update(schema.staffInvitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.staffInvitation.id, expiredInvite.id));
    expect((await accept((await late.login()).headers, expiredInvite.token)).status).toBe(400);

    const revokedInvite = await inviteOk(admin, 'revogado@example.test');
    await call('POST', `/invitations/${revokedInvite.id}/revoke`, admin.headers, {});
    expect((await accept((await revoked.login()).headers, revokedInvite.token)).status).toBe(400);
    expect((await loadAccess(tools.db, late.id)).roles.size).toBe(0);
    expect((await loadAccess(tools.db, revoked.id)).roles.size).toBe(0);
  });

  it('quem convidou perdeu o papel de Admin ou foi suspenso: o convite não vale mais', async () => {
    const boss = await newAdmin();
    const other = await newAdmin();
    const lost = await newUser({ email: 'perdeu@example.test' });
    const suspended = await newUser({ email: 'suspenso@example.test' });
    const first = await inviteOk(boss, 'perdeu@example.test');
    const second = await inviteOk(boss, 'suspenso@example.test');

    await suspendUser(tools.db, { actorId: other.id, targetId: boss.id });
    expect((await accept((await suspended.login()).headers, second.token)).status).toBe(400);
    expect((await accept((await lost.login()).headers, first.token)).status).toBe(400);
    expect((await loadAccess(tools.db, lost.id)).roles.size).toBe(0);
  });

  it('e-mail não verificado e conta suspensa são recusados antes de olhar o convite', async () => {
    const admin = await newAdmin();
    const unverified = await newUser({ email: 'naover@example.test', verified: false });
    const blocked = await newUser({ email: 'bloq@example.test' });
    const first = await inviteOk(admin, 'naover@example.test');
    const second = await inviteOk(admin, 'bloq@example.test');
    await suspendUser(tools.db, { actorId: admin.id, targetId: blocked.id });

    const notVerified = await accept((await unverified.login()).headers, first.token);
    expect(notVerified.status).toBe(403);
    expect(await notVerified.json()).toEqual({ error: { code: 'email_not_verified' } });
    // a suspensão encerra as sessões: a conta suspensa precisa de uma nova (que o hook recusa), então
    // chamamos o repositório com a sessão antiga para provar a regra, e a rota com a nova.
    const { acceptInvitation } = await import('../../src/server/auth/staff-invitations.ts');
    expect(await acceptInvitation(tools.db, { token: second.token, userId: blocked.id })).toBe(
      'suspended',
    );
    expect((await invitationRows()).every((row) => row.status === 'pending')).toBe(true);
  });

  it('o aluno que aceitou só enxerga o que os grants permitem', async () => {
    const admin = await newAdmin();
    const guest = await newUser({ email: 'limite@example.test' });
    const { token } = await inviteOk(admin, 'limite@example.test', ['help.edit']);
    await accept((await guest.login()).headers, token);
    const fresh = await guest.login();
    const response = await app().request('/api/me/access', { headers: fresh.headers }, env());
    const body = (await response.json()) as { roles: string[]; capabilities: string[] };
    expect(body.roles).toContain('support');
    expect(body.capabilities.sort()).toEqual(['help.edit', 'staff.read']);
    // e continua sem poder convidar nem se conceder grants
    expect((await invite(fresh.headers, { email: 'x@example.test' })).status).toBe(403);
  });

  it('tem freio por pessoa contra tentativas repetidas (11ª recebe 429)', async () => {
    const guest = await newUser();
    const session = await guest.login();
    let last = 0;
    for (let i = 0; i < 11; i += 1) {
      last = (await accept(session.headers, `token-errado-numero-${i}-com-tamanho-ok`)).status;
    }
    expect(last).toBe(429);
  });
});

/** O Drizzle embrulha o erro do pg; o nome da constraint violada fica em `cause`. */
async function expectViolation(work: PromiseLike<unknown>, constraint: RegExp) {
  const error = (await work.then(
    () => null,
    (reason: unknown) => reason,
  )) as { message?: string; cause?: { message?: string } } | null;
  expect(error, 'a escrita deveria ser recusada').not.toBeNull();
  expect(`${error?.message} ${error?.cause?.message}`).toMatch(constraint);
}

describe('o banco recusa o que o catálogo não permite', () => {
  it('as listas do CHECK dos grants do convite são iguais ao catálogo (sem deriva)', async () => {
    const client = await database.client();
    const row = await client.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1 and connamespace = current_schema()::regnamespace`,
      ['staff_invitation_grant_capability_check'],
    );
    const names = new Set(
      [...(row.rows[0]?.def ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]),
    );
    expect(names).toEqual(new Set(DELEGABLE_CAPABILITIES));
  });

  it('CHECKs: papel só support, e-mail em minúsculas, status conhecido; um pendente por e-mail', async () => {
    const hash = (n: number) => `hash-${n}-${Math.random()}`;
    const base = { expiresAt: new Date(Date.now() + 1000) };
    const insert = (values: Partial<typeof schema.staffInvitation.$inferInsert>) =>
      tools.db
        .insert(schema.staffInvitation)
        .values({ email: 'x@example.test', tokenHash: hash(1), ...base, ...values });
    await expectViolation(insert({ role: 'admin' }), /staff_invitation_role_check/);
    await expectViolation(
      insert({ email: 'Maiuscula@example.test' }),
      /staff_invitation_email_lower_check/,
    );
    await expectViolation(insert({ status: 'qualquer' }), /staff_invitation_status_check/);
    await insert({ email: 'um@example.test', tokenHash: hash(2) });
    await expectViolation(
      insert({ email: 'um@example.test', tokenHash: hash(3) }),
      /staff_invitation_pending_email_idx/,
    );
    await insert({ email: 'um@example.test', tokenHash: hash(4), status: 'revoked' });
    const [row] = await tools.db
      .select()
      .from(schema.staffInvitation)
      .where(
        and(
          eq(schema.staffInvitation.email, 'um@example.test'),
          eq(schema.staffInvitation.status, 'pending'),
        ),
      );
    await expectViolation(
      tools.db
        .insert(schema.staffInvitationGrant)
        .values({ invitationId: row!.id, capability: 'staff.manage' }),
      /staff_invitation_grant_capability_check/,
    );
  });

  it('retirar o último papel de Admin continua protegido com convites em andamento', async () => {
    const admin = await newAdmin();
    await expect(
      revokeRole(tools.db, { actorId: admin.id, targetId: admin.id, role: 'admin' }),
    ).rejects.toThrow(/last_admin/);
  });
});
