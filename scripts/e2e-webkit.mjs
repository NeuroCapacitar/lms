// Roda os specs do PWA/offline no WebKit do Playwright (M8-04, item B2). Liga `E2E_WEBKIT` de forma portável (Windows e Linux).
// Um worker por padrão: o WebKit do Playwright no Windows oscila (um teste diferente por rodada) com vários workers em paralelo e passa
// 100% em sequência (o último argumento vence: `--workers=4` sobrescreve). Antes, uma vez: `bunx playwright install webkit` (download à parte).
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'bun',
  ['x', 'playwright', 'test', '--project=webkit', '--workers=1', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, E2E_WEBKIT: '1' },
  },
);
process.exit(result.status ?? 1);
