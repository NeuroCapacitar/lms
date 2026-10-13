import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { checkProviderAdapterContract } from '../../features/video/provider-adapter-contract';
import { VIDEO_PROVIDERS, type VideoProvider } from '../../features/video/providers';
import { VERIFIED_PROVIDERS } from '../../features/video/verification';
import { PROVIDER_ADAPTERS } from './provider-adapters';

/**
 * Trava de ativação (M5-03): um provider só entra em `VERIFIED_PROVIDERS` com (1) o adapter do servidor
 * registrado e aprovado na suíte de contrato, e (2) a evidência da conta real no STATUS
 * (`### Verificação de provider — <provider> (<data>)`). O checklist e o modelo da entrada estão em
 * `docs/operations/video-provider-checklist.md`.
 */
const STATUS = readFileSync('docs/implementation/STATUS.md', 'utf8');

function hasVerificationEvidence(statusText: string, provider: VideoProvider): boolean {
  return new RegExp(`^### Verificação de provider — ${provider} \\(\\d{4}-\\d{2}-\\d{2}`, 'm').test(
    statusText,
  );
}

/** Fixtures gravadas por provider (preenchidas por M5-08 a M5-13, junto do adapter). */
const CONTRACT_FIXTURES: Partial<
  Record<VideoProvider, Parameters<typeof checkProviderAdapterContract>[1]>
> = {};

describe('ativação de providers de vídeo (M5-03)', () => {
  it('o detector de evidência exige o título completo, com a data', () => {
    const entry = '### Verificação de provider — vimeo (2027-01-05)\n- conta: ...';
    expect(hasVerificationEvidence(entry, 'vimeo')).toBe(true);
    expect(hasVerificationEvidence(entry, 'mux')).toBe(false);
    expect(hasVerificationEvidence('Verificação de provider — vimeo (2027-01-05)', 'vimeo')).toBe(
      false,
    );
    expect(hasVerificationEvidence('### Verificação de provider — vimeo', 'vimeo')).toBe(false);
  });

  it('todo provider verificado em QUALQUER ambiente tem adapter registrado e evidência no STATUS', () => {
    for (const [environment, verified] of Object.entries(VERIFIED_PROVIDERS)) {
      for (const provider of verified as readonly VideoProvider[]) {
        expect(
          PROVIDER_ADAPTERS[provider],
          `${provider} (${environment}): sem adapter`,
        ).toBeDefined();
        expect(
          hasVerificationEvidence(STATUS, provider),
          `${provider} (${environment}): sem entrada "### Verificação de provider — ${provider} (data)" no STATUS`,
        ).toBe(true);
      }
    }
  });

  it('o adapter registrado de cada provider roda a suíte de contrato (sem fixture, o CI falha)', async () => {
    for (const provider of VIDEO_PROVIDERS) {
      const adapter = PROVIDER_ADAPTERS[provider];
      if (!adapter) continue;
      expect(adapter.provider).toBe(provider);
      // M5-08 a M5-13: registre a fixture gravada do provider aqui e rode checkProviderAdapterContract.
      const fixtures = CONTRACT_FIXTURES[provider];
      expect(fixtures, `${provider}: adapter registrado sem fixture de contrato`).toBeDefined();
      expect(await checkProviderAdapterContract(adapter, fixtures!)).toEqual([]);
    }
  });

  it('hoje nenhum adapter real existe e nenhum provider está verificado', () => {
    expect(Object.keys(PROVIDER_ADAPTERS)).toEqual([]);
    expect(Object.values(VERIFIED_PROVIDERS).flat()).toEqual([]);
  });
});
