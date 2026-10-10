import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { contrastRatio, parseColor } from '../helpers/color.ts';

const css = readFileSync('src/web/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Extrai o corpo `{ ... }` que começa logo após `selector {`, sem chaves aninhadas. */
function blockAfter(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`seletor não encontrado em tokens.css: ${selector}`);
  }
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (match[1] && match[2]) {
      map.set(match[1], match[2].trim());
    }
  }
  return map;
}

/** Todos os blocos `:root { ... }` simples: marca, tema claro e componentes. */
function rootBlocks(): Map<string, string> {
  const merged = new Map<string, string>();
  let cursor = 0;
  for (;;) {
    const start = css.indexOf(':root {', cursor);
    if (start < 0) {
      break;
    }
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    for (const [name, value] of declarations(css.slice(open + 1, close))) {
      merged.set(name, value);
    }
    cursor = close;
  }
  return merged;
}

const light = rootBlocks();
const darkForced = declarations(blockAfter(css, ":root[data-theme='dark']"));
const mediaStart = css.indexOf('@media (prefers-color-scheme: dark)');
const darkSystem = declarations(blockAfter(css.slice(mediaStart), ':root:not([data-theme])'));

type Theme = 'light' | 'dark';

function resolve(theme: Theme, name: string, depth = 0): string {
  if (depth > 8) {
    throw new Error(`referência circular em ${name}`);
  }
  const raw = (theme === 'dark' ? darkForced.get(name) : undefined) ?? light.get(name);
  if (raw === undefined) {
    throw new Error(`token não declarado: ${name}`);
  }
  const reference = /^var\((--[\w-]+)\)$/.exec(raw);
  return reference?.[1] ? resolve(theme, reference[1], depth + 1) : raw;
}

function ratio(theme: Theme, foreground: string, background: string): number {
  return contrastRatio(
    parseColor(resolve(theme, foreground)),
    parseColor(resolve(theme, background)),
  );
}

// WCAG 2.2 AA: 4,5:1 para texto; 3:1 para componentes de interface e indicador de foco.
const TEXT = 4.5;
const UI = 3;
const PAIRS: Array<[foreground: string, background: string, minimum: number]> = [
  ['--text-default', '--surface-page', TEXT],
  ['--text-default', '--surface-raised', TEXT],
  ['--text-muted', '--surface-page', TEXT],
  ['--text-muted', '--surface-raised', TEXT],
  ['--text-link', '--surface-page', TEXT],
  ['--text-link', '--surface-raised', TEXT],
  ['--text-danger', '--surface-page', TEXT],
  ['--text-danger', '--surface-raised', TEXT],
  ['--text-success', '--surface-page', TEXT],
  ['--text-success', '--surface-raised', TEXT],
  ['--button-primary-fg', '--button-primary-bg', TEXT],
  ['--button-secondary-fg', '--button-secondary-bg', TEXT],
  ['--input-fg', '--input-bg', TEXT],
  ['--input-placeholder', '--input-bg', TEXT],
  ['--field-label', '--surface-page', TEXT],
  ['--field-description', '--surface-page', TEXT],
  ['--field-error', '--surface-page', TEXT],
  ['--link-fg', '--surface-page', TEXT],
  ['--input-border', '--input-bg', UI],
  ['--input-border', '--surface-page', UI],
  ['--button-secondary-border', '--button-secondary-bg', UI],
  ['--button-secondary-border', '--surface-page', UI],
  ['--focus-ring', '--surface-page', UI],
  ['--focus-ring', '--surface-raised', UI],
];

describe.each<Theme>(['light', 'dark'])('contraste WCAG 2.2 AA no tema %s', (theme) => {
  it.each(PAIRS)('%s sobre %s ≥ %s:1', (foreground, background, minimum) => {
    const value = ratio(theme, foreground, background);
    expect(
      value,
      `${foreground} sobre ${background} no tema ${theme}: ${value.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(minimum);
  });
});

describe('estrutura dos tokens', () => {
  it('o tema escuro do sistema repete exatamente o tema escuro forçado', () => {
    expect(Object.fromEntries(darkSystem)).toEqual(
      Object.fromEntries(
        [...darkForced].filter(([name]) => name !== 'color-scheme' && name.startsWith('--')),
      ),
    );
  });

  it('camadas: funcional referencia só marca; componente referencia só funcional', () => {
    const functional = /^--(surface|text|action|border|focus)-/;
    const component = /^--(button|input|field|link)-/;
    for (const [name, value] of light) {
      if (functional.test(name)) {
        expect(value, name).toMatch(/^var\(--brand-[\w-]+\)$/);
      } else if (component.test(name)) {
        expect(value, name).toMatch(/^var\(--(surface|text|action|border|focus)-[\w-]+\)$/);
      } else if (name.startsWith('--brand-')) {
        expect(value, name).toMatch(/^oklch\(/);
      }
    }
    for (const [name, value] of darkForced) {
      expect(functional.test(name), name).toBe(true);
      expect(value, name).toMatch(/^var\(--brand-[\w-]+\)$/);
    }
  });

  it('não há cor fora das camadas de tokens nem fonte externa', () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/Geist/i);
  });
});
