import { describe, expect, it } from 'vitest';

import {
  EMPTY_RICH_TEXT,
  MAX_RICH_TEXT_BYTES,
  isAllowedHref,
  isExternalHref,
  parseRichText,
  richTextFromParagraph,
} from './rich-text';

const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });

describe('documento válido', () => {
  it('aceita todos os nós e marcas da allowlist, no formato que o Tiptap produz', () => {
    const full = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Título')] },
      { type: 'heading', attrs: { level: 3 }, content: [text('Subtítulo')] },
      paragraph(
        text('Texto '),
        text('negrito', [{ type: 'bold' }]),
        { type: 'hardBreak' },
        text('itálico e negrito', [{ type: 'italic' }, { type: 'bold' }]),
        text('um link', [
          {
            type: 'link',
            attrs: {
              href: 'https://example.com/a?b=1',
              target: null,
              rel: null,
              class: null,
              title: null,
            },
          },
        ]),
      ),
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('um'))] }] },
      {
        type: 'orderedList',
        attrs: { start: 1, type: null },
        content: [{ type: 'listItem', content: [paragraph(text('primeiro'))] }],
      },
      { type: 'blockquote', content: [paragraph(text('citação'))] },
    );
    expect(parseRichText(full)).toEqual(full);
  });

  it('o documento vazio do editor e o de um parágrafo passam', () => {
    expect(parseRichText(EMPTY_RICH_TEXT)).toEqual(EMPTY_RICH_TEXT);
    expect(parseRichText(richTextFromParagraph('Olá'))).not.toBeNull();
    expect(richTextFromParagraph('')).toEqual(EMPTY_RICH_TEXT);
  });
});

describe('o que a allowlist rejeita (nada é "limpo em silêncio")', () => {
  const rejected: [string, unknown][] = [
    ['não é um documento', 'texto solto'],
    ['sem tipo doc', { type: 'paragraph', content: [] }],
    ['documento sem blocos', doc()],
    [
      'nó desconhecido (imagem)',
      doc({ type: 'image', attrs: { src: 'https://example.com/x.png' } }),
    ],
    ['nó desconhecido (bloco de código)', doc({ type: 'codeBlock', content: [text('x')] })],
    ['régua horizontal', doc({ type: 'horizontalRule' })],
    ['título nível 1', doc({ type: 'heading', attrs: { level: 1 }, content: [text('x')] })],
    ['título nível 4', doc({ type: 'heading', attrs: { level: 4 }, content: [text('x')] })],
    ['marca desconhecida (sublinhado)', doc(paragraph(text('x', [{ type: 'underline' }])))],
    ['marca desconhecida (código)', doc(paragraph(text('x', [{ type: 'code' }])))],
    [
      'atributo extra no link (onclick)',
      doc(
        paragraph(
          text('x', [
            { type: 'link', attrs: { href: 'https://example.com', onclick: 'alert(1)' } },
          ]),
        ),
      ),
    ],
    [
      'atributo extra no link (style)',
      doc(
        paragraph(
          text('x', [{ type: 'link', attrs: { href: 'https://example.com', style: 'color:red' } }]),
        ),
      ),
    ],
    [
      'rel do link com valor (só null)',
      doc(
        paragraph(text('x', [{ type: 'link', attrs: { href: 'https://example.com', rel: 'me' } }])),
      ),
    ],
    [
      'title do link com valor (só null)',
      doc(
        paragraph(
          text('x', [{ type: 'link', attrs: { href: 'https://example.com', title: 'x' } }]),
        ),
      ),
    ],
    ['chave extra no nó', doc({ type: 'paragraph', content: [], style: 'x' })],
    ['chave extra no texto', doc(paragraph({ type: 'text', text: 'x', html: '<b>x</b>' }))],
    ['texto vazio', doc(paragraph(text('')))],
    ['lista vazia', doc({ type: 'bulletList', content: [] })],
    [
      'item de lista com nó que não é parágrafo',
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 }, content: [] }] },
        ],
      }),
    ],
    [
      'mais de três marcas',
      doc(
        paragraph(
          text('x', [{ type: 'bold' }, { type: 'italic' }, { type: 'bold' }, { type: 'italic' }]),
        ),
      ),
    ],
  ];
  for (const [name, value] of rejected) {
    it(name, () => expect(parseRichText(value)).toBeNull());
  }

  it('documento grande demais (mais de 100 KB) é rejeitado; no limite passa', () => {
    expect(parseRichText(doc(paragraph(text('x'.repeat(MAX_RICH_TEXT_BYTES)))))).toBeNull();
    expect(parseRichText(doc(paragraph(text('x'.repeat(19_000)))))).not.toBeNull();
  });
});

describe('links', () => {
  it('só http, https e mailto, sem espaços, controles nem credenciais', () => {
    for (const ok of [
      'https://example.com',
      'http://example.com/a/b?c=d#e',
      'mailto:pessoa@example.com',
      'https://sub.example.com:8443/x',
    ]) {
      expect(isAllowedHref(ok), ok).toBe(true);
    }
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\nscript:alert(1)',
      'java\tscript:alert(1)',
      '\u0001javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/x',
      '//evil.example.com',
      '/caminho/relativo',
      'example.com',
      'https://usuario:senha@example.com',
      'https://',
      'http://',
      'mailto:',
      '',
      'https://example.com/com espaço',
      `https://example.com/${'a'.repeat(2_100)}`,
    ]) {
      expect(isAllowedHref(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('link com esquema perigoso derruba o documento todo', () => {
    for (const href of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      ' https://example.com',
    ]) {
      expect(
        parseRichText(doc(paragraph(text('x', [{ type: 'link', attrs: { href } }])))),
        href,
      ).toBeNull();
    }
  });

  it('externo é só http e https', () => {
    expect(isExternalHref('https://example.com')).toBe(true);
    expect(isExternalHref('http://example.com')).toBe(true);
    expect(isExternalHref('mailto:a@example.com')).toBe(false);
  });
});

describe('corpus de XSS: HTML e scripts como TEXTO são válidos e inofensivos (a exibição os escapa)', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(1)>',
    "'-alert(1)-'",
    '<iframe src="javascript:alert(1)"></iframe>',
    '</p><p onclick="alert(1)">x',
  ];
  for (const payload of payloads) {
    it(JSON.stringify(payload), () => {
      const value = doc(paragraph(text(payload)));
      expect(parseRichText(value)).toEqual(value);
    });
  }
});
