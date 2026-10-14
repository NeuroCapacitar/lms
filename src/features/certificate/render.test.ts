import { describe, expect, it } from 'vitest';

import { buildCertificateSnapshot, type CertificateSnapshot } from './certificate';
import { defaultLayout } from './layout';
import {
  CertificateRenderInputError,
  certificateValidationUrl,
  escapeHtml,
  formatDatePt,
  renderCertificateHtml,
} from './render';
import { qrSvg } from './qr';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const BASE = 'https://hub.example.test';
const MEDIA = '00000000-0000-4000-8000-000000000001';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const FONT = 'data:font/woff2;base64,d09GMgABAAAAAAAA';

function snapshot(overrides: Partial<Parameters<typeof buildCertificateSnapshot>[0]> = {}) {
  return buildCertificateSnapshot({
    certificateName: null,
    displayName: 'Ana Souza',
    courseTitle: 'Curso de Teste',
    workloadHours: 20,
    completedAt: new Date('2026-10-14T12:00:00.000Z'),
    requiredTotal: 5,
    issuer: { legalName: 'Neuro Capacitar LTDA', cnpj: '11222333000181' },
    signatory: { name: 'Dra. Ana Lima', title: 'Diretora Acadêmica', signatureMediaId: MEDIA },
    ...overrides,
  });
}

const render = (snap: CertificateSnapshot = snapshot(), extra = {}) =>
  renderCertificateHtml({
    snapshot: snap,
    code: CODE,
    baseUrl: BASE,
    issuedAt: '2026-10-15T12:00:00.000Z',
    fontDataUri: FONT,
    signatureDataUri: PNG,
    ...extra,
  });

describe('escape', () => {
  it('cobre & < > " \' e a crase', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&\``)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;',
    );
  });
});

describe('conteúdo', () => {
  it('traz nome, curso, carga horária, datas em pt-BR, emitente, signatário e código', () => {
    const html = render();
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain('Ana Souza');
    expect(html).toContain('Curso de Teste');
    expect(html).toContain('com carga horária de 20 horas');
    expect(html).toContain('14 de outubro de 2026');
    expect(html).toContain('em 15 de outubro de 2026');
    expect(html).toContain('Neuro Capacitar LTDA');
    expect(html).toContain('CNPJ 11.222.333/0001-81');
    expect(html).toContain('Dra. Ana Lima');
    expect(html).toContain('Diretora Acadêmica');
    expect(html).toContain(`Código ${CODE}`);
    expect(html).toContain(`${BASE}/certificados/${CODE}`);
  });

  it('1 hora no singular; sem carga horária a frase some', () => {
    expect(render(snapshot({ workloadHours: 1 }))).toContain('carga horária de 1 hora,');
    expect(render(snapshot({ workloadHours: null }))).not.toContain('carga horária');
  });

  it('preserva acentos, ç, ã e apóstrofo (escapado); o dia é o de São Paulo', () => {
    const html = render(snapshot({ displayName: "João D'Ávila Çavalcanti" }));
    expect(html).toContain('João D&#39;Ávila Çavalcanti');
    expect(formatDatePt('2026-10-15T02:30:00.000Z')).toBe('14 de outubro de 2026');
  });

  it('é determinístico: o mesmo snapshot gera exatamente o mesmo HTML', () => {
    expect(render()).toBe(render());
  });

  it('nome longo diminui o corpo em vez de estourar (o corpo escolhido no layout é o teto)', () => {
    const size = (name: string) =>
      Number(
        /class="f holderName" style="[^"]*font-size:([0-9.]+)pt/.exec(
          render(snapshot({ displayName: name })),
        )![1],
      );
    expect(size('Ana Souza')).toBe(32);
    expect(size('A'.repeat(70))).toBeLessThan(32);
    expect(size('A'.repeat(200))).toBeLessThan(size('A'.repeat(70)));
    expect(size('A'.repeat(200))).toBeGreaterThanOrEqual(32 * 0.55 - 0.01);
  });

  it('o layout do snapshot manda: posição em mm, corpo, cor e alinhamento vêm dele', () => {
    const layout = defaultLayout();
    const holder = layout.fields.find((field) => field.id === 'holderName')!;
    Object.assign(holder, {
      x: 40,
      y: 60,
      w: 200,
      h: 30,
      fontSize: 20,
      color: '#aa0000',
      align: 'left',
    });
    const html = render({ ...snapshot(), layout });
    expect(html).toMatch(
      /class="f holderName" style="left:40mm;top:60mm;width:200mm;height:30mm;font-size:20pt;font-weight:600;color:#aa0000;text-align:left/,
    );
  });

  it('com fundo, ele entra como <img> data: antes dos campos; fundo inválido é recusado', () => {
    expect(render(snapshot(), { backgroundDataUri: PNG })).toContain(
      '<img class="bg" src="data:image/png;base64,',
    );
    expect(() => render(snapshot(), { backgroundDataUri: 'https://x/y.png' })).toThrow(
      'background_invalid',
    );
  });
});

describe('injeção', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '</style><script>alert(1)</script>',
    '" onload="alert(1)',
    "'><img src=x onerror=alert(1)>",
    '<svg/onload=alert(1)>',
    '{{constructor}} ${process.env}',
  ];

  it('nenhum campo do snapshot vira marcação: script, style, atributo e tag ficam como TEXTO', () => {
    for (const payload of hostile) {
      const html = render(
        snapshot({
          displayName: payload,
          courseTitle: payload,
          issuer: { legalName: payload, cnpj: '11222333000181' },
          signatory: { name: payload, title: payload, signatureMediaId: null },
        }),
      );
      const body = html.slice(html.indexOf('<body>'));
      // só as tags do próprio modelo existem: nada do snapshot criou tag nova
      const tags = [...body.matchAll(/<\/?([a-z0-9]+)/gi)].map((match) => match[1]!.toLowerCase());
      for (const tag of tags) {
        expect([
          'html',
          'body',
          'main',
          'header',
          'h1',
          'section',
          'p',
          'span',
          'footer',
          'div',
          'img',
          'br',
          'svg',
          'rect',
          'path',
        ]).toContain(tag);
      }
      expect(tags.filter((tag) => tag === 'img')).toHaveLength(1);
      expect(tags.filter((tag) => tag === 'svg')).toHaveLength(2);
      // a única <img> tem só src (data) e alt (escapado, sem < nem >)
      expect(body.match(/<img [^>]*>/g)![0]).toMatch(
        /^<img src="data:image\/png;base64,[^"]*" alt="[^"<>]*">$/,
      );
      expect(body).not.toContain(' onload="');
    }
  });

  it('só há UM script-like possível: nenhum <script> em lugar algum e a CSP proíbe rede e script', () => {
    const html = render();
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(
      `content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"`,
    );
  });
});

describe('sem rede', () => {
  it('nenhum src, href, url() ou @import aponta para fora; só data: e o QR local', () => {
    const html = render();
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/<link/i);
    const sources = [...html.matchAll(/\ssrc="([^"]*)"/g)].map((match) => match[1]);
    for (const source of sources) expect(source).toMatch(/^data:image\/png;base64,/);
  });

  it('o endereço de validação aparece só como texto', () => {
    const html = render();
    expect(html).not.toContain(`href="${BASE}`);
  });
});

describe('A4 e imagens', () => {
  it('declara A4 paisagem sem margem de impressão', () => {
    const html = render();
    expect(html).toContain('@page { size: 297mm 210mm; margin: 0; }');
    expect(html).toContain('width: 297mm');
  });

  it('com fonte embute @font-face; sem fonte e sem assinatura, ainda renderiza', () => {
    expect(render()).toContain('@font-face');
    const bare = render(snapshot(), { fontDataUri: null, signatureDataUri: null });
    expect(bare).not.toContain('@font-face');
    expect(bare).not.toContain('<img');
  });

  it('o alt da assinatura leva o nome escapado', () => {
    const html = render(
      snapshot({ signatory: { name: '"><b>', title: 'x', signatureMediaId: null } }),
    );
    expect(html).toContain('alt="Assinatura de &quot;&gt;&lt;b&gt;"');
  });
});

describe('o que não pode ser impresso', () => {
  it('sem emitente ou sem signatário: recusa com código', () => {
    expect(() => render(snapshot({ issuer: null }))).toThrow(CertificateRenderInputError);
    expect(() => render(snapshot({ issuer: null }))).toThrow('issuer_missing');
    expect(() => render(snapshot({ signatory: null }))).toThrow('signatory_missing');
  });

  it('assinatura ou fonte que não sejam data URI do tipo certo (URL, SVG, javascript:) são recusadas', () => {
    for (const signatureDataUri of [
      'https://evil.example/s.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA" onerror="x',
      'data:text/html;base64,PGI+',
    ]) {
      expect(() => render(snapshot(), { signatureDataUri })).toThrow('signature_invalid');
    }
    for (const fontDataUri of ['https://evil.example/f.woff2', 'data:font/ttf;base64,AAAA']) {
      expect(() => render(snapshot(), { fontDataUri })).toThrow('font_invalid');
    }
  });

  it('código fora do formato e origem inválida são recusados', () => {
    expect(() => certificateValidationUrl(BASE, 'curto')).toThrow('code_invalid');
    expect(() => certificateValidationUrl('javascript:alert(1)', CODE)).toThrow('base_url_invalid');
    expect(() => certificateValidationUrl('nao-e-url', CODE)).toThrow('base_url_invalid');
    expect(certificateValidationUrl('https://hub.example.test/qualquer/coisa?x=1', CODE)).toBe(
      `https://hub.example.test/certificados/${CODE}`,
    );
  });
});

describe('QR local', () => {
  it('é um SVG com um só path, determinístico e sem texto do usuário', () => {
    const svg = qrSvg(`${BASE}/certificados/${CODE}`);
    expect(svg).toBe(qrSvg(`${BASE}/certificados/${CODE}`));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).toContain('viewBox="0 0 ');
  });

  it('textos diferentes geram QR diferentes', () => {
    expect(qrSvg('https://a.example/1')).not.toBe(qrSvg('https://a.example/2'));
  });
});
