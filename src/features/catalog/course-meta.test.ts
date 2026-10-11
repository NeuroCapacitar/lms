import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DESCRIPTION,
  canonicalOrigin,
  courseMeta,
  escapeHtml,
  genericMeta,
  renderMetaTags,
  slugFromPath,
} from './course-meta';

describe('escapeHtml', () => {
  it('escapa o que quebra texto e atributo, aspas duplas e simples inclusive', () => {
    expect(escapeHtml(`<script>"a" & 'b'</script>`)).toBe(
      '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;',
    );
    expect(escapeHtml('texto comum')).toBe('texto comum');
  });
});

describe('slugFromPath', () => {
  it('aceita /cursos/:slug com ou sem barra final e recusa o resto', () => {
    expect(slugFromPath('/cursos/protea-r')).toBe('protea-r');
    expect(slugFromPath('/cursos/protea-r/')).toBe('protea-r');
    for (const bad of [
      '/cursos',
      '/cursos/',
      '/cursos/a',
      '/cursos/Maiuscula',
      '/cursos/com espaco',
      '/cursos/a/b',
      '/cursos/%E0%A4%A',
      '/cursos/..%2fetc',
      '/outra/protea-r',
    ]) {
      expect(slugFromPath(bad), bad).toBeNull();
    }
  });
});

describe('canonicalOrigin', () => {
  it('usa só a origem da configuração', () => {
    expect(canonicalOrigin('https://hub.example.com/qualquer/coisa/')).toBe(
      'https://hub.example.com',
    );
    expect(canonicalOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });
  it('recusa configuração que não é http(s)', () => {
    expect(() => canonicalOrigin('javascript:alert(1)')).toThrow();
    expect(() => canonicalOrigin('não é url')).toThrow();
  });
});

describe('courseMeta e renderMetaTags', () => {
  const base = {
    baseUrl: 'https://hub.example.com',
    slug: 'curso-x',
    title: 'Curso X',
    summary: 'Resumo do curso.',
  };

  it('monta título, descrição, canônica e imagem a partir da configuração', () => {
    expect(courseMeta(base)).toEqual({
      title: 'Curso X | NeuroCapacitar',
      description: 'Resumo do curso.',
      canonical: 'https://hub.example.com/cursos/curso-x',
      image: 'https://hub.example.com/og-default.png',
    });
  });

  it('sem resumo usa a descrição padrão', () => {
    expect(courseMeta({ ...base, summary: '  ' }).description).toBe(DEFAULT_DESCRIPTION);
  });

  it('título com aspas e < sai escapado em todas as tags e nunca cru', () => {
    const html = renderMetaTags(
      courseMeta({ ...base, title: '"><script>alert(1)</script>', summary: `a "b" <c> & 'd'` }),
    );
    expect(html).not.toContain('<script');
    expect(html).toContain(
      'og:title" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; | NeuroCapacitar"',
    );
    expect(html).toContain('content="a &quot;b&quot; &lt;c&gt; &amp; &#39;d&#39;"');
    // cada tag tem exatamente o número de aspas esperado (nenhum valor fechou o atributo antes da hora)
    for (const tag of html.match(/<(meta|link)[^>]*>/g) ?? []) {
      expect((tag.match(/"/g) ?? []).length % 2, tag).toBe(0);
    }
  });

  it('traz og, twitter, canonical e description, cada um uma vez', () => {
    const html = renderMetaTags(courseMeta(base));
    for (const marker of [
      'name="description"',
      'rel="canonical"',
      'property="og:title"',
      'property="og:description"',
      'property="og:url"',
      'property="og:image"',
      'name="twitter:card" content="summary_large_image"',
      'name="twitter:title"',
      'name="twitter:image"',
    ]) {
      expect(html.split(marker).length - 1, marker).toBe(1);
    }
  });

  it('a canônica genérica é a da home e não cita curso', () => {
    const meta = genericMeta('https://hub.example.com');
    expect(meta.canonical).toBe('https://hub.example.com/');
    expect(meta.title).toBe('NeuroCapacitar Hub');
  });
});
