import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { buildCertificateSnapshot } from '../src/features/certificate/certificate.ts';
import {
  defaultLayout,
  fieldOf,
  type CertificateLayout,
  type FieldId,
} from '../src/features/certificate/layout.ts';
import { plainTextOf, renderCertificateHtml } from '../src/features/certificate/render.ts';
import { compareWithLayout, extractBoxes } from './support/pdf-parity.ts';

/**
 * Gate de paridade layout ↔ PDF (M7-09), parte automática.
 * (1) O PDF REAL gerado pelo Browser Run em Staging (guardado como fixture, dados sintéticos) tem de bater com o
 *     layout padrão: é a evidência de que o Browser Run respeita as posições em mm.
 * (2) O HTML do renderer impresso pelo Chromium LOCAL, em vários layouts e nomes, detecta regressão do HTML/CSS
 *     (NÃO prova o Browser Run: isso é a fixture acima, e a conferência humana do Admin).
 * (3) O próprio gate FALHA quando o PDF não bate com o layout (campo movido).
 */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

interface Data {
  holderName: string;
  courseTitle: string;
  workloadHours: number | null;
  completedAt: string;
  issuedAt: string;
  issuerName: string;
  issuerCnpj: string;
  signatoryName: string;
  signatoryTitle: string;
  code: string;
  url: string;
}

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const BASE = 'https://hub.example.test';

function dataFor(name: string, course: string): Data {
  return {
    holderName: name,
    courseTitle: course,
    workloadHours: 20,
    completedAt: '2026-10-14T12:00:00.000Z',
    issuedAt: '2026-10-15T12:00:00.000Z',
    issuerName: 'Neuro Capacitar LTDA',
    issuerCnpj: '11222333000181',
    signatoryName: 'Dra. Ana Lima',
    signatoryTitle: 'Diretora Acadêmica',
    code: CODE,
    url: `${BASE}/certificados/${CODE}`,
  };
}

const TEXT_IDS: FieldId[] = ['title', 'intro', 'holderName', 'body', 'signatory', 'issuer', 'code'];
const expectedOf = (data: Data) =>
  Object.fromEntries(TEXT_IDS.map((id) => [id, plainTextOf(id, data)])) as Partial<
    Record<FieldId, string>
  >;

function htmlFor(data: Data, layout: CertificateLayout, background = false) {
  return renderCertificateHtml({
    snapshot: buildCertificateSnapshot({
      certificateName: data.holderName,
      displayName: 'x',
      courseTitle: data.courseTitle,
      workloadHours: data.workloadHours,
      completedAt: new Date(data.completedAt),
      requiredTotal: 5,
      issuer: { legalName: data.issuerName, cnpj: data.issuerCnpj },
      signatory: { name: data.signatoryName, title: data.signatoryTitle, signatureMediaId: null },
      layout,
    }),
    code: data.code,
    baseUrl: BASE,
    issuedAt: data.issuedAt,
    signatureDataUri: PNG,
    backgroundDataUri: background ? PNG : null,
  });
}

/** Um layout diferente do padrão: campos deslocados, alinhados à esquerda e com outro corpo. */
function denseLayout(): CertificateLayout {
  const layout = structuredClone(defaultLayout());
  Object.assign(fieldOf(layout, 'title'), {
    x: 30,
    y: 24,
    w: 200,
    h: 14,
    fontSize: 22,
    align: 'left',
  });
  Object.assign(fieldOf(layout, 'intro'), {
    x: 30,
    y: 42,
    w: 200,
    h: 14,
    fontSize: 12,
    align: 'left',
  });
  Object.assign(fieldOf(layout, 'holderName'), {
    x: 30,
    y: 58,
    w: 240,
    h: 24,
    fontSize: 28,
    align: 'left',
  });
  Object.assign(fieldOf(layout, 'body'), {
    x: 30,
    y: 88,
    w: 200,
    h: 40,
    fontSize: 13,
    align: 'left',
  });
  Object.assign(fieldOf(layout, 'signatory'), { x: 30, y: 150, w: 80, h: 22, align: 'center' });
  Object.assign(fieldOf(layout, 'issuer'), {
    x: 130,
    y: 150,
    w: 80,
    h: 22,
    fontSize: 9,
    align: 'right',
  });
  Object.assign(fieldOf(layout, 'code'), { x: 200, y: 176, w: 80, h: 16, align: 'right' });
  return layout;
}

test('o PDF REAL do Browser Run (Staging, dados sintéticos) bate com o layout padrão', async () => {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/certificado-browser-run-staging.pdf', import.meta.url)),
  );
  const data: Data = {
    holderName: 'Maria Aparecida de Nazaré Çavalcanti d’Ávila',
    courseTitle: 'Curso Demonstrativo',
    workloadHours: 3,
    completedAt: '2026-10-15T01:14:00.000Z',
    issuedAt: '2026-10-15T01:31:00.000Z',
    issuerName: 'Empresa de Teste Sintética LTDA',
    issuerCnpj: '11222333000181',
    signatoryName: 'Assinante de Teste',
    signatoryTitle: 'Diretor de Teste',
    code: 'eOjs6cMEy7VWMkJVzYGCBw',
    url: 'https://hub-staging.neurocapacitar-projetos.workers.dev/certificados/eOjs6cMEy7VWMkJVzYGCBw',
  };
  const result = compareWithLayout(await extractBoxes(bytes), defaultLayout(), expectedOf(data));
  expect(result.problems).toEqual([]);
  expect(result.textByField.holderName).toBe(data.holderName);
});

const NAMES: Record<string, string> = {
  curto: 'Ana Souza',
  acentos: 'João D’Ávila Çavalcanti Ñandú',
  longo: 'Maria Aparecida de Nazaré Santos Oliveira Albuquerque Cavalcanti da Silva',
};

for (const [layoutName, layout] of [
  ['padrão', defaultLayout()],
  ['denso', denseLayout()],
] as const) {
  for (const [label, name] of Object.entries(NAMES)) {
    test(`Chromium local: layout ${layoutName}, nome ${label}`, async ({ page }) => {
      const data = dataFor(name, 'Introdução à Neurociência Aplicada');
      await page.setContent(htmlFor(data, layout, layoutName === 'denso'));
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const result = compareWithLayout(
        await extractBoxes(new Uint8Array(pdf)),
        layout,
        expectedOf(data),
      );
      expect(result.problems).toEqual([]);
    });
  }
}

test('o gate FALHA quando o PDF não bate com o layout (campo movido)', async ({ page }) => {
  const data = dataFor('Ana Souza', 'Curso de Teste');
  await page.setContent(htmlFor(data, defaultLayout()));
  const pdf = new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  const moved = defaultLayout();
  Object.assign(fieldOf(moved, 'title'), { x: 150, w: 100 });
  const result = compareWithLayout(await extractBoxes(pdf), moved, expectedOf(data));
  expect(result.problems.length).toBeGreaterThan(0);
  expect(result.problems.join('\n')).toMatch(/title|CERTIFICADO/);
});

test('o gate FALHA quando falta texto (campo ausente no PDF)', async ({ page }) => {
  const data = dataFor('Ana Souza', 'Curso de Teste');
  await page.setContent(htmlFor(data, defaultLayout()));
  const pdf = new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  const expected = expectedOf(data);
  expected.holderName = 'Outra Pessoa Totalmente Diferente';
  const result = compareWithLayout(await extractBoxes(pdf), defaultLayout(), expected);
  expect(result.problems.join('\n')).toContain('holderName');
});
