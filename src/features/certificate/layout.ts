import { z } from 'zod';

/**
 * Layout do certificado (M7-03), parte PURA: os campos pré-definidos, a posição de cada um em milímetros sobre a
 * página A4 paisagem e as regras de validade. Não há campo livre nem HTML livre: o Admin só MOVE e AJUSTA campos
 * que existem. O mesmo `fitFontSize` serve ao renderer (PDF) e ao editor (aviso de estouro), então a prévia e o PDF
 * concordam sobre quanto texto cabe.
 */
export const PAGE = { width: 297, height: 210 } as const;

/** Moldura decorativa fixa do modelo (3 mm); os campos ficam dentro dela. */
export const FRAME_MM = 3;

const TEXT_FIELD_IDS = [
  'title',
  'intro',
  'holderName',
  'body',
  'signatory',
  'issuer',
  'code',
] as const;
const IMAGE_FIELD_IDS = ['signature', 'qr'] as const;
export const FIELD_IDS = [...TEXT_FIELD_IDS, ...IMAGE_FIELD_IDS] as const;
export type FieldId = (typeof FIELD_IDS)[number];
export type TextFieldId = (typeof TEXT_FIELD_IDS)[number];

export const FIELD_LABELS: Record<FieldId, string> = {
  title: 'Título',
  intro: 'Abertura',
  holderName: 'Nome do titular',
  body: 'Texto do curso',
  signatory: 'Signatário e cargo',
  issuer: 'Emitente',
  code: 'Código e endereço de validação',
  signature: 'Assinatura',
  qr: 'QR de validação',
};

/** Fontes permitidas (por enquanto só a da marca, embutida no PDF). */
const FONT_FAMILIES = ['Lexend Deca'] as const;
export const WEIGHTS = [300, 400, 500, 600, 700] as const;
export const ALIGNS = ['left', 'center', 'right'] as const;

const mm = z.number().finite().min(0).max(400);

const fieldSchema = z.strictObject({
  id: z.enum(FIELD_IDS),
  x: mm,
  y: mm,
  w: z.number().finite().min(5).max(400),
  h: z.number().finite().min(3).max(400),
  fontSize: z.number().finite().min(6).max(72).optional(),
  weight: z
    .number()
    .refine((value) => (WEIGHTS as readonly number[]).includes(value))
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  align: z.enum(ALIGNS).optional(),
  fontFamily: z.enum(FONT_FAMILIES).optional(),
});
export type LayoutField = z.infer<typeof fieldSchema>;

/** O layout inteiro: EXATAMENTE um de cada campo, cada texto com seus atributos, sem campo desconhecido. */
export const certificateLayoutSchema = z
  .strictObject({
    version: z.literal(1),
    fields: z.array(fieldSchema).length(FIELD_IDS.length),
  })
  .superRefine((layout, ctx) => {
    const seen = new Set<string>();
    layout.fields.forEach((field, index) => {
      if (seen.has(field.id)) {
        ctx.addIssue({ code: 'custom', path: ['fields', index, 'id'], message: 'duplicate_field' });
      }
      seen.add(field.id);
      if ((TEXT_FIELD_IDS as readonly string[]).includes(field.id)) {
        for (const key of ['fontSize', 'weight', 'color', 'align'] as const) {
          if (field[key] === undefined) {
            ctx.addIssue({
              code: 'custom',
              path: ['fields', index, key],
              message: 'text_field_incomplete',
            });
          }
        }
      }
    });
    for (const id of FIELD_IDS) {
      if (!seen.has(id))
        ctx.addIssue({ code: 'custom', path: ['fields'], message: `missing_${id}` });
    }
  });
export type CertificateLayout = z.infer<typeof certificateLayoutSchema>;

export function isTextField(id: FieldId): id is TextFieldId {
  return (TEXT_FIELD_IDS as readonly string[]).includes(id);
}

export function fieldOf(layout: CertificateLayout, id: FieldId): LayoutField {
  const found = layout.fields.find((field) => field.id === id);
  if (!found) throw new Error(`layout_missing_${id}`);
  return found;
}

const text = (
  id: TextFieldId,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  weight: number,
  color: string,
): LayoutField => ({
  id,
  x,
  y,
  w,
  h,
  fontSize,
  weight,
  color,
  align: 'center',
  fontFamily: 'Lexend Deca',
});

/** O modelo padrão (o mesmo desenho do certificado do M7-02). */
export function defaultLayout(): CertificateLayout {
  return {
    version: 1,
    fields: [
      text('title', 22, 20, 253, 16, 26, 600, '#1f3a5f'),
      text('intro', 22, 38, 253, 14, 13, 400, '#1a1a2e'),
      text('holderName', 22, 54, 253, 26, 32, 600, '#1a1a2e'),
      text('body', 31, 84, 235, 40, 14, 400, '#1a1a2e'),
      { id: 'signature', x: 22, y: 142, w: 70, h: 22 },
      text('signatory', 22, 166, 90, 20, 11, 400, '#1a1a2e'),
      text('issuer', 118, 166, 61, 20, 9.5, 400, '#444444'),
      { id: 'qr', x: 224, y: 150, w: 28, h: 28 },
      text('code', 204, 180, 70, 14, 8, 400, '#1a1a2e'),
    ],
  };
}

type LayoutProblemCode = 'out_of_page' | 'inside_frame' | 'overlap' | 'text_overflow';

export interface LayoutProblem {
  code: LayoutProblemCode;
  fieldId: FieldId;
  /** O outro campo, no caso de sobreposição. */
  otherId?: FieldId;
  /** Erros impedem publicar; avisos só informam. */
  severity: 'error' | 'warning';
}

/** Largura média de um caractere, em múltiplos do corpo (Lexend Deca é larga: ~0,62 em). */
const CHAR_EM = 0.62;
const LINE_HEIGHT = 1.25;
const PT_MM = 25.4 / 72;
/** Nunca encolhe abaixo disto do tamanho escolhido; passou, o texto é cortado pela caixa. */
const MIN_SCALE = 0.55;

/** Quantas linhas cabem na caixa e quantas o texto precisa, estimadas pelo comprimento (sem medir fonte). */
function estimate(textValue: string, widthMm: number, heightMm: number, fontSizePt: number) {
  const lineMm = fontSizePt * PT_MM * LINE_HEIGHT;
  const charsPerLine = Math.max(1, Math.floor(widthMm / (fontSizePt * PT_MM * CHAR_EM)));
  const paragraphs = textValue.split('\n');
  const needed = paragraphs.reduce(
    (sum, paragraph) => sum + Math.max(1, Math.ceil([...paragraph].length / charsPerLine)),
    0,
  );
  return { available: Math.max(1, Math.floor(heightMm / lineMm)), needed };
}

/**
 * O corpo (pt) com que o texto cabe na caixa: o escolhido, ou menor (até 55%). Se nem assim cabe, devolve o menor e
 * `fits: false`: o renderer corta pela caixa e o editor avisa o estouro.
 */
export function fitFontSize(
  textValue: string,
  field: Pick<LayoutField, 'w' | 'h' | 'fontSize'>,
): { fontSize: number; fits: boolean } {
  const base = field.fontSize ?? 12;
  const step = 0.05;
  for (let scale = 1; scale >= MIN_SCALE - 1e-9; scale -= step) {
    const size = Math.round(base * scale * 100) / 100;
    const { available, needed } = estimate(textValue, field.w, field.h, size);
    if (needed <= available) return { fontSize: size, fits: true };
  }
  return { fontSize: Math.round(base * MIN_SCALE * 100) / 100, fits: false };
}

/** Os maiores textos realistas de cada campo, para o editor medir o estouro (o nome mais longo permitido, 200). */
export const WORST_CASE: Partial<Record<TextFieldId, string>> = {
  holderName: 'Maria Aparecida de Nazaré Santos Oliveira Albuquerque Cavalcanti da Silva',
  body: 'concluiu o curso Introdução à Neurociência Aplicada à Prática Clínica, com carga horária de 120 horas, em 14 de outubro de 2026.',
  signatory: 'Dra. Ana Maria Lima Cavalcanti\nDiretora Acadêmica',
  issuer:
    'Emitido por Neuro Capacitar Educação LTDA\nCNPJ 11.222.333/0001-81\nem 14 de outubro de 2026',
  code: 'Código AbCdEfGhIjKlMnOpQrStUv\nhttps://hub.neurocapacitar.com.br/certificados/AbCdEfGhIjKlMnOpQrStUv',
};

/**
 * Confere o layout. ERROS (impedem publicar): campo fora da página ou dentro da moldura. AVISOS: sobreposição e texto
 * que não cabe nem no menor corpo (medido com o pior caso de cada campo).
 */
export function layoutProblems(layout: CertificateLayout): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  for (const field of layout.fields) {
    if (field.x + field.w > PAGE.width || field.y + field.h > PAGE.height) {
      problems.push({ code: 'out_of_page', fieldId: field.id, severity: 'error' });
    } else if (
      field.x < FRAME_MM ||
      field.y < FRAME_MM ||
      field.x + field.w > PAGE.width - FRAME_MM ||
      field.y + field.h > PAGE.height - FRAME_MM
    ) {
      problems.push({ code: 'inside_frame', fieldId: field.id, severity: 'error' });
    }
    if (isTextField(field.id)) {
      const worst = WORST_CASE[field.id];
      if (worst && !fitFontSize(worst, field).fits) {
        problems.push({ code: 'text_overflow', fieldId: field.id, severity: 'warning' });
      }
    }
  }
  for (let a = 0; a < layout.fields.length; a += 1) {
    for (let b = a + 1; b < layout.fields.length; b += 1) {
      const first = layout.fields[a]!;
      const second = layout.fields[b]!;
      const overlapX = first.x < second.x + second.w && second.x < first.x + first.w;
      const overlapY = first.y < second.y + second.h && second.y < first.y + first.h;
      if (overlapX && overlapY) {
        problems.push({
          code: 'overlap',
          fieldId: first.id,
          otherId: second.id,
          severity: 'warning',
        });
      }
    }
  }
  return problems;
}

/** Pode publicar: o layout é válido e não há ERRO (avisos não impedem). */
export function canPublishLayout(layout: CertificateLayout): boolean {
  return layoutProblems(layout).every((problem) => problem.severity !== 'error');
}
