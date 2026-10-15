import { describe, expect, it } from 'vitest';

import { collectDiagnostics, formatDiagnostics, type DiagnosticsEnv } from './diagnostics';

const baseEnv = (): DiagnosticsEnv => ({
  now: () => new Date('2026-10-15T12:00:00.000Z'),
  timeZone: () => 'America/Sao_Paulo',
  online: () => true,
  userAgent: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari',
  standalone: () => true,
  release: async () => 'abc123',
  serviceWorker: async () => ({
    supported: true,
    controlled: true,
    registrations: ['/ (activated)'],
  }),
  storage: async () => ({ usage: 5 * 1024 * 1024, quota: 1024 * 1024 * 1024, persisted: false }),
  databases: async () => [
    {
      name: 'hub-offline-ab12',
      stores: [
        { name: 'lessons', count: 3 },
        { name: 'leases', count: 1 },
      ],
    },
  ],
  caches: async () => [{ name: 'workbox-precache-v2-https://x/', entries: 84 }],
  localStorageKeys: () => 1,
  sessionStorageKeys: () => 0,
});

describe('diagnóstico do aparelho', () => {
  it('junta tudo e o texto mostra bancos, caches e o modo instalado', async () => {
    const text = formatDiagnostics(await collectDiagnostics(baseEnv()));
    expect(text).toContain('Build: abc123');
    expect(text).toContain('Modo: app instalado (tela inicial)');
    expect(text).toContain('Rede: online');
    expect(text).toContain('hub-offline-ab12: lessons=3, leases=1');
    expect(text).toContain('workbox-precache-v2-https://x/: 84 itens');
    expect(text).toContain('usa 5.00 MB de 1024.00 MB; persistente: não');
    expect(text).toContain('Bancos IndexedDB (1):');
  });

  it('aparelho limpo: "nenhum" nos bancos e nos caches (a prova de que sair apagou tudo)', async () => {
    const env: DiagnosticsEnv = { ...baseEnv(), databases: async () => [], caches: async () => [] };
    const text = formatDiagnostics(await collectDiagnostics(env));
    expect(text).toContain('Bancos IndexedDB (0):\n  nenhum');
    expect(text).toContain('Caches (0):\n  nenhum');
  });

  it('uma coleta que falha não derruba o relatório: o campo fica "n/d" ou vazio', async () => {
    const boom = async () => {
      throw new Error('indisponível');
    };
    const env: DiagnosticsEnv = {
      ...baseEnv(),
      release: boom,
      storage: boom,
      databases: boom,
      caches: boom,
      serviceWorker: boom,
    };
    const text = formatDiagnostics(await collectDiagnostics(env));
    expect(text).toContain('Build: n/d');
    expect(text).toContain('Service Worker: NÃO suportado');
    expect(text).toContain('Armazenamento: usa n/d de n/d; persistente: n/d');
    expect(text).toContain('Bancos IndexedDB (0)');
  });

  it('sem Service Worker no navegador e offline: o texto diz', async () => {
    const env: DiagnosticsEnv = {
      ...baseEnv(),
      online: () => false,
      standalone: () => false,
      serviceWorker: async () => ({ supported: false, controlled: false, registrations: [] }),
    };
    const text = formatDiagnostics(await collectDiagnostics(env));
    expect(text).toContain('Rede: offline');
    expect(text).toContain('Modo: aba do navegador');
    expect(text).toContain('Service Worker: NÃO suportado');
  });

  it('NUNCA vaza dado da pessoa: só nomes de banco/cache e contagens entram no texto', async () => {
    const text = formatDiagnostics(await collectDiagnostics(baseEnv()));
    expect(text).not.toMatch(/@|token|senha|cookie|userId/i);
  });
});
