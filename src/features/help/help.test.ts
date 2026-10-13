import { describe, expect, it } from 'vitest';

import { richTextFromParagraph } from '../content/rich-text';
import {
  HELP_CATEGORIES,
  HELP_CATEGORY_LABELS,
  MAX_REQUEST_LENGTH,
  faqItemSchema,
  isSafeReplyTo,
  moveFaqSchema,
  supportRequestSchema,
} from './help';

describe('ajuda e suporte', () => {
  it('toda categoria tem rótulo em português', () => {
    for (const category of HELP_CATEGORIES) expect(HELP_CATEGORY_LABELS[category]).toBeTruthy();
  });

  it('pedido de suporte: categoria fixa, texto simples normalizado de 1 a 2000, contexto só por uuid, sem campo a mais', () => {
    const base = {
      category: 'acesso',
      message: '  Não consigo abrir a aula.\r\n\r\n\r\n\r\nObrigada  ',
    };
    expect(supportRequestSchema.parse(base).message).toBe('Não consigo abrir a aula.\n\nObrigada');
    expect(
      supportRequestSchema.parse({ ...base, courseId: crypto.randomUUID() }).courseId,
    ).toBeTruthy();
    for (const bad of [
      { ...base, category: 'financeiro' },
      { ...base, message: '   ' },
      { ...base, message: 'x'.repeat(MAX_REQUEST_LENGTH + 1) },
      { ...base, courseId: 'x' },
      { ...base, replyTo: 'outro@exemplo.com' },
      { ...base, userId: 'outra-pessoa' },
      { category: 'acesso' },
    ]) {
      expect(supportRequestSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 70)).toBe(
        false,
      );
    }
  });

  it('item da FAQ: resposta é texto rico válido (HTML cru e tipos fora da allowlist são recusados)', () => {
    const answer = richTextFromParagraph('Use o link enviado ao seu e-mail.');
    expect(
      faqItemSchema.safeParse({ category: 'conta', question: 'Como entro?', answer }).success,
    ).toBe(true);
    for (const bad of [
      { category: 'conta', question: '', answer },
      { category: 'conta', question: 'ok', answer: '<script>alert(1)</script>' },
      { category: 'conta', question: 'ok', answer: { type: 'doc', content: [{ type: 'script' }] } },
      { category: 'inexistente', question: 'ok', answer },
      { category: 'conta', question: 'ok', answer, extra: 1 },
    ]) {
      expect(faqItemSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 70)).toBe(false);
    }
  });

  it('mover só aceita up ou down', () => {
    expect(moveFaqSchema.safeParse({ direction: 'up' }).success).toBe(true);
    expect(moveFaqSchema.safeParse({ direction: 'left' }).success).toBe(false);
  });

  it('Reply-To: uma caixa válida; quebra de linha, vários destinatários e nome com <> são recusados', () => {
    expect(isSafeReplyTo('ana.souza+curso@exemplo.com.br')).toBe(true);
    for (const bad of [
      'ana@exemplo.com\r\nBcc: alguem@x.com',
      'ana@exemplo.com\nSubject: x',
      'ana@exemplo.com, bia@exemplo.com',
      'Ana <ana@exemplo.com>',
      'ana @exemplo.com',
      'sem-arroba',
      'ana@semponto',
      '',
      `${'a'.repeat(250)}@x.com`,
    ]) {
      expect(isSafeReplyTo(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
