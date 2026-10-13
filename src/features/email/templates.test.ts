import { describe, expect, it } from 'vitest';

import {
  EMAIL_TEMPLATES,
  OUTBOX_PRIORITY_BY_CLASS,
  expectedVariableNames,
  isEmailTemplate,
  queuedContract,
} from './templates';

describe('contrato dos templates de e-mail', () => {
  it('lista os 10 do contrato antigo mais o magic-link', () => {
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual(
      [
        'magic-link',
        'reauth-link',
        'staff-invitation',
        'email-verification',
        'password-reset',
        'purchase-confirmed',
        'access-granted',
        'access-expiry-warning',
        'certificate-issued',
        'refund-completed',
        'support-request',
        'course-available',
      ].sort(),
    );
  });

  it('link com token é SEMPRE direto: nunca entra na outbox nem em email_message', () => {
    for (const name of [
      'magic-link',
      'reauth-link',
      'staff-invitation',
      'email-verification',
      'password-reset',
    ]) {
      expect(queuedContract(name), name).toBeUndefined();
      expect(EMAIL_TEMPLATES[name as keyof typeof EMAIL_TEMPLATES].critical).toBe(true);
    }
  });

  it('as variáveis guardadas são estritas: faltando, a mais ou fora do formato falham', () => {
    const contract = queuedContract('purchase-confirmed')!;
    expect(
      contract.variables.safeParse({ COURSE_TITLE: 'Curso', AMOUNT_BRL: 'R$ 10,00' }).success,
    ).toBe(true);
    expect(contract.variables.safeParse({ COURSE_TITLE: 'Curso' }).success).toBe(false);
    expect(
      contract.variables.safeParse({ COURSE_TITLE: 'Curso', AMOUNT_BRL: 'R$ 1', EMAIL: 'a@b.co' })
        .success,
    ).toBe(false);
    expect(contract.variables.safeParse({ COURSE_TITLE: '', AMOUNT_BRL: 'R$ 1' }).success).toBe(
      false,
    );
    const certificate = queuedContract('certificate-issued')!;
    expect(
      certificate.variables.safeParse({ COURSE_TITLE: 'C', CERTIFICATE_ID: 'não-é-uuid' }).success,
    ).toBe(false);
  });

  it('só o suporte vai para a caixa de suporte; os demais, para a pessoa', () => {
    expect(queuedContract('support-request')?.recipient).toBe('support_inbox');
    for (const name of ['purchase-confirmed', 'access-granted', 'course-available']) {
      expect(queuedContract(name)?.recipient, name).toBe('user');
    }
  });

  it('a prioridade respeita as classes: login antes de financeiro, antes de acesso, antes de aviso', () => {
    expect(OUTBOX_PRIORITY_BY_CLASS[1]).toBeLessThan(OUTBOX_PRIORITY_BY_CLASS[2]);
    expect(OUTBOX_PRIORITY_BY_CLASS[2]).toBeLessThan(OUTBOX_PRIORITY_BY_CLASS[3]);
    expect(OUTBOX_PRIORITY_BY_CLASS[3]).toBeLessThan(OUTBOX_PRIORITY_BY_CLASS[4]);
    expect(OUTBOX_PRIORITY_BY_CLASS[4]).toBeLessThan(OUTBOX_PRIORITY_BY_CLASS[5]);
    expect(EMAIL_TEMPLATES['purchase-confirmed'].priorityClass).toBe(2);
    expect(EMAIL_TEMPLATES['course-available'].priorityClass).toBe(4);
  });

  it('as variáveis esperadas no modelo incluem as do sistema (NAME e APP_URL)', () => {
    expect(expectedVariableNames('access-granted').sort()).toEqual(
      ['APP_URL', 'COURSE_TITLE', 'EXPIRES_AT', 'NAME'].sort(),
    );
    expect(expectedVariableNames('support-request').sort()).toEqual(
      ['APP_URL', 'CATEGORY', 'REQUEST_ID'].sort(),
    );
    expect(expectedVariableNames('magic-link')).toEqual(['LINK_URL']);
  });

  it('reconhece só templates próprios (não os herdados do Object)', () => {
    expect(isEmailTemplate('course-available')).toBe(true);
    expect(isEmailTemplate('toString')).toBe(false);
  });
});
