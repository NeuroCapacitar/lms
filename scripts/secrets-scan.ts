/**
 * Roda o Gitleaks no histórico do repositório, como o CI (versão fixada no workflow).
 * Se o binário não estiver no PATH, avisa e pula (use GITLEAKS_REQUIRED=1 para falhar).
 * Instalação: release oficial gitleaks/gitleaks, conferindo o checksum do release.
 */
import { spawnSync } from 'node:child_process';

const shell = process.platform === 'win32';
const probe = spawnSync('gitleaks', ['version'], { shell, encoding: 'utf8' });

if (probe.status !== 0) {
  const message = 'gitleaks não encontrado no PATH (instale a v8.30.1 do release oficial).';
  if (process.env.GITLEAKS_REQUIRED === '1') {
    console.error(`ERRO: ${message}`);
    process.exit(1);
  }
  console.warn(`AVISO: ${message} Etapa PULADA localmente; o CI sempre executa.`);
  process.exit(0);
}

const scan = spawnSync(
  'gitleaks',
  ['git', '--no-banner', '--redact', '--log-opts=--full-history HEAD', '.'],
  {
    stdio: 'inherit',
    shell,
  },
);
process.exit(scan.status ?? 1);
