import { describe, expect, it } from 'vitest';

import { CROP_TARGETS, QUALITY_STEPS, centerCrop, planCrop } from './crop';
import { MEDIA_PURPOSES, verifyUploadedBytes } from './media';

describe('recorte do master no navegador', () => {
  it('o recorte é centrado e tem a proporção do destino (sobra cortada dos dois lados)', () => {
    // foto larga (3:1) para 16:9: corta dos lados
    expect(centerCrop(3000, 1000, 1280, 720)).toEqual({ sx: 611, sy: 0, sw: 1778, sh: 1000 });
    // foto alta (1:2) para 16:9: corta em cima e embaixo
    expect(centerCrop(1000, 2000, 1280, 720)).toEqual({ sx: 0, sy: 718, sw: 1000, sh: 563 });
    // já na proporção: não corta
    expect(centerCrop(2560, 1440, 1280, 720)).toEqual({ sx: 0, sy: 0, sw: 2560, sh: 1440 });
  });

  it('a saída nunca passa do alvo nem amplia a origem; a proporção bate com a exigida pelo servidor (±2%)', () => {
    for (const purpose of ['course_cover', 'course_banner'] as const) {
      const target = CROP_TARGETS[purpose];
      const rule = MEDIA_PURPOSES[purpose];
      for (const [w, h] of [
        [4000, 3000],
        [1500, 1500],
        [2000, 500],
        [1700, 480],
        [900, 900],
      ] as const) {
        const plan = planCrop(purpose, w, h);
        if (!plan.ok) continue;
        expect(plan.width).toBeLessThanOrEqual(target.width);
        expect(plan.height).toBeLessThanOrEqual(target.height);
        expect(plan.width).toBeGreaterThanOrEqual(rule.minWidth);
        expect(Math.abs(plan.width / plan.height - rule.aspect) / rule.aspect).toBeLessThan(0.02);
      }
    }
  });

  it('origem pequena demais depois do recorte é recusada', () => {
    expect(planCrop('course_cover', 300, 200)).toEqual({ ok: false, reason: 'too_small' });
    expect(planCrop('course_banner', 800, 800)).toEqual({ ok: false, reason: 'too_small' });
    expect(planCrop('course_banner', 4000, 1000)).toMatchObject({
      ok: true,
      width: 1680,
      height: 420,
    });
  });

  it('o que o recorte produz passa na conferência do servidor (mesmas dimensões e proporção)', () => {
    for (const purpose of ['course_cover', 'course_banner'] as const) {
      const plan = planCrop(purpose, 5000, 3333);
      if (!plan.ok) throw new Error('esperava recorte válido');
      const bytes = new Uint8Array(300);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      const view = new DataView(bytes.buffer);
      view.setUint32(8, 13);
      bytes.set([0x49, 0x48, 0x44, 0x52], 12);
      view.setUint32(16, plan.width);
      view.setUint32(20, plan.height);
      expect(
        verifyUploadedBytes({ purpose, declaredType: 'image/png', declaredSize: 300, bytes }),
        purpose,
      ).toMatchObject({ ok: true });
    }
  });

  it('a escada de qualidade é decrescente', () => {
    expect([...QUALITY_STEPS]).toEqual([...QUALITY_STEPS].sort((a, b) => b - a));
  });
});
