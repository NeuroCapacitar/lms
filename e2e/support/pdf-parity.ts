import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  PAGE,
  TEXT_FIELD_IDS,
  fieldOf,
  type CertificateLayout,
  type FieldId,
} from '../../src/features/certificate/layout.ts';

/**
 * Gate de paridade layout ↔ PDF (M7-09): extrai as caixas de texto do PDF (pdf.js) e confere, campo a campo, que o
 * texto saiu DENTRO da caixa do layout (em milímetros, com tolerância) e centralizado quando o campo é centralizado.
 * Serve ao PDF gerado pelo Chromium local (detecta regressão do HTML/CSS) e ao PDF REAL do Browser Run (evidência).
 */
const PT_MM = 25.4 / 72;
/** Tolerância de métrica de fonte (mm). O spike M0-15 mediu <0,1 mm de erro de posição; ficamos folgados. */
const TOLERANCE_MM = 1.5;
const CENTER_TOLERANCE_MM = 2.5;

interface TextBox {
  text: string;
  /** Esquerda, direita e topo da linha, em mm a partir do canto superior esquerdo da página. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PdfBoxes {
  pages: number;
  widthMm: number;
  heightMm: number;
  boxes: TextBox[];
}

export async function extractBoxes(bytes: Uint8Array): Promise<PdfBoxes> {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const boxes: TextBox[] = [];
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue;
    const [, , , , x, y] = item.transform as number[];
    const baseline = (viewport.height - y!) * PT_MM;
    const height = item.height * PT_MM;
    boxes.push({
      text: item.str,
      left: x! * PT_MM,
      right: x! * PT_MM + item.width * PT_MM,
      top: baseline - height,
      bottom: baseline + height * 0.25,
    });
  }
  const pages = doc.numPages;
  await doc.cleanup();
  return { pages, widthMm: viewport.width * PT_MM, heightMm: viewport.height * PT_MM, boxes };
}

export interface ParityResult {
  problems: string[];
  /** O texto que o PDF colocou em cada campo (para conferência do conteúdo). */
  textByField: Partial<Record<FieldId, string>>;
}

/** Sem espaços e sem diferença de caixa: o título sai em MAIÚSCULAS pelo CSS (`text-transform`). */
const squash = (value: string) => value.replaceAll(/\s+/g, '').toLowerCase();

/**
 * Compara o PDF com o layout. `expected` é o texto simples de cada campo de texto (o MESMO que o renderer usa). Regras:
 * a página é A4 paisagem; todo texto do PDF cai dentro da caixa de algum campo (nada fora do layout); cada campo
 * contém TODO o seu texto esperado; campo centralizado fica centralizado na caixa.
 */
export function compareWithLayout(
  pdf: PdfBoxes,
  layout: CertificateLayout,
  expected: Partial<Record<FieldId, string>>,
): ParityResult {
  const problems: string[] = [];
  if (pdf.pages !== 1) problems.push(`páginas: ${pdf.pages}`);
  if (Math.abs(pdf.widthMm - PAGE.width) > 1 || Math.abs(pdf.heightMm - PAGE.height) > 1) {
    problems.push(`tamanho da página: ${pdf.widthMm.toFixed(1)} × ${pdf.heightMm.toFixed(1)} mm`);
  }

  const assigned = new Map<FieldId, TextBox[]>();
  for (const box of pdf.boxes) {
    const owner = TEXT_FIELD_IDS.find((id) => {
      const field = fieldOf(layout, id);
      const text = squash(expected[id] ?? '');
      return (
        text.includes(squash(box.text)) &&
        box.left >= field.x - TOLERANCE_MM &&
        box.right <= field.x + field.w + TOLERANCE_MM &&
        box.top >= field.y - TOLERANCE_MM &&
        box.bottom <= field.y + field.h + TOLERANCE_MM
      );
    });
    if (!owner) {
      problems.push(
        `texto fora de qualquer caixa do layout: "${box.text}" (x ${box.left.toFixed(1)}–${box.right.toFixed(1)}, y ${box.top.toFixed(1)}–${box.bottom.toFixed(1)} mm)`,
      );
      continue;
    }
    assigned.set(owner, [...(assigned.get(owner) ?? []), box]);
  }

  const textByField: Partial<Record<FieldId, string>> = {};
  for (const id of TEXT_FIELD_IDS) {
    const want = expected[id];
    if (want === undefined) continue;
    const field = fieldOf(layout, id);
    const found = assigned.get(id) ?? [];
    textByField[id] = found.map((box) => box.text).join(' ');
    if (squash(textByField[id]!) !== squash(want)) {
      problems.push(`${id}: o PDF tem "${textByField[id]}", o esperado era "${want}"`);
    }
    if (field.align === 'center' && found.length > 0) {
      // Uma linha pode ter vários trechos (negrito no meio): agrupa pelo topo e mede a linha inteira.
      const lines = new Map<number, TextBox>();
      for (const box of found) {
        const key = Math.round(box.top);
        const line = lines.get(key);
        lines.set(
          key,
          line
            ? {
                ...line,
                text: `${line.text} ${box.text}`,
                left: Math.min(line.left, box.left),
                right: Math.max(line.right, box.right),
              }
            : box,
        );
      }
      for (const box of lines.values()) {
        const center = (box.left + box.right) / 2;
        const boxCenter = field.x + field.w / 2;
        if (Math.abs(center - boxCenter) > CENTER_TOLERANCE_MM) {
          problems.push(
            `${id}: linha "${box.text}" não está centralizada (centro ${center.toFixed(1)} mm, esperado ${boxCenter.toFixed(1)} mm)`,
          );
        }
      }
    }
  }
  return { problems, textByField };
}
