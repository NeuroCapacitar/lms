import { describe, expect, it } from 'vitest';

import { VIDEO_PROVIDERS } from './providers';
import {
  isProviderUsable,
  isProviderVerified,
  providerAvailability,
  verificationEnvironment,
} from './verification';

const lists = { development: [], staging: ['vimeo'], production: ['vimeo', 'mux'] } as const;

describe('trava de ativação dos providers (M5-03)', () => {
  it('Production só aceita os verificados; Dev e Staging aceitam todos (com o aviso)', () => {
    expect(isProviderUsable('production', 'vimeo', lists)).toBe(true);
    expect(isProviderUsable('production', 'panda', lists)).toBe(false);
    for (const provider of VIDEO_PROVIDERS) {
      expect(isProviderUsable('staging', provider, lists)).toBe(true);
      expect(isProviderUsable('dev', provider, lists)).toBe(true);
    }
    expect(isProviderVerified('staging', 'vimeo', lists)).toBe(true);
    expect(isProviderVerified('staging', 'mux', lists)).toBe(false);
    expect(isProviderVerified('dev', 'vimeo', lists)).toBe(false);
  });

  it('ambiente desconhecido ou vazio é tratado como Production (falha fechada)', () => {
    for (const unknown of ['', 'prod', 'preview', 'STAGING']) {
      expect(verificationEnvironment(unknown)).toBe('production');
      expect(isProviderUsable(unknown, 'panda', lists)).toBe(false);
    }
    expect(verificationEnvironment('dev')).toBe('development');
    expect(verificationEnvironment('staging')).toBe('staging');
  });

  it('a lista de disponibilidade traz os seis providers com verified e selectable', () => {
    const production = providerAvailability('production', lists);
    expect(production.map((item) => item.provider)).toEqual([...VIDEO_PROVIDERS]);
    expect(production.filter((item) => item.selectable).map((item) => item.provider)).toEqual([
      'mux',
      'vimeo',
    ]);
    expect(providerAvailability('staging', lists).every((item) => item.selectable)).toBe(true);
  });

  it('com as listas REAIS de hoje, nenhum provider está verificado em lugar nenhum', () => {
    for (const environment of ['dev', 'staging', 'production']) {
      for (const provider of VIDEO_PROVIDERS) {
        expect(isProviderVerified(environment, provider), `${provider} em ${environment}`).toBe(
          false,
        );
      }
    }
    expect(isProviderUsable('production', 'youtube')).toBe(false);
  });
});
