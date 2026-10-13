import { describe, expect, it } from 'vitest';

import { ENVELOPE_VERSION, buildEnvelope, laneOfQueueName, parseEnvelope } from './envelope';

const ID = '3f0c7a52-8d1b-4c63-9b1e-6a3f5d2c9e10';
const valid = { v: ENVELOPE_VERSION, kind: 'system.demo', intentId: ID, correlationId: 'corr-1' };

describe('envelope da Queue', () => {
  it('aceita o envelope válido e o monta de volta', () => {
    expect(parseEnvelope(valid)).toEqual({ ok: true, envelope: valid });
    expect(buildEnvelope({ kind: 'system.demo', intentId: ID, correlationId: 'corr-1' })).toEqual(
      valid,
    );
  });

  it('versão desconhecida e antiga não são ignoradas', () => {
    expect(parseEnvelope({ ...valid, v: 2 })).toEqual({
      ok: false,
      problem: 'unknown_version',
      intentId: ID,
    });
    expect(parseEnvelope({ ...valid, v: 0 })).toMatchObject({ problem: 'unknown_version' });
    const { v: _omitted, ...withoutVersion } = valid;
    expect(parseEnvelope(withoutVersion)).toMatchObject({ ok: false, problem: 'invalid_shape' });
  });

  it('kind desconhecido devolve o id da intenção para o alerta', () => {
    expect(parseEnvelope({ ...valid, kind: 'nao.existe' })).toEqual({
      ok: false,
      problem: 'unknown_kind',
      intentId: ID,
    });
    expect(parseEnvelope({ ...valid, kind: 'toString' })).toMatchObject({
      problem: 'unknown_kind',
    });
  });

  it('campo a mais (dado pessoal), id inválido e corpo que não é objeto são recusados', () => {
    expect(parseEnvelope({ ...valid, email: 'ana@example.com' })).toMatchObject({
      ok: false,
      problem: 'invalid_shape',
    });
    expect(parseEnvelope({ ...valid, intentId: 'ana@example.com' })).toEqual({
      ok: false,
      problem: 'invalid_shape',
      intentId: undefined,
    });
    for (const body of [null, undefined, 'texto', 42, [], {}]) {
      expect(parseEnvelope(body)).toMatchObject({ ok: false });
    }
  });
});

describe('lane pelo nome da fila', () => {
  it('reconhece fila de trabalho e DLQ em qualquer ambiente', () => {
    expect(laneOfQueueName('hub-finance')).toEqual({ queue: 'finance', dlq: false });
    expect(laneOfQueueName('hub-staging-general')).toEqual({ queue: 'general', dlq: false });
    expect(laneOfQueueName('hub-production-finance-dlq')).toEqual({
      queue: 'finance',
      dlq: true,
    });
    expect(laneOfQueueName('hub-general-dlq')).toEqual({ queue: 'general', dlq: true });
  });

  it('nome fora do padrão não é adivinhado', () => {
    for (const name of ['', 'hub', 'hub-media', 'finance-extra', 'hub-financeiro']) {
      expect(laneOfQueueName(name), name).toBeUndefined();
    }
  });
});
