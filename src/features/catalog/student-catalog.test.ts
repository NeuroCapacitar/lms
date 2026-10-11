import { describe, expect, it } from 'vitest';

import type { PublicCourseDto } from './catalog';
import { richTextFromParagraph, type RichText } from '../content/rich-text';
import {
  catalogSearchSchema,
  filterCatalog,
  normalizeForSearch,
  richTextToPlain,
  summarize,
  toCatalogCourse,
  type CatalogCourseDto,
} from './student-catalog';

const offer = (over: Partial<PublicCourseDto['offers'][number]> = {}) => ({
  id: 'o1',
  name: 'Oferta',
  kind: 'paid' as const,
  priceCents: 19_700,
  accessMonths: 12,
  maxInstallments: 12,
  ...over,
});
const course = (over: Partial<PublicCourseDto> = {}): PublicCourseDto => ({
  slug: 'curso',
  sequenceMode: 'guided',
  acquirable: true,
  content: { title: 'Curso', description: richTextFromParagraph('Texto.'), workloadHours: 3 },
  offers: [offer()],
  ...over,
});

describe('richTextToPlain e summarize', () => {
  const doc: RichText = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Título' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Uma ' },
          { type: 'text', text: 'palavra', marks: [{ type: 'bold' }] },
          { type: 'hardBreak' },
          { type: 'text', text: 'depois' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item 1' }] }],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item 2' }] }],
          },
        ],
      },
    ],
  } as unknown as RichText;

  it('junta blocos e itens com espaço, sem HTML nem marcas', () => {
    expect(richTextToPlain(doc)).toBe('Título Uma palavra depois item 1 item 2');
    expect(richTextToPlain(null)).toBe('');
  });

  it('texto que parece HTML continua texto', () => {
    expect(richTextToPlain(richTextFromParagraph('<script>alert(1)</script>'))).toBe(
      '<script>alert(1)</script>',
    );
  });

  it('corta em limite de palavra com reticências só quando passa do limite', () => {
    const long = richTextFromParagraph('palavra '.repeat(60).trim());
    const cut = summarize(long, 50);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(51);
    expect(cut).not.toMatch(/palav…$/);
    expect(summarize(richTextFromParagraph('curto'), 50)).toBe('curto');
  });
});

describe('toCatalogCourse', () => {
  it('mostra título publicado, resumo, carga e a oferta aberta, sem id de oferta', () => {
    const dto = toCatalogCourse(course())!;
    expect(dto).toEqual({
      slug: 'curso',
      title: 'Curso',
      summary: 'Texto.',
      workloadHours: 3,
      sequenceMode: 'guided',
      availability: 'open',
      offer: { kind: 'paid', priceCents: 19_700, accessMonths: 12, maxInstallments: 12 },
    });
    expect(JSON.stringify(dto)).not.toContain('"id"');
  });

  it('sem currículo publicado não entra (nulo)', () => {
    expect(toCatalogCourse(course({ content: null, acquirable: false }))).toBeNull();
  });

  it('sem oferta aberta (pausada ou arquivada já vêm fora) fica encerrado e sem oferta', () => {
    const dto = toCatalogCourse(course({ offers: [], acquirable: false }))!;
    expect(dto.availability).toBe('closed');
    expect(dto.offer).toBeNull();
  });

  it('com várias ofertas abertas destaca a mais barata (gratuita primeiro)', () => {
    const dto = toCatalogCourse(
      course({
        offers: [
          offer({ priceCents: 30_000 }),
          offer({ kind: 'free', priceCents: 0, accessMonths: 3 }),
        ],
      }),
    )!;
    expect(dto.offer).toMatchObject({ kind: 'free', priceCents: 0 });
  });
});

describe('busca e filtro', () => {
  const list: CatalogCourseDto[] = [
    {
      slug: 'a',
      title: 'Neurociência aplicada',
      summary: 'Atenção e memória',
      workloadHours: null,
      sequenceMode: 'free',
      availability: 'open',
      offer: null,
    },
    {
      slug: 'b',
      title: 'Introdução',
      summary: 'Conceitos básicos',
      workloadHours: 2,
      sequenceMode: 'guided',
      availability: 'closed',
      offer: null,
    },
  ];

  it('normaliza acentos e caixa', () => {
    expect(normalizeForSearch('  NeuroCIÊNCIA ')).toBe('neurociencia');
  });

  it('busca no título e no resumo sem depender de acento', () => {
    expect(filterCatalog(list, { busca: 'ciencia', filtro: 'todos' }).map((c) => c.slug)).toEqual([
      'a',
    ]);
    expect(filterCatalog(list, { busca: 'BASICOS', filtro: 'todos' }).map((c) => c.slug)).toEqual([
      'b',
    ]);
    expect(filterCatalog(list, { busca: 'nada', filtro: 'todos' })).toEqual([]);
  });

  it('filtra por abertos e encerrados', () => {
    expect(filterCatalog(list, { busca: '', filtro: 'abertos' }).map((c) => c.slug)).toEqual(['a']);
    expect(filterCatalog(list, { busca: '', filtro: 'encerrados' }).map((c) => c.slug)).toEqual([
      'b',
    ]);
  });
});

describe('catalogSearchSchema', () => {
  it('aplica padrões e nunca rejeita a URL', () => {
    expect(catalogSearchSchema.parse({})).toEqual({ busca: '', filtro: 'todos' });
    expect(catalogSearchSchema.parse({ busca: 'x'.repeat(200), filtro: 'zzz' })).toEqual({
      busca: '',
      filtro: 'todos',
    });
    expect(catalogSearchSchema.parse({ busca: 'abc', filtro: 'abertos' })).toEqual({
      busca: 'abc',
      filtro: 'abertos',
    });
    expect(catalogSearchSchema.parse({ busca: 42 })).toEqual({ busca: '', filtro: 'todos' });
  });
});
