import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { courseMeta, genericMeta } from '../../src/features/catalog/course-meta';
import { injectMeta } from '../../src/server/catalog/course-page';

/**
 * M2-06 no workerd: o HTMLRewriter de verdade. O primeiro bloco chama `injectMeta` (código do projeto,
 * sem banco); o segundo passa pelo Worker construído, com os assets reais, só por caminhos que NÃO
 * consultam o banco (como no resto deste arquivo: o que consulta o banco está nos testes PG e no e2e).
 */
const SHELL = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>NeuroCapacitar Hub</title>
    <meta name="description" content="descrição antiga" />
    <link rel="canonical" href="https://antiga.example/" />
  </head>
  <body><div id="root"></div><script type="module" src="/assets/app.js"></script></body>
</html>`;
const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { 'content-type': 'text/html', etag: '"abc"', ...headers } });

describe('injectMeta (HTMLRewriter)', () => {
  const meta = courseMeta({
    baseUrl: 'https://hub.example.com/ignorado',
    slug: 'curso-x',
    title: 'Curso X',
    summary: 'Resumo do curso.',
  });

  it('troca o título e injeta description, canonical, og e twitter sem duplicar', async () => {
    const response = injectMeta(html(SHELL), meta, 200);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('<title>Curso X | NeuroCapacitar</title>');
    expect(text).not.toContain('descrição antiga');
    expect(text).not.toContain('antiga.example');
    for (const marker of [
      '<meta name="description" content="Resumo do curso.">',
      '<link rel="canonical" href="https://hub.example.com/cursos/curso-x">',
      '<meta property="og:title" content="Curso X | NeuroCapacitar">',
      '<meta property="og:image" content="https://hub.example.com/og-default.png">',
      '<meta name="twitter:card" content="summary_large_image">',
    ]) {
      expect(text.split(marker).length - 1, marker).toBe(1);
    }
    // o resto da página não mudou
    expect(text).toContain('<div id="root"></div>');
    expect(text).toContain('<script type="module" src="/assets/app.js"></script>');
    // tudo dentro do <head>
    const head = text.slice(text.indexOf('<head>'), text.indexOf('</head>'));
    expect(head).toContain('og:title');
  });

  it('título e descrição com aspas e < saem escapados: nenhuma tag ou atributo é criado pelo texto', async () => {
    const hostile = courseMeta({
      baseUrl: 'https://hub.example.com',
      slug: 'curso-x',
      title: '"><img src=x onerror=alert(1)>',
      summary: `'><script>alert(2)</script> & "x"`,
    });
    const text = await injectMeta(html(SHELL), hostile, 200).text();
    expect(text).not.toContain('<img src=x');
    expect(text).not.toContain('<script>alert');
    expect(text).toContain(
      '<title>"&gt;&lt;img src=x onerror=alert(1)&gt; | NeuroCapacitar</title>',
    );
    expect(text).toContain(
      'content="&#39;&gt;&lt;script&gt;alert(2)&lt;/script&gt; &amp; &quot;x&quot;"',
    );
  });

  it('404 leva noindex e a meta genérica; sempre revalida e não herda etag nem content-length', async () => {
    const response = injectMeta(
      html(SHELL, { 'content-length': String(SHELL.length) }),
      genericMeta('https://hub.example.com'),
      404,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
    const text = await response.text();
    expect(text).toContain('<title>NeuroCapacitar Hub</title>');
    expect(text).toContain('<link rel="canonical" href="https://hub.example.com/">');
  });

  it('200 não leva noindex', async () => {
    expect(injectMeta(html(SHELL), meta, 200).headers.get('x-robots-tag')).toBeNull();
  });
});

describe('Worker construído: /cursos/*', () => {
  const get = (url: string) => exports.default.fetch(new Request(url));

  it('caminho que não é /cursos/:slug válido devolve a SPA sem meta de curso', async () => {
    for (const path of ['/cursos/a/b/c', '/cursos/Mau%20Slug']) {
      const response = await get(`http://example.com${path}`);
      expect(response.status, path).toBe(200);
      const text = await response.text();
      expect(text, path).toContain('<div id="root">');
      expect(text, path).not.toContain('og:title');
    }
  });
});
