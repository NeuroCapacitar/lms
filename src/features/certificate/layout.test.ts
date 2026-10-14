import { describe, expect, it } from 'vitest';

import {
  FIELD_IDS,
  PAGE,
  canPublishLayout,
  certificateLayoutSchema,
  defaultLayout,
  fieldOf,
  fitFontSize,
  layoutProblems,
  type CertificateLayout,
} from './layout';

const clone = (): CertificateLayout => structuredClone(defaultLayout());
const edit = (layout: CertificateLayout, id: (typeof FIELD_IDS)[number], patch: object) =>
  Object.assign(fieldOf(layout, id), patch);

describe('modelo padrão', () => {
  it('é válido, tem os 9 campos uma vez cada e não tem nenhum problema', () => {
    const layout = defaultLayout();
    expect(certificateLayoutSchema.safeParse(layout).success).toBe(true);
    expect(layout.fields.map((field) => field.id).sort()).toEqual([...FIELD_IDS].sort());
    expect(layoutProblems(layout)).toEqual([]);
    expect(canPublishLayout(layout)).toBe(true);
  });
});

describe('schema', () => {
  it('recusa campo faltando, duplicado, desconhecido e atributo extra', () => {
    const missing = clone();
    missing.fields.pop();
    expect(certificateLayoutSchema.safeParse(missing).success).toBe(false);

    const duplicated = clone();
    duplicated.fields[1] = { ...duplicated.fields[0]! };
    expect(certificateLayoutSchema.safeParse(duplicated).success).toBe(false);

    const unknown = clone() as any;
    unknown.fields[0].id = 'html';
    expect(certificateLayoutSchema.safeParse(unknown).success).toBe(false);

    const extra = clone() as any;
    extra.fields[0].style = 'position:fixed';
    expect(certificateLayoutSchema.safeParse(extra).success).toBe(false);
    expect(certificateLayoutSchema.safeParse({ ...clone(), extra: 1 }).success).toBe(false);
  });

  it('recusa número inválido (NaN, Infinity, negativo, gigante), cor, peso, alinhamento e fonte fora da lista', () => {
    for (const patch of [
      { x: Number.NaN },
      { y: Number.POSITIVE_INFINITY },
      { x: -1 },
      { w: 4 },
      { h: 1000 },
      { fontSize: 5 },
      { fontSize: 200 },
      { color: 'red' },
      { color: '#12345' },
      { color: 'url(javascript:alert(1))' },
      { weight: 450 },
      { align: 'justify' },
      { fontFamily: 'Comic Sans' },
    ]) {
      const layout = clone();
      edit(layout, 'holderName', patch);
      expect(certificateLayoutSchema.safeParse(layout).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it('campo de texto sem atributo de texto é recusado; imagem não precisa deles', () => {
    const layout = clone() as any;
    delete layout.fields.find((field: any) => field.id === 'body').fontSize;
    expect(certificateLayoutSchema.safeParse(layout).success).toBe(false);
    const signature = fieldOf(defaultLayout(), 'signature');
    expect(signature.fontSize).toBeUndefined();
  });
});

describe('problemas do layout', () => {
  it('campo fora da página é ERRO e impede publicar', () => {
    const layout = clone();
    edit(layout, 'title', { x: 200, w: 150 });
    expect(layoutProblems(layout)).toContainEqual({
      code: 'out_of_page',
      fieldId: 'title',
      severity: 'error',
    });
    expect(canPublishLayout(layout)).toBe(false);
  });

  it('campo sobre a moldura de 3 mm é ERRO', () => {
    const layout = clone();
    edit(layout, 'title', { x: 1 });
    expect(layoutProblems(layout)).toContainEqual({
      code: 'inside_frame',
      fieldId: 'title',
      severity: 'error',
    });
    expect(canPublishLayout(layout)).toBe(false);
  });

  it('sobreposição é AVISO e não impede publicar', () => {
    const layout = clone();
    edit(layout, 'intro', { y: 56 });
    const problems = layoutProblems(layout);
    expect(problems).toContainEqual({
      code: 'overlap',
      fieldId: 'intro',
      otherId: 'holderName',
      severity: 'warning',
    });
    expect(canPublishLayout(layout)).toBe(true);
  });

  it('caixa pequena demais para o pior nome é AVISO de estouro (medido com o nome mais longo)', () => {
    const layout = clone();
    edit(layout, 'holderName', { w: 40, h: 8 });
    expect(layoutProblems(layout)).toContainEqual({
      code: 'text_overflow',
      fieldId: 'holderName',
      severity: 'warning',
    });
  });

  it('a página tem o tamanho do A4 paisagem', () => {
    expect(PAGE).toEqual({ width: 297, height: 210 });
  });
});

describe('ajuste do corpo', () => {
  const box = { w: 253, h: 26, fontSize: 32 };

  it('texto curto mantém o corpo escolhido', () => {
    expect(fitFontSize('Ana Souza', box)).toEqual({ fontSize: 32, fits: true });
  });

  it('texto longo diminui, mas nunca abaixo de 55% do escolhido', () => {
    const long = fitFontSize('A'.repeat(120), box);
    expect(long.fontSize).toBeLessThan(32);
    expect(long.fontSize).toBeGreaterThanOrEqual(32 * 0.55 - 0.01);
  });

  it('texto que não cabe nem no menor corpo devolve fits=false', () => {
    expect(fitFontSize('A'.repeat(400), { w: 30, h: 6, fontSize: 20 }).fits).toBe(false);
  });

  it('é determinístico e respeita quebras de linha', () => {
    expect(fitFontSize('a\nb\nc\nd', { w: 100, h: 10, fontSize: 12 })).toEqual(
      fitFontSize('a\nb\nc\nd', { w: 100, h: 10, fontSize: 12 }),
    );
    expect(fitFontSize('a\nb\nc\nd', { w: 100, h: 10, fontSize: 12 }).fontSize).toBeLessThan(12);
  });
});
