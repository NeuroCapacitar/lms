import { expect, test } from '@playwright/test';

import { buildCertificateSnapshot } from '../src/features/certificate/certificate.ts';
import { renderCertificateHtml } from '../src/features/certificate/render.ts';

/**
 * Regressão do HTML do certificado (M7-02/M7-09): imprime em PDF com o Chromium LOCAL e confere 1 página A4
 * paisagem, mesmo com nome gigante ou hostil. Isto detecta regressão do HTML/CSS; NÃO prova o Browser Run real
 * (esse gate roda em Staging, ver docs/tasks/M7-certificados.md).
 */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const fixtures: Record<string, { name: string; course: string }> = {
  curto: { name: 'Ana Souza', course: 'Curso de Teste' },
  acentos: { name: "João D'Ávila Çavalcanti Ñandú", course: 'Introdução à Neurociência Aplicada' },
  longo: {
    name: 'Maria Aparecida de Nazaré Santos Oliveira Albuquerque Cavalcanti da Silva Pereira de Souza e Castro',
    course:
      'Curso com um título bastante longo para conferir a quebra de linha sem estourar a página',
  },
  gigante: { name: 'A'.repeat(200), course: 'B'.repeat(200) },
  hostil: { name: '<script>alert(1)</script>"><img src=x>', course: '</style><b>x</b>' },
};

function html(name: string, course: string) {
  return renderCertificateHtml({
    snapshot: buildCertificateSnapshot({
      certificateName: name.slice(0, 200),
      displayName: 'x',
      courseTitle: course.slice(0, 200),
      workloadHours: 20,
      completedAt: new Date('2026-10-14T12:00:00.000Z'),
      requiredTotal: 5,
      issuer: { legalName: 'Neuro Capacitar LTDA', cnpj: '11222333000181' },
      signatory: { name: 'Dra. Ana Lima', title: 'Diretora Acadêmica', signatureMediaId: null },
    }),
    code: 'AbCdEfGhIjKlMnOpQrStUv',
    baseUrl: 'https://hub.example.test',
    issuedAt: '2026-10-15T12:00:00.000Z',
    signatureDataUri: PNG,
  });
}

for (const [label, fixture] of Object.entries(fixtures)) {
  test(`PDF de 1 página A4 paisagem: ${label}`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('data:') && request.url() !== 'about:blank') {
        requests.push(request.url());
      }
    });
    await page.setContent(html(fixture.name, fixture.course));
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    // uma página só (objetos /Type /Page, sem contar /Pages)
    expect(text.match(/\/Type\s*\/Page(?![s\w])/g)).toHaveLength(1);
    // A4 paisagem: 841,89 x 595,28 pt
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
    expect(Number(box?.[1])).toBeCloseTo(841.89, 0);
    expect(Number(box?.[2])).toBeCloseTo(595.28, 0);
    // a página nunca pede nada à rede
    expect(requests).toEqual([]);
  });
}

test('o HTML hostil não executa script nem cria elemento: nenhum diálogo e uma só <img>', async ({
  page,
}) => {
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs += 1;
    await dialog.dismiss();
  });
  await page.setContent(html(fixtures.hostil!.name, fixtures.hostil!.course));
  expect(await page.locator('script').count()).toBe(0);
  expect(await page.locator('img').count()).toBe(1);
  expect(await page.locator('b').count()).toBe(0);
  expect(dialogs).toBe(0);
});
