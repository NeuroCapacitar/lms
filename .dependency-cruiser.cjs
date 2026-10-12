/**
 * Regras de arquitetura (AGENTS.md §5). Rodam sobre src/ com o extrator swc (ADR 0026): sob
 * TypeScript 7 o extrator `tsc` do dependency-cruiser ainda não funciona. O aviso
 * "missing-typescript-transpiler" é cosmético até o TypeScript 7.1 publicar a API.
 */
const PERSISTENCE = '^(src/db/|node_modules/(pg|drizzle-orm|drizzle-kit)/)';
const FRAMEWORKS = '^node_modules/(hono|react|react-dom|@tanstack)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'features-nao-importam-framework-nem-sql',
      comment: 'Regras de domínio não dependem de React, Hono, TanStack, pg, Drizzle nem src/db.',
      severity: 'error',
      from: { path: '^src/features/' },
      to: { path: [FRAMEWORKS, PERSISTENCE] },
    },
    {
      name: 'features-nao-importam-entradas',
      comment: 'Domínio não importa a camada de entrada (src/server) nem a UI (src/web).',
      severity: 'error',
      from: { path: '^src/features/' },
      to: { path: '^src/(server|web)/' },
    },
    {
      name: 'ui-nao-importa-persistencia-nem-segredos',
      comment:
        'A UI não importa persistência, scripts nem o Worker (exceto tipos para o cliente RPC).',
      severity: 'error',
      from: { path: '^src/web/' },
      to: {
        path: [PERSISTENCE, '^scripts/', '^src/server/'],
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'server-nao-importa-ui',
      severity: 'error',
      from: { path: '^src/server/' },
      to: { path: '^src/web/' },
    },
    {
      name: 'db-nao-importa-camadas-acima',
      severity: 'error',
      from: { path: '^src/db/' },
      to: { path: '^src/(server|web|features)/' },
    },
    {
      name: 'acesso-nao-importa-pagamentos',
      comment:
        'O acesso e a inscrição gratuita (M3-01/M3-02) não dependem de pagamento: sem Order, Payment, checkout nem Asaas. A compra paga, no M6, é que chama o acesso, nunca o contrário.',
      severity: 'error',
      from: { path: '^src/(server|features)/access/' },
      to: { path: '^src/(server|features)/(payments|finance|asaas|checkout)/' },
    },
    {
      name: 'sem-dependencia-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    parser: 'swc',
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '[.]gen[.]ts$' },
  },
};
