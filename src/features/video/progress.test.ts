import { describe, expect, it } from 'vitest';

import {
  decideProgress,
  plausibleDuration,
  reachedThreshold,
  videoProgressSchema,
  type VideoProgressState,
} from './progress';

const SESSION = 'sessao-aba-um';
const fresh = (overrides: Partial<VideoProgressState> = {}): VideoProgressState => ({
  maxPosition: 0,
  lastSessionId: null,
  lastSeq: 0,
  completed: false,
  ...overrides,
});
const report = (position: number, seq = 1, playbackSessionId = SESSION) => ({
  playbackSessionId,
  seq,
  position,
});

describe('limiar de conclusão', () => {
  it('89% não conclui e 90% conclui (inteiros, sem ponto flutuante)', () => {
    expect(reachedThreshold(539, 600)).toBe(false); // 89,83%
    expect(reachedThreshold(540, 600)).toBe(true); // 90%
    expect(reachedThreshold(89, 100)).toBe(false);
    expect(reachedThreshold(90, 100)).toBe(true);
    expect(reachedThreshold(100, 100)).toBe(true);
  });

  it('respeita o limiar do curso e nunca conclui com duração zero', () => {
    expect(reachedThreshold(80, 100, 80)).toBe(true);
    expect(reachedThreshold(79, 100, 80)).toBe(false);
    expect(reachedThreshold(100, 100, 100)).toBe(true);
    expect(reachedThreshold(99, 100, 100)).toBe(false);
    expect(reachedThreshold(0, 0)).toBe(false);
  });
});

describe('decisão de progresso', () => {
  it('guarda a MAIOR posição: voltar no vídeo não a reduz', () => {
    const first = decideProgress(fresh(), report(300, 1), 600);
    expect(first).toEqual({ kind: 'update', maxPosition: 300, completes: false });
    const back = decideProgress(
      fresh({ maxPosition: 300, lastSessionId: SESSION, lastSeq: 1 }),
      report(10, 2),
      600,
    );
    expect(back).toEqual({ kind: 'update', maxPosition: 300, completes: false });
  });

  it('seek direto ao limiar conclui; um segundo antes não', () => {
    expect(decideProgress(fresh(), report(539.9), 600)).toMatchObject({ completes: false });
    expect(decideProgress(fresh(), report(540), 600)).toMatchObject({ completes: true });
  });

  it('a fração é descartada PARA BAIXO e a posição é limitada à duração', () => {
    expect(decideProgress(fresh(), report(539.999), 600)).toMatchObject({ maxPosition: 539 });
    expect(decideProgress(fresh(), report(99_999), 600)).toMatchObject({
      maxPosition: 600,
      completes: true,
    });
  });

  it('seq repetido ou menor, na MESMA sessão, é ignorado; sessão nova é aceita', () => {
    const state = fresh({ maxPosition: 100, lastSessionId: SESSION, lastSeq: 5 });
    expect(decideProgress(state, report(200, 5), 600)).toEqual({
      kind: 'ignored',
      reason: 'stale_seq',
    });
    expect(decideProgress(state, report(200, 4), 600)).toEqual({
      kind: 'ignored',
      reason: 'stale_seq',
    });
    expect(decideProgress(state, report(200, 6), 600)).toMatchObject({
      kind: 'update',
      maxPosition: 200,
    });
    // Outra aba (outra sessão) recomeça a contagem sem ser tratada como atrasada.
    expect(decideProgress(state, report(150, 1, 'sessao-aba-dois'), 600)).toMatchObject({
      kind: 'update',
      maxPosition: 150,
    });
  });

  it('aula já concluída ignora tudo (idempotência)', () => {
    expect(
      decideProgress(fresh({ completed: true, maxPosition: 560 }), report(600, 9), 600),
    ).toEqual({ kind: 'ignored', reason: 'already_completed' });
  });

  it('posição negativa nunca entra (limitada a zero)', () => {
    expect(decideProgress(fresh(), report(-5), 600)).toMatchObject({ maxPosition: 0 });
  });
});

describe('duração plausível', () => {
  it('aceita 1 s a 24 h (inteiro, para baixo) e recusa o resto', () => {
    expect(plausibleDuration(600.9)).toBe(600);
    expect(plausibleDuration(1)).toBe(1);
    expect(plausibleDuration(86_400)).toBe(86_400);
    for (const bad of [0, 0.5, -3, 86_401, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(plausibleDuration(bad as number | undefined), String(bad)).toBeUndefined();
    }
  });
});

describe('corpo do envio', () => {
  const valid = {
    videoAssetId: '3f0c7a52-8d1b-4c63-9b1e-6a3f5d2c9e10',
    playbackSessionId: 'sessao-aba-um',
    seq: 3,
    position: 12.5,
  };

  it('aceita o corpo válido e a duração observada opcional', () => {
    expect(videoProgressSchema.safeParse(valid).success).toBe(true);
    expect(videoProgressSchema.safeParse({ ...valid, duration: 600 }).success).toBe(true);
  });

  it('é estrito: campo a mais, sessão malformada, seq ou posição absurdos são recusados', () => {
    for (const bad of [
      { ...valid, extra: 1 },
      { ...valid, clientTs: 1 },
      { ...valid, videoAssetId: 'nao-uuid' },
      { ...valid, playbackSessionId: 'curto' },
      { ...valid, playbackSessionId: 'tem espaço e <tag>' },
      { ...valid, seq: -1 },
      { ...valid, seq: 1.5 },
      { ...valid, position: -1 },
      { ...valid, position: Number.NaN },
      { ...valid, position: 1_000_000 },
      { ...valid, duration: -1 },
    ]) {
      expect(videoProgressSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
