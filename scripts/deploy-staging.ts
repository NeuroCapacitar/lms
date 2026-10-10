import { spawnSync } from 'node:child_process';

/**
 * Publica o Worker de STAGING a partir do commit atual (M0-08). Nunca publica Production.
 * Recusa árvore suja ou commit que não esteja no GitHub, para que o SHA no ar seja rastreável.
 * Sem `CI`, usa o perfil `neurocapacitar` do Wrangler (ADR 0025); no CI, o token da conta do
 * projeto vem do ambiente (`CLOUDFLARE_API_TOKEN`).
 */
function run(command: string, args: string[], options: { capture?: boolean } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`falhou: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
  return (result.stdout ?? '').trim();
}

const dirty = run('git', ['status', '--porcelain'], { capture: true });
if (dirty) {
  console.error(
    'árvore de trabalho suja: faça commit antes de publicar (o SHA precisa ser rastreável)',
  );
  process.exit(1);
}
const sha = run('git', ['rev-parse', 'HEAD'], { capture: true });
const remote = run('git', ['branch', '-r', '--contains', sha], { capture: true });
if (!remote) {
  console.error(`o commit ${sha} não está no GitHub: faça push antes de publicar`);
  process.exit(1);
}

if (!process.env.VITE_SENTRY_DSN) {
  console.warn('AVISO: VITE_SENTRY_DSN ausente; o SPA sai sem relatório de erros');
}

run('bun', ['scripts/build-env.ts', 'staging']);

const wranglerArgs = ['x', 'wrangler', 'deploy'];
if (!process.env.CI) wranglerArgs.push('--profile', 'neurocapacitar');
run('bun', wranglerArgs);

console.log(
  `\npublicado: hub-staging em ${sha}\nvalide com: bun scripts/smoke.ts <url do workers.dev> ${sha}`,
);
