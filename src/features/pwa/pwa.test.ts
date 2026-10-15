import { describe, expect, it } from 'vitest';

import {
  API_CLIENT_EPOCH,
  NAVIGATION_DENYLIST_PATTERNS,
  OFFLINE_PAGE,
  isClientOutdated,
  isNavigationDenied,
  pwaKillSwitch,
} from './pwa';

describe('época do cliente', () => {
  it('sem cabeçalho (curl, webhook, teste) ou vazio: não é recusado', () => {
    expect(isClientOutdated(undefined)).toBe(false);
    expect(isClientOutdated(null)).toBe(false);
    expect(isClientOutdated('')).toBe(false);
  });

  it('a época atual passa; qualquer outra (antiga, futura ou lixo) é desatualizada', () => {
    expect(isClientOutdated(String(API_CLIENT_EPOCH))).toBe(false);
    for (const other of ['0', String(API_CLIENT_EPOCH + 1), 'abc', '1.0', ' 1']) {
      expect(isClientOutdated(other), other).toBe(true);
    }
  });
});

describe('navegações que nunca vêm do cache', () => {
  it('Staff, API, certificados públicos, compra e /cdn-cgi/ vão à rede', () => {
    for (const path of [
      '/staff',
      '/staff/equipe',
      '/staff/certificados/xyz',
      '/api/me/profile',
      '/api',
      '/certificados/AbCdEfGhIjKlMnOpQrStUv',
      '/compra/retorno',
      '/comprar',
      '/cdn-cgi/trace',
    ]) {
      expect(isNavigationDenied(path), path).toBe(true);
    }
  });

  it('as áreas do aluno e as páginas públicas usam o shell (inclusive nomes parecidos)', () => {
    for (const path of [
      '/',
      '/cursos',
      '/cursos/curso-demo',
      '/estudar/abc/aulas/def',
      '/conta',
      '/entrar',
      '/ajuda',
      '/staffing',
      '/certificado',
      '/apiary',
      '/compras',
    ]) {
      expect(isNavigationDenied(path), path).toBe(false);
    }
  });

  it('o denylist do Workbox é o mesmo conjunto de regras', () => {
    for (const pattern of NAVIGATION_DENYLIST_PATTERNS) expect(pattern).toBeInstanceOf(RegExp);
    expect(NAVIGATION_DENYLIST_PATTERNS.some((pattern) => pattern.test('/staff/x'))).toBe(true);
    expect(OFFLINE_PAGE).toBe('/offline.html');
  });
});

describe('kill switch', () => {
  it('só PWA_KILL=1 liga', () => {
    expect(pwaKillSwitch({ PWA_KILL: '1' })).toBe(true);
    for (const value of [undefined, '', '0', 'true', 'yes']) {
      expect(pwaKillSwitch({ PWA_KILL: value }), String(value)).toBe(false);
    }
    expect(pwaKillSwitch({})).toBe(false);
  });
});
