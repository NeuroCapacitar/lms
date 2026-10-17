import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * O script de carga (M9-07, passo 6) NUNCA pode rodar contra Production nem contra nada que não seja o Worker `hub-staging`: a trava
 * está no começo do script e sai com código 2 antes de qualquer requisição.
 */
// Montado por partes para o knip não tratar o caminho como uma importação.
const SCRIPT = ['scripts', 'load-staging.ts'].join('/');

function run(...args: string[]) {
  return spawnSync('bun', [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    shell: process.platform === 'win32',
  });
}

describe('scripts/load-staging.ts recusa o que não é Staging', () => {
  it.each([
    ['Production', 'https://hub-production.neurocapacitar-projetos.workers.dev'],
    ['domínio próprio', 'https://hub.example.com'],
    ['Staging sem https', 'http://hub-staging.neurocapacitar-projetos.workers.dev'],
    ['Staging com prefixo enganoso', 'https://hub-staging.evil.example'],
    ['host que só termina parecido', 'https://nothub-staging.neurocapacitar-projetos.workers.dev'],
  ])('%s', (_name, url) => {
    const result = run(url);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('RECUSADO');
  });

  it('sem endereço mostra o uso e sai com código 2', () => {
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('uso:');
  });
});
