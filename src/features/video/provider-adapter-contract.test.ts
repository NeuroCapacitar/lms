import { describe, expect, it } from 'vitest';

import {
  ProviderError,
  type ProviderTransport,
  type VideoProviderAdapter,
} from './provider-adapter';
import {
  checkProviderAdapterContract,
  type ProviderContractFixtures,
} from './provider-adapter-contract';

/** Adapter de REFERÊNCIA (de teste, `vimeo`-like): mostra a forma esperada e prova que a suíte o aprova. */
function referenceAdapter(overrides: Partial<VideoProviderAdapter> = {}): VideoProviderAdapter {
  return {
    provider: 'vimeo',
    capabilities: { managedUpload: true, signedPlayback: false, domainRestriction: true },
    normalizeReference(input) {
      const match = /^(?:https:\/\/vimeo\.com\/)?(\d{6,12})$/.exec(input.trim());
      return match
        ? { ok: true, externalId: match[1]! }
        : { ok: false, reason: 'invalid_reference' };
    },
    async getStatus(transport, externalId) {
      let response;
      try {
        response = await transport({ method: 'GET', path: `/videos/${externalId}` });
      } catch {
        throw new ProviderError('provider_unreachable');
      }
      if (response.status >= 400) throw new ProviderError('provider_rejected');
      const body = response.body as { state?: unknown; duration?: unknown } | null;
      if (!body || typeof body.state !== 'string') throw new ProviderError('provider_malformed');
      if (body.state === 'ready' && typeof body.duration === 'number') {
        return { status: 'ready', durationSeconds: body.duration };
      }
      return { status: body.state === 'error' ? 'failed' : 'processing' };
    },
    async deleteAsset(transport, asset) {
      if (asset.origin !== 'managed') throw new ProviderError('provider_rejected');
      await transport({ method: 'DELETE', path: `/videos/${asset.externalId}` });
    },
    ...overrides,
  };
}

const fixtures: ProviderContractFixtures = {
  accepts: [
    { input: '123456789', externalId: '123456789' },
    { input: 'https://vimeo.com/123456789', externalId: '123456789' },
  ],
  statuses: [
    {
      externalId: '123456789',
      response: { status: 200, body: { state: 'ready', duration: 600 } },
      expect: { status: 'ready', durationSeconds: 600 },
    },
    {
      externalId: '123456789',
      response: { status: 200, body: { state: 'transcoding' } },
      expect: { status: 'processing' },
    },
    {
      externalId: '123456789',
      response: { status: 200, body: { state: 'error' } },
      expect: { status: 'failed' },
    },
  ],
  errors: [
    { externalId: '123456789', response: { status: 404, body: {} }, code: 'provider_rejected' },
    {
      externalId: '123456789',
      response: { status: 200, body: 'lixo' },
      code: 'provider_malformed',
    },
  ],
};

const run = async (adapter: VideoProviderAdapter, f = fixtures) =>
  (await checkProviderAdapterContract(adapter, f)).join(' | ');

describe('suíte de contrato do adapter (servidor)', () => {
  it('o adapter de referência cumpre o contrato', async () => {
    expect(await checkProviderAdapterContract(referenceAdapter(), fixtures)).toEqual([]);
  });

  it('sem managedUpload não há deleteAsset (e vice-versa)', async () => {
    const readOnly = referenceAdapter({
      capabilities: { managedUpload: false, signedPlayback: false, domainRestriction: true },
      deleteAsset: undefined,
    });
    expect(await run(readOnly)).toBe('');
    expect(
      await run(
        referenceAdapter({
          capabilities: { managedUpload: false, signedPlayback: false, domainRestriction: true },
        }),
      ),
    ).toMatch(/não declara managedUpload, mas implementa deleteAsset/);
    expect(await run(referenceAdapter({ deleteAsset: undefined }))).toMatch(
      /declara managedUpload, mas não implementa deleteAsset/,
    );
  });
});

describe('a suíte REPROVA adapters desonestos', () => {
  it('aceita entrada hostil (host de outro site, javascript:, controle)', async () => {
    const lax = referenceAdapter({
      normalizeReference: (input) =>
        input.length > 0 && !input.includes(' ') && !input.includes('\n')
          ? {
              ok: true,
              externalId: input.replace(/^https:\/\/vimeo\.com\//, '').split(/[/?#]/)[0]!,
            }
          : { ok: false, reason: 'invalid_reference' },
    });
    expect(await run(lax)).toMatch(/aceitou entrada hostil/);
  });

  it('apaga asset `referenced` ou chama o provider ao recusar', async () => {
    const destructive = referenceAdapter({
      deleteAsset: async (transport, asset) => {
        await transport({ method: 'DELETE', path: `/videos/${asset.externalId}` });
      },
    });
    const text = await run(destructive);
    expect(text).toMatch(/apagou um asset `referenced`/);
    expect(text).toMatch(/chamou o provider ao recusar/);
  });

  it('erro que vaza o texto da rede (possível segredo) ou não é ProviderError', async () => {
    class Leaky extends ProviderError {
      constructor(cause: unknown) {
        super('provider_unreachable');
        this.message = String((cause as Error).message);
      }
    }
    const leaky = referenceAdapter({
      getStatus: async (transport: ProviderTransport, externalId) => {
        try {
          await transport({ method: 'GET', path: `/videos/${externalId}` });
        } catch (error) {
          throw new Leaky(error);
        }
        return { status: 'ready' };
      },
    });
    // Variante pior: deixa o Error cru da rede escapar.
    const raw = referenceAdapter({
      getStatus: async (transport, externalId) => {
        await transport({ method: 'GET', path: `/videos/${externalId}` });
        return { status: 'ready' };
      },
    });
    expect(await run(raw)).toMatch(/deveria lançar ProviderError/);
    expect(await run(leaky)).toMatch(/vazou o texto da falha de rede/);
  });

  it('estado diferente do gravado e resposta ruim engolida', async () => {
    const wrong = referenceAdapter({ getStatus: async () => ({ status: 'ready' }) });
    const text = await run(wrong);
    expect(text).toMatch(/getStatus: esperava/);
    expect(text).toMatch(/getStatus deveria falhar/);
  });
});
