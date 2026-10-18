import { describe, expect, it } from 'vitest';

import type { OpsAlert } from '../../features/ops/operations';
import { buildAlertEnvelope, sendAlertToSentry } from './sentry-alert';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const TARGET = { environment: 'staging', release: 'abc123' };
const DSN = 'https://chavepublica123@o999.ingest.sentry.io/4510000000000001';
const ALERT: OpsAlert = {
  code: 'backup_stale',
  severity: 'P1',
  message: 'O último backup do banco tem mais de 26 horas: confira o workflow de backup.',
};

function parts(envelope: string) {
  const [header, item, event] = envelope
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { header: header!, item: item!, event: event! };
}

describe('envelope do alerta para o Sentry', () => {
  it('é um evento com fingerprint pelo CÓDIGO (as repetições viram um problema só), nível e tags', () => {
    const { header, item, event } = parts(buildAlertEnvelope(ALERT, TARGET, NOW));
    expect(item).toEqual({ type: 'event' });
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(event.event_id).toBe(header.event_id);
    expect(event.fingerprint).toEqual(['backup_stale']);
    expect(event.level).toBe('error');
    expect(event.environment).toBe('staging');
    expect(event.release).toBe('abc123');
    expect(event.tags).toEqual({ severity: 'P1', alert_code: 'backup_stale' });
    expect(String(event.message)).toContain('P1 backup_stale');
  });

  it('o nível acompanha a severidade', () => {
    const level = (severity: OpsAlert['severity']) =>
      parts(buildAlertEnvelope({ ...ALERT, severity }, TARGET, NOW)).event.level;
    expect([level('P0'), level('P1'), level('P2'), level('P3')]).toEqual([
      'fatal',
      'error',
      'warning',
      'info',
    ]);
  });

  it('NUNCA leva dado pessoal: o texto passa pelo scrub e o evento não tem usuário, request nem cookie', () => {
    const leaky = { ...ALERT, message: 'falha para ana.souza@example.com com cookie abc' };
    const { event } = parts(buildAlertEnvelope(leaky, TARGET, NOW));
    expect(JSON.stringify(event)).not.toContain('ana.souza@example.com');
    expect(event).not.toHaveProperty('user');
    expect(event).not.toHaveProperty('request');
  });
});

describe('envio do alerta ao Sentry', () => {
  it('POST no endpoint de envelopes do projeto, com a chave pública do DSN e corpo do envelope', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const ok = await sendAlertToSentry(ALERT, { dsn: DSN, ...TARGET }, { fetcher, now: NOW });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://o999.ingest.sentry.io/api/4510000000000001/envelope/');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-sentry-auth']).toContain('sentry_key=chavepublica123');
    expect(headers['content-type']).toBe('application/x-sentry-envelope');
    expect(String(calls[0]!.init.body).split('\n')).toHaveLength(3);
  });

  it('resposta de erro e falha de rede devolvem false (sem lançar)', async () => {
    const bad = (async () => new Response('x', { status: 429 })) as unknown as typeof fetch;
    const down = (async () => {
      throw new Error('rede caiu');
    }) as unknown as typeof fetch;
    expect(await sendAlertToSentry(ALERT, { dsn: DSN, ...TARGET }, { fetcher: bad })).toBe(false);
    expect(await sendAlertToSentry(ALERT, { dsn: DSN, ...TARGET }, { fetcher: down })).toBe(false);
  });

  it('DSN inválido, sem https ou sem projeto numérico não faz requisição', async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    for (const dsn of [
      '',
      'não é url',
      'http://k@o1.ingest.sentry.io/1',
      'https://o1.ingest.sentry.io/1',
      'https://k@o1.ingest.sentry.io/abc',
    ]) {
      expect(await sendAlertToSentry(ALERT, { dsn, ...TARGET }, { fetcher })).toBe(false);
    }
    expect(called).toBe(false);
  });
});
