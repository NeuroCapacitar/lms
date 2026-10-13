import { describe, expect, it } from 'vitest';

import {
  VIDEO_PROVIDERS,
  VIDEO_PROVIDER_LABELS,
  createConnectionSchema,
  rotateSecretSchema,
  secretRequired,
} from './providers';

describe('providers de vídeo', () => {
  it('são os seis da v1, todos com rótulo', () => {
    expect([...VIDEO_PROVIDERS].sort()).toEqual(
      ['cloudflare_stream', 'jmvstream', 'mux', 'panda', 'vimeo', 'youtube'].sort(),
    );
    for (const provider of VIDEO_PROVIDERS) expect(VIDEO_PROVIDER_LABELS[provider]).toBeTruthy();
  });

  it('só YouTube e Vimeo funcionam sem credenciais', () => {
    expect(secretRequired('youtube')).toBe(false);
    expect(secretRequired('vimeo')).toBe(false);
    for (const provider of ['jmvstream', 'panda', 'cloudflare_stream', 'mux'] as const) {
      expect(secretRequired(provider), provider).toBe(true);
    }
  });

  it('o corpo de cadastro é estrito: provider conhecido, rótulo de 1 a 80, segredo opcional e limitado', () => {
    expect(
      createConnectionSchema.safeParse({
        provider: 'mux',
        label: ' Conta do cliente ',
        secret: 's',
      }).success,
    ).toBe(true);
    expect(createConnectionSchema.parse({ provider: 'youtube', label: ' Público ' }).label).toBe(
      'Público',
    );
    for (const invalid of [
      { provider: 'dailymotion', label: 'x' },
      { provider: 'mux', label: '' },
      { provider: 'mux', label: 'x'.repeat(81) },
      { provider: 'mux', label: 'x', secret: '' },
      { provider: 'mux', label: 'x', secret: 'y'.repeat(4097) },
      { provider: 'mux', label: 'x', extra: 1 },
    ]) {
      expect(createConnectionSchema.safeParse(invalid).success, JSON.stringify(invalid)).toBe(
        false,
      );
    }
    expect(rotateSecretSchema.safeParse({ secret: 'novo' }).success).toBe(true);
    expect(rotateSecretSchema.safeParse({}).success).toBe(false);
  });
});
