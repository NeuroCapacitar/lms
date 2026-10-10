import { spawnSync } from 'node:child_process';

import { ENVIRONMENTS, isEnvironmentName } from './environments.ts';
import { runPreflight } from './preflight.ts';

/**
 * Constrói o Worker para um ambiente. CLOUDFLARE_ENV é definido AQUI, antes do build do
 * Vite Plugin (depois do build ele não tem efeito), e o artefato é conferido pelo preflight.
 */
const environment = process.argv[2] ?? '';
if (!isEnvironmentName(environment) || environment === 'dev') {
  console.error(`ambiente inválido: "${environment}" (use staging ou production)`);
  process.exit(1);
}

const cloudflareEnv = ENVIRONMENTS[environment].cloudflareEnv;
const build = spawnSync('bunx', ['vite', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, CLOUDFLARE_ENV: cloudflareEnv ?? '' },
});
if (build.status !== 0) {
  console.error('build falhou');
  process.exit(build.status ?? 1);
}

const problems = runPreflight(environment);
if (problems.length > 0) {
  for (const problem of problems) console.error(`PREFLIGHT FALHOU: ${problem}`);
  process.exit(1);
}
console.log(`build de "${environment}" concluído e aprovado no preflight`);
