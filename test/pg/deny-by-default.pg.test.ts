import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/server/app.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-04 em Postgres 18 real: NEGADO POR PADRÃO. Cada rota registrada no Worker de verdade (`createApp`), chamada SEM sessão e com
 * Origin válida, ou é pública por uma razão escrita aqui, ou responde 401. Rota nova que esqueça o portão de sessão derruba este
 * teste; rota pública nova precisa entrar na lista com o motivo. (As rotas `/api/staff/*` têm a prova própria, por capacidade, em
 * `staff-matrix.pg.test.ts`; aqui basta que também não respondam sem sessão.)
 */
const ORIGIN = 'https://app.example.test';
const SOME_ID = '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

/** Pública de propósito: a rota → por quê, e os status aceitáveis SEM sessão. */
const PUBLIC: Record<string, { why: string; statuses: number[] }> = {
  'GET /api/health/live': { why: 'saúde superficial, sem dado', statuses: [200] },
  'GET /api/health/ready': {
    why: 'consulta o banco, sem detalhe na resposta',
    statuses: [200, 503],
  },
  'GET /api/auth/options': {
    why: 'métodos de entrada disponíveis, sem dado de pessoa',
    statuses: [200],
  },
  'GET /api/public/help': { why: 'FAQ publicada (página de ajuda pública)', statuses: [200] },
  'GET /api/public/login-media': { why: 'imagens do login publicadas', statuses: [200] },
  'GET /api/public/courses/:slug': {
    why: 'vitrine do curso publicado (404 igual para o que não existe)',
    statuses: [404],
  },
  'GET /api/public/certificates/:code': {
    why: 'validação pública mínima por código opaco (404 igual)',
    statuses: [404],
  },
  'POST /api/auth/sign-out': {
    why: 'só apaga a sessão que vier no cookie; sem cookie não faz nada',
    statuses: [200],
  },
  'POST /api/auth/link/request': {
    why: 'pedido de link (Turnstile, limites e resposta genérica)',
    statuses: [400],
  },
  'POST /api/auth/link/confirm': {
    why: 'confirmação do link no clique (token no corpo)',
    statuses: [400],
  },
  'POST /api/auth/password/sign-in': {
    why: 'entrada por senha (Turnstile e limites)',
    statuses: [400],
  },
  // Rotas nativas do Better Auth: FECHADAS de propósito (só o fluxo próprio do Hub vale).
  'GET /api/auth/callback/google': {
    why: 'fechada: o retorno do Google é tratado pelo fluxo do Hub',
    statuses: [404],
  },
  'GET /api/auth/magic-link/verify': {
    why: 'fechada: o link só vale pelo clique em /entrar/confirmar',
    statuses: [404],
  },
  'HEAD /api/auth/magic-link/verify': { why: 'fechada', statuses: [404] },
  'POST /api/auth/magic-link/verify': { why: 'fechada', statuses: [404] },
  'GET /api/auth/sign-in/magic-link': { why: 'fechada', statuses: [404] },
  'HEAD /api/auth/sign-in/magic-link': { why: 'fechada', statuses: [404] },
  'POST /api/auth/sign-in/magic-link': { why: 'fechada', statuses: [404] },
  'POST /api/auth/google/start': { why: 'fechada sem o Google configurado', statuses: [404] },
};

/** Autenticadas por OUTRO meio (provas próprias em outros testes): só se confere que continuam registradas. */
const ELSEWHERE = [
  'POST /api/webhooks/asaas', // token próprio em tempo constante (asaas-webhook.pg.test.ts)
  'POST /api/webhooks/resend', // assinatura Svix (resend-webhook.pg.test.ts)
  'GET /certificados/*', // casca da SPA da validação pública
  'GET /cursos/*', // casca da SPA com meta tags do curso público
];

let database: TestSchema;
beforeAll(async () => {
  database = await createTestSchema();
}, 120_000);
afterAll(async () => {
  await database.drop();
});

const app = () =>
  createApp({ auth: { emailSender: createFakeEmailSender(), isStaffEmail: async () => false } });
const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: ORIGIN,
    BETTER_AUTH_SECRET: 'segredo-de-teste-somente-local-0123456789abcdef',
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;

function registered(): { method: string; path: string }[] {
  const seen = new Set<string>();
  const routes: { method: string; path: string }[] = [];
  for (const route of app().routes) {
    if (route.method === 'ALL') continue;
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method: route.method, path: route.path });
  }
  return routes;
}

describe('negado por padrão: toda rota registrada, sem sessão', () => {
  it('as listas de exceção não têm entrada velha (toda rota citada existe)', () => {
    const keys = new Set(registered().map((route) => `${route.method} ${route.path}`));
    const stale = [...Object.keys(PUBLIC), ...ELSEWHERE].filter((key) => !keys.has(key));
    expect(stale, `entradas sem rota registrada: ${stale.join(', ')}`).toEqual([]);
  });

  it('toda rota que não é pública responde 401 sem sessão; as públicas respondem só o que foi escrito', async () => {
    const wrong: string[] = [];
    let denied = 0;
    for (const route of registered()) {
      const key = `${route.method} ${route.path}`;
      if (ELSEWHERE.includes(key)) continue;
      const path = route.path.replaceAll(/:[A-Za-z]+/g, SOME_ID).replaceAll('*', 'x');
      const response = await app().request(
        path,
        {
          method: route.method,
          headers: { origin: ORIGIN, 'content-type': 'application/json' },
          ...(route.method === 'GET' || route.method === 'HEAD' ? {} : { body: '{}' }),
        },
        env(),
      );
      const exception = PUBLIC[key];
      if (exception) {
        if (!exception.statuses.includes(response.status))
          wrong.push(
            `${key}: pública, esperava ${exception.statuses.join('/')} e veio ${response.status}`,
          );
      } else if (response.status !== 401) {
        wrong.push(
          `${key}: NÃO é pública e respondeu ${response.status} sem sessão (esperado 401)`,
        );
      } else denied += 1;
    }
    expect(wrong).toEqual([]);
    // Prova de que o teste olhou para muita coisa (não passa por estar vazio).
    expect(denied).toBeGreaterThan(100);
  }, 120_000);

  it('uma sessão forjada (cookie inventado) também é 401 em qualquer rota protegida', async () => {
    const forged = {
      origin: ORIGIN,
      cookie: 'better-auth.session_token=forjado; __Secure-better-auth.session_token=forjado',
    };
    for (const path of [
      '/api/me',
      '/api/me/access',
      '/api/catalog/courses',
      '/api/staff/operations',
      '/api/staff/privacy/incidents',
    ]) {
      const response = await app().request(path, { headers: forged }, env());
      expect(response.status, path).toBe(401);
    }
  });
});
