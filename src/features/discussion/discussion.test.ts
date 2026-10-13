import { describe, expect, it } from 'vitest';

import {
  MAX_BODY_LENGTH,
  createPostSchema,
  moderateSchema,
  nextState,
  normalizeText,
  reportSchema,
} from './discussion';

describe('texto simples', () => {
  it('normaliza quebras, remove controle, bidi e largura zero, limita linhas em branco e apara', () => {
    expect(normalizeText('  oi\r\nmundo\r\n\r\n\r\n\r\nfim  ')).toBe('oi\nmundo\n\nfim');
    expect(normalizeText('a\u0000b\u0007c\u007fd')).toBe('abcd');
    expect(normalizeText('abc‮def​⁦x')).toBe('abcdefx');
    expect(normalizeText('\ttab\tdentro\t')).toBe('tab\tdentro');
  });

  it('HTML e Markdown ficam como TEXTO (a tela escapa); nada é interpretado aqui', () => {
    const body = '<img src=x onerror=alert(1)> **negrito** [link](javascript:alert(1))';
    expect(createPostSchema.parse({ body }).body).toBe(body);
  });

  it('o corpo precisa ter texto e caber no limite; campos a mais e parentId malformado são recusados', () => {
    for (const bad of [
      { body: '' },
      { body: '   \n  ' },
      { body: '​‮' },
      { body: 'x'.repeat(MAX_BODY_LENGTH + 1) },
      { body: 'ok', extra: 1 },
      { body: 'ok', parentId: 'nao-uuid' },
      {},
      { body: 42 },
    ]) {
      expect(createPostSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
    expect(createPostSchema.safeParse({ body: 'x'.repeat(MAX_BODY_LENGTH) }).success).toBe(true);
    expect(createPostSchema.safeParse({ body: 'ok', parentId: crypto.randomUUID() }).success).toBe(
      true,
    );
  });

  it('o limite conta DEPOIS de normalizar (espaços nas pontas não contam)', () => {
    expect(createPostSchema.safeParse({ body: `  ${'x'.repeat(MAX_BODY_LENGTH)}  ` }).success).toBe(
      true,
    );
  });

  it('denúncia: motivo opcional até 300; moderação exige motivo de 3 a 300 e ação válida', () => {
    expect(reportSchema.safeParse({}).success).toBe(true);
    expect(reportSchema.safeParse({ reason: 'x'.repeat(301) }).success).toBe(false);
    expect(moderateSchema.safeParse({ action: 'hide', reason: 'ofensivo' }).success).toBe(true);
    for (const bad of [
      { action: 'hide' },
      { action: 'hide', reason: 'ab' },
      { action: 'hide', reason: '   ' },
      { action: 'apagar', reason: 'motivo' },
      { action: 'hide', reason: 'motivo', extra: true },
    ]) {
      expect(moderateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('transições da moderação', () => {
  it('ocultar só o visível; excluir é definitivo; restaurar só o oculto', () => {
    expect(nextState('visible', 'hide')).toBe('hidden');
    expect(nextState('hidden', 'hide')).toBeNull();
    expect(nextState('deleted', 'hide')).toBeNull();
    expect(nextState('visible', 'delete')).toBe('deleted');
    expect(nextState('hidden', 'delete')).toBe('deleted');
    expect(nextState('deleted', 'delete')).toBeNull();
    expect(nextState('hidden', 'restore')).toBe('visible');
    expect(nextState('visible', 'restore')).toBeNull();
    // o que o próprio autor excluiu não volta
    expect(nextState('deleted', 'restore')).toBeNull();
  });
});
