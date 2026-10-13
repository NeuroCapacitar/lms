import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeAdapter } from './fake-adapter';
import { isAllowedEmbed } from './adapter';
import {
  ProgressReporter,
  type ProgressPayload,
  type ReporterDeps,
  type SendOutcome,
} from './progress-reporter';

const ok = (overrides: Partial<Extract<SendOutcome, { kind: 'ok' }>> = {}): SendOutcome => ({
  kind: 'ok',
  completed: false,
  maxPosition: 0,
  courseJustCompleted: false,
  ...overrides,
});

function setup(overrides: Partial<ReporterDeps> = {}) {
  const sent: { payload: ProgressPayload; keepalive: boolean }[] = [];
  const completed: unknown[] = [];
  let denied = 0;
  let outcome: SendOutcome = ok();
  const reporter = new ProgressReporter({
    assetId: 'asset-1',
    sessionId: 'sessao-teste-0001',
    knownDuration: 600,
    startPosition: 0,
    send: async (payload, options) => {
      sent.push({ payload, keepalive: options.keepalive });
      return outcome;
    },
    onCompleted: (value) => completed.push(value),
    onDenied: () => {
      denied += 1;
    },
    ...overrides,
  });
  return {
    reporter,
    sent,
    completed,
    denied: () => denied,
    setOutcome: (next: SendOutcome) => {
      outcome = next;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('envio do progresso', () => {
  it('heartbeat a cada 20 s SÓ enquanto reproduz, com seq crescente na mesma sessão', () => {
    const { reporter, sent } = setup();
    reporter.handle({ type: 'play' });
    reporter.handle({ type: 'timeupdate', t: 19.5 });
    vi.advanceTimersByTime(20_000);
    reporter.handle({ type: 'timeupdate', t: 39.5 });
    vi.advanceTimersByTime(20_000);
    expect(sent.map((item) => item.payload)).toEqual([
      { videoAssetId: 'asset-1', playbackSessionId: 'sessao-teste-0001', seq: 1, position: 19.5 },
      { videoAssetId: 'asset-1', playbackSessionId: 'sessao-teste-0001', seq: 2, position: 39.5 },
    ]);
    reporter.dispose();
  });

  it('pausado, não há heartbeat; a pausa e o seek enviam na hora', () => {
    const { reporter, sent } = setup();
    reporter.handle({ type: 'play' });
    reporter.handle({ type: 'timeupdate', t: 10 });
    reporter.handle({ type: 'pause' });
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(120_000);
    expect(sent).toHaveLength(1); // parou o relógio
    reporter.handle({ type: 'seeked', t: 540 });
    expect(sent.map((item) => item.payload.position)).toEqual([10, 540]);
    reporter.dispose();
  });

  it('o fim envia a duração conhecida quando o provider não emite o tempo; saída da página usa keepalive', () => {
    const { reporter, sent } = setup();
    reporter.handle({ type: 'play' });
    reporter.handle({ type: 'ended' });
    expect(sent.at(-1)!.payload.position).toBe(600);
    expect(sent.at(-1)!.keepalive).toBe(false);
    const second = setup();
    second.reporter.handle({ type: 'timeupdate', t: 123 });
    second.reporter.flush();
    expect(second.sent).toEqual([
      expect.objectContaining({
        keepalive: true,
        payload: expect.objectContaining({ position: 123 }),
      }),
    ]);
  });

  it('uma pausa antes de qualquer timeupdate envia o ponto de retomada, nunca zero', () => {
    const { reporter, sent } = setup({ startPosition: 321 });
    reporter.handle({ type: 'pause' });
    expect(sent[0]!.payload.position).toBe(321);
  });

  it('a duração observada só vai quando o servidor ainda não a conhece', () => {
    const unknown = setup({ knownDuration: null });
    unknown.reporter.handle({ type: 'durationchange', duration: 600 });
    unknown.reporter.handle({ type: 'seeked', t: 5 });
    expect(unknown.sent[0]!.payload.duration).toBe(600);
    const known = setup();
    known.reporter.handle({ type: 'durationchange', duration: 600 });
    known.reporter.handle({ type: 'seeked', t: 5 });
    expect(known.sent[0]!.payload.duration).toBeUndefined();
  });

  it('concluída: avisa UMA vez e para de enviar; acesso negado: avisa e para', async () => {
    const done = setup();
    done.setOutcome(ok({ completed: true, maxPosition: 560 }));
    done.reporter.handle({ type: 'seeked', t: 560 });
    await vi.advanceTimersByTimeAsync(0);
    expect(done.completed).toHaveLength(1);
    done.reporter.handle({ type: 'seeked', t: 590 });
    done.reporter.flush();
    expect(done.sent).toHaveLength(1);

    const refused = setup();
    refused.setOutcome({ kind: 'denied' });
    refused.reporter.handle({ type: 'play' });
    refused.reporter.handle({ type: 'seeked', t: 30 });
    await vi.advanceTimersByTimeAsync(0);
    expect(refused.denied()).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(refused.sent).toHaveLength(1);
  });

  it('falha de rede não derruba o player: o envio seguinte continua com seq maior', async () => {
    const sent: number[] = [];
    let fail = true;
    const reporter = new ProgressReporter({
      assetId: 'a',
      sessionId: 'sessao-teste-0001',
      knownDuration: 600,
      startPosition: 0,
      send: async (payload) => {
        sent.push(payload.seq);
        if (fail) throw new Error('rede');
        return ok();
      },
      onCompleted: () => {},
      onDenied: () => {},
    });
    reporter.handle({ type: 'seeked', t: 10 });
    await vi.advanceTimersByTimeAsync(0);
    fail = false;
    reporter.handle({ type: 'seeked', t: 20 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([1, 2]);
  });

  it('descartado (dispose) não envia nada', () => {
    const { reporter, sent } = setup();
    reporter.dispose();
    reporter.handle({ type: 'seeked', t: 1 });
    reporter.flush();
    expect(sent).toHaveLength(0);
  });
});

describe('adapter falso e allowlist do embed', () => {
  const adapter = createFakeAdapter();
  const message = (data: unknown) => ({ data }) as MessageEvent;

  it('só traduz mensagens do próprio formato e ignora o resto', () => {
    expect(adapter.normalize(message({ source: 'fake-video', type: 'timeupdate', t: 12 }))).toEqual(
      {
        type: 'timeupdate',
        t: 12,
      },
    );
    expect(adapter.normalize(message({ source: 'fake-video', type: 'ended' }))).toEqual({
      type: 'ended',
    });
    for (const bad of [
      null,
      'texto',
      { type: 'ended' },
      { source: 'outro', type: 'ended' },
      { source: 'fake-video', type: 'timeupdate', t: 'x' },
      { source: 'fake-video', type: 'timeupdate', t: Number.NaN },
      { source: 'fake-video', type: 'inventado' },
    ]) {
      expect(adapter.normalize(message(bad)), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('o iframe só aceita https de host da allowlist (http só em localhost)', () => {
    const hosts = ['player.exemplo.com'];
    expect(isAllowedEmbed('https://player.exemplo.com/embed/abc', hosts)).toBe(true);
    expect(isAllowedEmbed('https://evil.example/embed/abc', hosts)).toBe(false);
    expect(isAllowedEmbed('http://player.exemplo.com/embed/abc', hosts)).toBe(false);
    expect(isAllowedEmbed('javascript:alert(1)', hosts)).toBe(false);
    expect(isAllowedEmbed('data:text/html,x', hosts)).toBe(false);
    expect(isAllowedEmbed('//player.exemplo.com/x', hosts)).toBe(false);
    expect(isAllowedEmbed('/fake-video.html', ['self'])).toBe(true);
    expect(isAllowedEmbed('/fake-video.html', hosts)).toBe(false);
    expect(isAllowedEmbed('http://localhost:5173/x', ['localhost'])).toBe(true);
  });
});
