import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * M9-04, varredura de LOG por dado pessoal e segredo (estática, a cada commit). Todo `console.*` do código de produção está
 * numa lista FECHADA com o que ele escreve; um novo derruba o teste e obriga a escrever por que é seguro. Nenhum pode
 * carregar e-mail, nome, token, senha, cookie, segredo ou o link de acesso, EXCETO as duas linhas de Development
 * (`[dev]`), que só rodam com a origem `localhost` e que o teste também fixa. O resto do log passa pelo evlog, com o
 * `scrub` e a lista de campos proibidos testados em `src/features/observability`.
 */
const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}
const relative = (path: string) => path.slice(SRC.length + 1).replaceAll('\\', '/');

/** Arquivo → quantas chamadas `console.*` e o que elas escrevem. */
const ALLOWED: Record<string, { calls: number; writes: string }> = {
  'server/async/alerts.ts': {
    calls: 1,
    writes: 'JSON com o código do alerta, fila, ids e um código curto (nunca texto de erro)',
  },
  'server/auth/routes.ts': {
    calls: 2,
    writes:
      'JSON com o nome do evento e o TIPO do erro (link_delivery_failed, reauth_delivery_failed)',
  },
  'server/auth/staff-routes.ts': { calls: 1, writes: 'JSON com o nome do evento e o TIPO do erro' },
  'server/auth/turnstile.ts': {
    calls: 1,
    writes: 'JSON com o motivo e os códigos de erro do Turnstile',
  },
  'server/email/factory.ts': {
    calls: 2,
    writes: 'DEV (origem localhost): o link no terminal; e o nome do modelo, sem endereço',
  },
};

const SENSITIVE =
  /e-?mail|\.to\b|token|senha|password|cookie|secret|segredo|authorization|LINK_URL|apiKey/i;

describe('varredura de log por dado pessoal e segredo', () => {
  const files = sourceFiles(SRC);
  const calls = files.flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    return [...text.matchAll(/console\.(log|error|warn|info|debug)\(/g)].map((match) => {
      // O corpo da chamada: do `(` até o fechamento correspondente (balanceando parênteses).
      let depth = 0;
      let end = match.index! + match[0].length - 1;
      for (; end < text.length; end += 1) {
        if (text[end] === '(') depth += 1;
        if (text[end] === ')' && --depth === 0) break;
      }
      return { file: relative(path), body: text.slice(match.index!, end + 1) };
    });
  });

  it('só os arquivos da lista usam console.*, com a contagem exata', () => {
    const counts = new Map<string, number>();
    for (const call of calls) counts.set(call.file, (counts.get(call.file) ?? 0) + 1);
    const actual = Object.fromEntries([...counts].sort());
    const expected = Object.fromEntries(
      Object.entries(ALLOWED).map(([file, value]) => [file, value.calls]),
    );
    expect(actual).toEqual(expected);
  });

  it('nenhuma chamada escreve e-mail, token, senha, cookie ou segredo, salvo a linha de Development que só roda em localhost', () => {
    const offenders = calls.filter(
      (call) => SENSITIVE.test(call.body) && !call.body.includes('[dev] e-mail'),
    );
    expect(offenders.map((call) => `${call.file}: ${call.body.slice(0, 90)}`)).toEqual([]);

    // A linha de Development só existe atrás da checagem de origem localhost.
    const factory = readFileSync(join(SRC, 'server/email/factory.ts'), 'utf8');
    const index = factory.indexOf('[dev] e-mail para');
    expect(index).toBeGreaterThan(0);
    expect(factory.slice(Math.max(0, index - 400), index)).toContain("hostname === 'localhost'");
  });

  it('o código do navegador não escreve nada no console do usuário', () => {
    const web = calls.filter((call) => call.file.startsWith('web/'));
    expect(web.map((call) => call.file)).toEqual([]);
  });
});
