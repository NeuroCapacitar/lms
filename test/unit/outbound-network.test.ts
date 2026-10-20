import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * M9-04, SSRF: INVENTÁRIO das chamadas de rede de SAÍDA do Worker. Nenhuma pode montar o destino a partir de dado da
 * requisição (URL, cabeçalho, corpo). A prova é estrutural: os arquivos que fazem `fetch` são uma lista FECHADA, cada um com o
 * motivo, e os clientes de provedores NÃO importam o Hono (nunca enxergam a requisição). Um arquivo novo com `fetch` derruba
 * este teste: quem o criou escreve aqui de onde vem o destino. Vídeo: a URL da pessoa só é lida por adapter que valida o host
 * (contrato dos adapters), e nenhum adapter de vídeo faz chamada de saída hoje.
 */
const ROOT = fileURLToPath(new URL('../../src/server', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'))
      out.push(path);
  }
  return out;
}

const relative = (path: string) => path.slice(ROOT.length + 1).replaceAll('\\', '/');

/** Quem faz chamada de rede e de onde vem o DESTINO. */
const OUTBOUND: Record<string, string> = {
  'app.ts':
    'ASSETS.fetch: o binding dos arquivos estáticos do próprio Worker (URL interna, só o caminho "/")',
  'catalog/course-page.ts': 'ASSETS.fetch: a casca da SPA do próprio Worker',
  'index.ts': 'entrada do Worker (app.fetch, não é chamada de saída)',
  'auth/turnstile.ts': 'https://challenges.cloudflare.com/turnstile/v0/siteverify (constante)',
  'email/resend.ts': 'https://api.resend.com/emails (constante)',
  'email/mailer.ts': 'https://api.resend.com/emails (constante)',
  'email/verify-templates.ts':
    'https://api.resend.com/templates/<alias do contrato> (constante + alias fixo)',
  'commerce/asaas-client.ts':
    'base do Asaas vinda do AMBIENTE (ASAAS_API_BASE_URL), caminhos fixos',
  'commerce/asaas-refund.ts': 'base do Asaas vinda do AMBIENTE, caminhos fixos',
  'commerce/payment-reader.ts':
    'base do Asaas vinda do AMBIENTE, caminhos com id do próprio provedor',
  'ops/sentry-alert.ts': 'DSN do AMBIENTE (SENTRY_DSN), só https, endpoint de envelopes do projeto',
};

/** Clientes de provedores: não podem importar o Hono (nunca recebem a requisição, logo não montam destino com ela). */
const REQUEST_AGNOSTIC = Object.keys(OUTBOUND).filter(
  (file) => file !== 'app.ts' && file !== 'index.ts' && file !== 'catalog/course-page.ts',
);

/** Uma CHAMADA (`fetch(`, `fetcher(`, `(x ?? fetch)(`), não a simples passagem de um `fetchImpl` de teste. */
const NETWORK_CALL = /\bfetch\(|\bfetcher\(|\?\? fetch\)\(/;

describe('chamadas de rede de saída (SSRF)', () => {
  const files = sourceFiles(ROOT);

  it('só os arquivos da lista fazem chamada de rede, e todo arquivo da lista ainda existe', () => {
    const callers = files
      .filter((path) => NETWORK_CALL.test(readFileSync(path, 'utf8')))
      .map(relative)
      .sort();
    const unexpected = callers.filter((file) => !(file in OUTBOUND));
    expect(
      unexpected,
      `chamada de rede fora da lista (escreva de onde vem o destino): ${unexpected.join(', ')}`,
    ).toEqual([]);
    const gone = Object.keys(OUTBOUND).filter((file) => !files.map(relative).includes(file));
    expect(gone, `arquivos da lista que não existem mais: ${gone.join(', ')}`).toEqual([]);
  });

  it('os clientes dos provedores nunca importam o Hono nem leem a requisição', () => {
    for (const file of REQUEST_AGNOSTIC) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect(text, `${file} importa o Hono`).not.toMatch(/from 'hono/);
      expect(text, `${file} lê a requisição`).not.toMatch(
        /\bc\.req\b|\.req\.(url|header|json|query)/,
      );
    }
  });

  it('nenhum destino é um endereço interno ou de metadados (a lista de hosts constantes é só de provedores públicos)', () => {
    const hosts = new Set<string>();
    for (const path of files) {
      for (const match of readFileSync(path, 'utf8').matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g))
        hosts.add(match[1]!);
    }
    for (const host of hosts) {
      expect(host, host).not.toMatch(
        /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0)/,
      );
      expect(host, host).not.toMatch(/^(metadata\.|169\.254\.169\.254)/);
    }
  });
});
