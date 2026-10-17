import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Linguagem neutra (M9-08, passo 5): o texto que a pessoa LÊ na interface não usa "aluno", "inscrito" nem "bem-vindo" no masculino
 * genérico ("Boas-vindas", "Pessoas inscritas", "Sua inscrição está ativa"). Varre os textos visíveis (literais e texto de JSX) de
 * `src/web`; comentários e identificadores internos (tudo minúsculo, sem espaço) não contam.
 */
const FORBIDDEN = /\b(alunos?|alunas?|inscritos?|bem-vind[oa]s?)\b/i;
const INTERNAL_ID = /^[a-z][a-z0-9-]*$/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    const isCode = /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name);
    return isCode && name !== 'routeTree.gen.ts' ? [path] : [];
  });
}

/** Tira comentários de bloco e de linha (só os que começam a linha ou vêm depois de espaço, para não cortar URLs em literais). */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

/** Candidatos a texto visível: literais entre aspas e texto solto entre `>` e `<` do JSX. */
function visibleTexts(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1|>([^<>{}]+)</g)) {
    const text = (match[2] ?? match[3] ?? '').trim();
    if (text) found.push(text);
  }
  return found;
}

const flagged = (code: string) =>
  visibleTexts(withoutComments(code)).filter(
    (text) => !INTERNAL_ID.test(text) && FORBIDDEN.test(text),
  );

describe('linguagem neutra na interface', () => {
  it('nenhum texto visível usa aluno, inscrito ou bem-vindo no masculino genérico', () => {
    const offenders: string[] = [];
    for (const file of [...sources('src/web'), ...sources('src/features')]) {
      for (const text of flagged(readFileSync(file, 'utf8'))) {
        offenders.push(`${file}: ${text.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('o próprio guarda detecta o que deve', () => {
  it('pega texto de JSX e literais com o termo no masculino genérico', () => {
    expect(flagged('<h2>Inscritos (4)</h2>')).toEqual(['Inscritos (4)']);
    expect(flagged("const m = 'Ver como aluno';")).toEqual(['Ver como aluno']);
    expect(flagged('const m = "Você está inscrito";')).toEqual(['Você está inscrito']);
    expect(flagged('<p>Seja bem-vindo!</p>')).toEqual(['Seja bem-vindo!']);
    expect(flagged('<p>Alunas e alunos</p>')).toEqual(['Alunas e alunos']);
  });

  it('não pega comentário, identificador interno nem o texto neutro', () => {
    expect(flagged("// Ver como aluno\n/* Inscritos */\nconst id = 'inscritos-titulo';")).toEqual(
      [],
    );
    expect(flagged('<h2>Pessoas inscritas (4)</h2>')).toEqual([]);
    expect(flagged('<h1>Boas-vindas</h1>')).toEqual([]);
  });
});
