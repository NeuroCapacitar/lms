import { describe, expect, it } from 'vitest';

import { INTENT_KINDS, MAX_ATTEMPTS, isIntentKind, retryDelayMs } from './intents';

const ID = '3f0c7a52-8d1b-4c63-9b1e-6a3f5d2c9e10';

describe('payload das intenções: só IDs', () => {
  const schema = INTENT_KINDS['system.demo'].payload;

  it('aceita um payload só com UUIDs', () => {
    expect(schema.safeParse({ subjectId: ID }).success).toBe(true);
  });

  it('rejeita campo a mais (e-mail, nome, token)', () => {
    expect(schema.safeParse({ subjectId: ID, email: 'ana@example.com' }).success).toBe(false);
    expect(schema.safeParse({ subjectId: ID, name: 'Ana' }).success).toBe(false);
    expect(schema.safeParse({ subjectId: ID, token: 'abc' }).success).toBe(false);
  });

  it('rejeita valor que não é UUID (e-mail no lugar do id)', () => {
    expect(schema.safeParse({ subjectId: 'ana@example.com' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('todo kind registrado tem payload estrito e fila válida', () => {
    for (const [kind, definition] of Object.entries(INTENT_KINDS)) {
      expect(['finance', 'general'], kind).toContain(definition.queue);
      expect(definition.payload.safeParse({ extra: ID }).success, kind).toBe(false);
    }
  });

  it('reconhece só kinds próprios (não os herdados do Object)', () => {
    expect(isIntentKind('system.demo')).toBe(true);
    expect(isIntentKind('toString')).toBe(false);
    expect(isIntentKind('email.unknown')).toBe(false);
  });
});

describe('backoff exponencial com jitter', () => {
  it('cresce a cada tentativa, entre metade e o total do teto', () => {
    expect(retryDelayMs(1, () => 0)).toBe(15_000);
    expect(retryDelayMs(1, () => 1)).toBe(30_000);
    expect(retryDelayMs(2, () => 1)).toBe(60_000);
    expect(retryDelayMs(3, () => 1)).toBe(120_000);
  });

  it('respeita o teto de 1 hora e não estoura com tentativas enormes', () => {
    expect(retryDelayMs(MAX_ATTEMPTS * 10, () => 1)).toBe(3_600_000);
    expect(retryDelayMs(1_000_000, () => 0)).toBe(1_800_000);
  });

  it('o jitter espalha: dois valores distintos para o mesmo número de tentativas', () => {
    expect(retryDelayMs(4, () => 0.1)).not.toBe(retryDelayMs(4, () => 0.9));
  });

  it('tentativa zero ou negativa se comporta como a primeira', () => {
    expect(retryDelayMs(0, () => 1)).toBe(30_000);
    expect(retryDelayMs(-3, () => 1)).toBe(30_000);
  });
});
