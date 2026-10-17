/**
 * Carga LEVE no Staging (M9-07, passo 6): `bun scripts/load-staging.ts <url-base> [--concurrency 10] [--duration 60] [--warmup 5]`.
 * Só GET, só no Staging, sem dado pessoal. NUNCA contra Production: recusa qualquer endereço que não seja o do Worker `hub-staging`.
 * Limites embutidos (não há flag para passar deles): até 20 requisições simultâneas (o limite de conexões do Hyperdrive de Staging) e
 * 300 s. Por padrão chama só rotas públicas (sem sessão). Para incluir as rotas quentes de quem está logado, passe o cookie de uma
 * conta de teste na variável `LOAD_COOKIE` (nunca na linha de comando e nunca impresso); mesmo assim continua só GET.
 * Imprime, por rota, contagem, erros, vazão e p50, p95, p99 e máximo em milissegundos.
 */
const MAX_CONCURRENCY = 20;
const MAX_DURATION_SECONDS = 300;

const args = process.argv.slice(2);
const baseUrl = args.find((arg) => !arg.startsWith('--'));
function option(name: string, fallback: number): number {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`valor inválido para --${name}`);
    process.exit(2);
  }
  return value;
}
if (!baseUrl) {
  console.error(
    'uso: bun scripts/load-staging.ts <url-base> [--concurrency N] [--duration S] [--warmup S]',
  );
  process.exit(2);
}
const target = new URL(baseUrl);
if (
  !/^hub-staging\.[a-z0-9-]+\.workers\.dev$/.test(target.hostname) ||
  target.protocol !== 'https:'
) {
  console.error(
    'RECUSADO: este script só roda contra o Worker hub-staging (https). Nunca contra Production.',
  );
  process.exit(2);
}
const concurrency = Math.min(option('concurrency', 10), MAX_CONCURRENCY);
const duration = Math.min(option('duration', 60), MAX_DURATION_SECONDS);
const warmup = Math.min(option('warmup', 5), duration);

interface Route {
  name: string;
  path: string;
  weight: number;
  /** Precisa do cookie de uma conta de teste. */
  authenticated?: boolean;
}

const ROUTES: Route[] = [
  { name: 'GET /api/health/live (sem banco)', path: '/api/health/live', weight: 2 },
  { name: 'GET /api/health/ready (banco)', path: '/api/health/ready', weight: 2 },
  { name: 'GET /api/auth/options', path: '/api/auth/options', weight: 2 },
  { name: 'GET /api/public/login-media', path: '/api/public/login-media', weight: 2 },
  {
    name: 'GET /api/public/courses/:slug',
    path: '/api/public/courses/curso-demonstrativo',
    weight: 4,
  },
  { name: 'GET /cursos/:slug (página com SEO)', path: '/cursos/curso-demonstrativo', weight: 3 },
  { name: 'GET / (casca estática)', path: '/', weight: 2 },
  { name: 'GET /api/me/access (logado)', path: '/api/me/access', weight: 3, authenticated: true },
  {
    name: 'GET /api/catalog/courses (logado)',
    path: '/api/catalog/courses',
    weight: 3,
    authenticated: true,
  },
];

const cookie = process.env.LOAD_COOKIE;
const active = ROUTES.filter((route) => !route.authenticated || cookie);
const pool = active.flatMap((route) => Array<Route>(route.weight).fill(route));

interface Sample {
  ms: number;
  ok: boolean;
  /** Código HTTP, ou `rede` quando a requisição nem chegou a ter resposta. */
  status: string;
}
const samples = new Map<string, Sample[]>(active.map((route) => [route.name, []]));
let stop = false;
let counting = false;

async function worker() {
  while (!stop) {
    const route = pool[Math.floor(Math.random() * pool.length)]!;
    const started = performance.now();
    let ok = false;
    let status = 'rede';
    try {
      const response = await fetch(new URL(route.path, target), {
        headers: route.authenticated && cookie ? { cookie } : {},
        signal: AbortSignal.timeout(30_000),
        redirect: 'manual',
      });
      await response.arrayBuffer();
      // 401 sem sessão é resposta esperada das rotas de quem está logado quando o cookie venceu; só 5xx e falha de rede contam como erro.
      status = String(response.status);
      ok = response.status < 500;
    } catch {
      ok = false;
    }
    if (counting) samples.get(route.name)!.push({ ms: performance.now() - started, ok, status });
  }
}

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

console.log(
  `carga leve em ${target.origin}: ${concurrency} simultâneas, ${duration} s (aquecimento ${warmup} s)${cookie ? ', com conta de teste' : ', só rotas públicas'}`,
);
const workers = Array.from({ length: concurrency }, () => worker());
await new Promise((resolve) => setTimeout(resolve, warmup * 1000));
counting = true;
const measuredFrom = performance.now();
await new Promise((resolve) => setTimeout(resolve, (duration - warmup) * 1000));
stop = true;
const seconds = (performance.now() - measuredFrom) / 1000;
await Promise.all(workers);

let total = 0;
let errors = 0;
console.log('\nrota | req | erros | req/s | p50 | p95 | p99 | máx (ms)');
for (const [name, list] of samples) {
  const times = list.map((sample) => sample.ms).sort((a, b) => a - b);
  const bad = list.filter((sample) => !sample.ok).length;
  total += list.length;
  errors += bad;
  console.log(
    `${name} | ${list.length} | ${bad} | ${(list.length / seconds).toFixed(1)} | ${percentile(times, 50).toFixed(0)} | ${percentile(times, 95).toFixed(0)} | ${percentile(times, 99).toFixed(0)} | ${(times.at(-1) ?? 0).toFixed(0)}`,
  );
}
const failures = new Map<string, number>();
for (const list of samples.values()) {
  for (const sample of list) {
    if (!sample.ok) failures.set(sample.status, (failures.get(sample.status) ?? 0) + 1);
  }
}
if (failures.size > 0) {
  console.log(
    `erros por código: ${[...failures].map(([code, count]) => `${code} x${count}`).join(', ')}`,
  );
}
console.log(
  `\ntotal: ${total} requisições em ${seconds.toFixed(0)} s (${(total / seconds).toFixed(1)}/s), ${errors} erros`,
);
process.exit(errors > 0 ? 1 : 0);
