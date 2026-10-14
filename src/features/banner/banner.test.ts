import { describe, expect, it } from 'vitest';

import { isInWindow, loginMediaSchema, normalizeBannerLink, panelBannerSchema } from './banner';

describe('link do banner: só interno ou https de host permitido', () => {
  it('aceita caminho interno e https do domínio da marca (e subdomínios)', () => {
    expect(normalizeBannerLink('/cursos')).toBe('/cursos');
    expect(normalizeBannerLink('/cursos/neuro?x=1#topo')).toBe('/cursos/neuro?x=1#topo');
    expect(normalizeBannerLink('https://neurocapacitar.com.br/promo')).toBe(
      'https://neurocapacitar.com.br/promo',
    );
    expect(normalizeBannerLink('https://app.neurocapacitar.com.br/')).toBe(
      'https://app.neurocapacitar.com.br/',
    );
    expect(normalizeBannerLink('  /ajuda  ')).toBe('/ajuda');
  });

  it('recusa javascript:, data:, // (protocolo relativo), http, host estranho, credencial, porta, espaço e controle', () => {
    for (const bad of [
      '',
      '   ',
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example/x',
      '/\\evil.example',
      'http://neurocapacitar.com.br/',
      'https://evil.example/',
      'https://neurocapacitar.com.br.evil.example/',
      'https://evilneurocapacitar.com.br/',
      'https://user:pass@neurocapacitar.com.br/',
      'https://neurocapacitar.com.br:8443/',
      'https://neurocapacitar.com.br/a b',
      '/cursos\nSet-Cookie: x',
      'ftp://neurocapacitar.com.br/',
      'cursos',
      `/${'a'.repeat(600)}`,
    ]) {
      expect(normalizeBannerLink(bad), JSON.stringify(bad).slice(0, 60)).toBeNull();
    }
  });
});

describe('banner e imagem de login', () => {
  const id = () => crypto.randomUUID();

  it('o banner exige texto alternativo (1 a 200, normalizado), link válido e janela coerente', () => {
    const ok = { mediaId: id(), alt: '  Matrículas abertas  ', linkUrl: '/cursos' };
    expect(panelBannerSchema.parse(ok).alt).toBe('Matrículas abertas');
    expect(panelBannerSchema.safeParse({ mediaId: id(), alt: 'x' }).success).toBe(true);
    for (const bad of [
      { mediaId: id() },
      { mediaId: id(), alt: '   ' },
      { mediaId: id(), alt: 'x'.repeat(201) },
      { mediaId: id(), alt: 'ok', linkUrl: 'javascript:alert(1)' },
      { mediaId: id(), alt: 'ok', linkUrl: 'https://evil.example' },
      { mediaId: 'x', alt: 'ok' },
      { mediaId: id(), alt: 'ok', startsAt: 'ontem' },
      {
        mediaId: id(),
        alt: 'ok',
        startsAt: '2026-10-20T00:00:00Z',
        endsAt: '2026-10-10T00:00:00Z',
      },
      { mediaId: id(), alt: 'ok', extra: 1 },
    ]) {
      expect(panelBannerSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(
        false,
      );
    }
    expect(
      panelBannerSchema.safeParse({
        mediaId: id(),
        alt: 'ok',
        startsAt: '2026-10-10T00:00:00Z',
        endsAt: '2026-10-20T00:00:00-03:00',
        linkUrl: null,
      }).success,
    ).toBe(true);
  });

  it('a imagem de login só tem o id da mídia (decorativa, sem alt nem link)', () => {
    expect(loginMediaSchema.safeParse({ mediaId: id() }).success).toBe(true);
    expect(loginMediaSchema.safeParse({ mediaId: id(), alt: 'x' }).success).toBe(false);
  });

  it('a janela de exibição: início inclusivo, fim exclusivo, aberta nos dois lados', () => {
    const start = new Date('2026-10-10T12:00:00Z');
    const end = new Date('2026-10-20T12:00:00Z');
    expect(isInWindow({ startsAt: null, endsAt: null }, start)).toBe(true);
    expect(isInWindow({ startsAt: start, endsAt: end }, new Date(start.getTime() - 1))).toBe(false);
    expect(isInWindow({ startsAt: start, endsAt: end }, start)).toBe(true);
    expect(isInWindow({ startsAt: start, endsAt: end }, new Date(end.getTime() - 1))).toBe(true);
    expect(isInWindow({ startsAt: start, endsAt: end }, end)).toBe(false);
    expect(isInWindow({ startsAt: null, endsAt: end }, new Date('2026-01-01T00:00:00Z'))).toBe(
      true,
    );
  });
});
