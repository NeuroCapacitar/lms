import { describe, expect, it } from 'vitest';

import { VIDEO_PROVIDERS } from '../../features/video/providers';
import { VERIFIED_PROVIDERS } from '../../features/video/verification';
import headers from '../../../public/_headers?raw';
import type { VideoAdapter } from './adapter';
import { checkClientAdapterContract, type ClientContractFixtures } from './adapter-contract';
import { REAL_ADAPTERS } from './adapters';
import { createFakeAdapter } from './fake-adapter';

const SELF = 'https://hub.exemplo.test';

const fakeFixtures = (reportsEnded: boolean): ClientContractFixtures => ({
  externalId: 'demo',
  selfOrigin: SELF,
  messages: [
    { data: { source: 'fake-video', type: 'ready' }, expect: { type: 'ready' } },
    { data: { source: 'fake-video', type: 'play' }, expect: { type: 'play' } },
    {
      data: { source: 'fake-video', type: 'timeupdate', t: 12 },
      expect: { type: 'timeupdate', t: 12 },
    },
    { data: { source: 'fake-video', type: 'seeked', t: 60 }, expect: { type: 'seeked', t: 60 } },
    {
      data: { source: 'fake-video', type: 'durationchange', duration: 600 },
      expect: { type: 'durationchange', duration: 600 },
    },
    {
      data: { source: 'fake-video', type: 'ended' },
      expect: reportsEnded ? { type: 'ended' } : undefined,
    },
    { data: { source: 'outro', type: 'play' }, expect: undefined },
  ],
});

/** Um adapter "bom" de referência, para os adapters desonestos abaixo se compararem. */
function remoteAdapter(overrides: Partial<VideoAdapter> = {}): VideoAdapter {
  return {
    provider: 'referencia',
    capabilities: {
      reportsTime: true,
      reportsEnded: true,
      reportsSeek: true,
      resume: true,
      duration: 'api',
    },
    allowedHosts: ['player.exemplo.com'],
    buildEmbed: ({ externalId, startAt }) => ({
      src: `https://player.exemplo.com/embed/${encodeURIComponent(externalId)}?t=${Math.floor(startAt)}`,
      origin: 'https://player.exemplo.com',
    }),
    normalize: (event) => {
      const data = event.data as { ev?: unknown; t?: unknown } | null;
      if (!data || typeof data !== 'object') return undefined;
      if (data.ev === 'time' && typeof data.t === 'number' && Number.isFinite(data.t)) {
        return { type: 'timeupdate', t: data.t };
      }
      if (data.ev === 'seek' && typeof data.t === 'number' && Number.isFinite(data.t)) {
        return { type: 'seeked', t: data.t };
      }
      if (data.ev === 'end') return { type: 'ended' };
      return undefined;
    },
    ...overrides,
  };
}

const remoteFixtures: ClientContractFixtures = {
  externalId: 'abc123',
  headers: `${headers}\n  Content-Security-Policy: frame-src https://player.exemplo.com;`,
  messages: [
    { data: { ev: 'time', t: 5 }, expect: { type: 'timeupdate', t: 5 } },
    { data: { ev: 'seek', t: 30 }, expect: { type: 'seeked', t: 30 } },
    { data: { ev: 'end' }, expect: { type: 'ended' } },
    { data: { ev: 'nada' }, expect: undefined },
  ],
};

describe('suíte de contrato do adapter (cliente) aplicada aos adapters existentes', () => {
  it('o adapter falso (as duas variantes) cumpre o contrato', () => {
    const stub = globalThis as { window?: unknown };
    const original = stub.window;
    stub.window = { location: { origin: SELF } };
    try {
      expect(checkClientAdapterContract(createFakeAdapter(), fakeFixtures(true))).toEqual([]);
      const noEnded = createFakeAdapter({ provider: 'fake-no-ended', reportsEnded: false });
      expect(checkClientAdapterContract(noEnded, fakeFixtures(false))).toEqual([]);
    } finally {
      stub.window = original;
    }
  });

  it('o adapter de referência (host remoto, com frame-src publicado) cumpre o contrato', () => {
    expect(checkClientAdapterContract(remoteAdapter(), remoteFixtures)).toEqual([]);
  });

  it('cada provider com adapter real roda a suíte; os sem adapter ficam à vista como pendentes', () => {
    for (const provider of VIDEO_PROVIDERS) {
      const create = REAL_ADAPTERS[provider];
      if (!create) continue;
      // O M5-08 a M5-13 acrescenta aqui a fixture gravada do seu provider: sem fixture, o CI falha.
      throw new Error(
        `o adapter ${provider} existe, mas não tem fixture de contrato neste arquivo`,
      );
    }
  });

  it('nenhum provider verificado sem adapter real registrado', () => {
    for (const [environment, verified] of Object.entries(VERIFIED_PROVIDERS)) {
      for (const provider of verified as readonly (typeof VIDEO_PROVIDERS)[number][]) {
        expect(REAL_ADAPTERS[provider], `${provider} verificado em ${environment}`).toBeDefined();
      }
    }
  });
});

describe('a suíte REPROVA adapters desonestos', () => {
  const run = (adapter: VideoAdapter, fixtures = remoteFixtures) =>
    checkClientAdapterContract(adapter, fixtures).join(' | ');

  it('declara reportsEnded sem evento correspondente, e emite o que não declara', () => {
    const lies = remoteAdapter({
      capabilities: { ...remoteAdapter().capabilities, reportsEnded: false },
    });
    expect(run(lies)).toMatch(/não declara reportsEnded, mas emite "ended"/);
    const silent = remoteAdapter();
    const noEndedFixtures = {
      ...remoteFixtures,
      messages: remoteFixtures.messages.filter((item) => item.expect?.type !== 'ended'),
    };
    expect(run(silent, noEndedFixtures)).toMatch(
      /declara reportsEnded, mas nenhuma fixture produz/,
    );
  });

  it('embed fora da allowlist ou com origem diferente da do src', () => {
    expect(
      run(
        remoteAdapter({
          buildEmbed: () => ({ src: 'https://evil.example/x', origin: 'https://evil.example' }),
        }),
      ),
    ).toMatch(/fora da allowlist/);
    expect(
      run(
        remoteAdapter({
          buildEmbed: ({ externalId, startAt }) => ({
            src: `https://player.exemplo.com/embed/${encodeURIComponent(externalId)}?t=${Math.floor(startAt)}`,
            origin: 'https://outra.origem',
          }),
        }),
      ),
    ).toMatch(/embed\.origin/);
  });

  it('ID hostil que troca o host do iframe', () => {
    const naive = remoteAdapter({
      buildEmbed: ({ externalId }) => ({
        src: externalId.startsWith('//')
          ? `https:${externalId}`
          : `https://player.exemplo.com/embed/${externalId}`,
        origin: 'https://player.exemplo.com',
      }),
    });
    expect(run(naive)).toMatch(/ID hostil/);
  });

  it('host curinga, resume que mente e normalize que lança', () => {
    expect(run(remoteAdapter({ allowedHosts: ['*.exemplo.com'] }))).toMatch(/host fora do formato/);
    expect(
      run(
        remoteAdapter({
          buildEmbed: () => ({
            src: 'https://player.exemplo.com/embed/x',
            origin: 'https://player.exemplo.com',
          }),
        }),
      ),
    ).toMatch(/declara resume, mas startAt não altera/);
    expect(
      run(
        remoteAdapter({
          normalize: () => {
            throw new Error('boom');
          },
        }),
      ),
    ).toMatch(/normalize lançou erro/);
  });

  it('host do adapter ausente de frame-src', () => {
    expect(run(remoteAdapter(), { ...remoteFixtures, headers })).toMatch(/não está em frame-src/);
  });
});
