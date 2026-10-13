import { describe, expect, it } from 'vitest';

import { hashRecipient, normalizeAddress } from './recipient-hash';
import { minimizeResendEvent, resendEventPayloadSchema } from './resend-events';

const KEY = 'chave-de-hmac-so-de-teste-0123456789abcdef';
const ADDRESS = 'Ana.Souza@Example.com';

const event = (type: string, data: Record<string, unknown> = {}) =>
  JSON.stringify({
    type,
    created_at: '2026-10-13T12:00:00.000Z',
    data: {
      email_id: 'email-123',
      from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
      to: [ADDRESS],
      subject: 'Seu acesso ao curso',
      template_id: 'tpl',
      tags: { categoria: 'x' },
      ...data,
    },
  });

describe('hash do destinatário', () => {
  it('normaliza (maiúsculas e espaços) e devolve 64 hex; chaves diferentes dão hashes diferentes', async () => {
    const a = await hashRecipient(KEY, ADDRESS);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashRecipient(KEY, '  ana.souza@example.com ')).toBe(a);
    expect(await hashRecipient(`${KEY}x`, ADDRESS)).not.toBe(a);
    expect(await hashRecipient(KEY, 'outra@example.com')).not.toBe(a);
    expect(normalizeAddress(' A@B.Co ')).toBe('a@b.co');
  });
});

describe('minimização do evento do Resend', () => {
  it('guarda só tipo, id do e-mail e instante: nada de destinatário, remetente nem assunto', async () => {
    const payload = await minimizeResendEvent(event('email.delivered'), KEY);
    expect(payload).toEqual({
      type: 'email.delivered',
      emailId: 'email-123',
      occurredAt: '2026-10-13T12:00:00.000Z',
    });
    const text = JSON.stringify(payload);
    for (const leaked of [
      'ana',
      'example.com',
      'Seu acesso',
      'NeuroCapacitar',
      'tpl',
      'categoria',
    ]) {
      expect(text.toLowerCase()).not.toContain(leaked.toLowerCase());
    }
  });

  it('bounce e reclamação levam o HASH do destinatário (nunca o endereço) e o tipo do bounce', async () => {
    const bounced = await minimizeResendEvent(
      event('email.bounced', { bounce: { type: 'Permanent', subType: 'General', message: 'x' } }),
      KEY,
    );
    expect(bounced).toMatchObject({ bounceType: 'permanent' });
    expect(bounced?.recipientHash).toBe(await hashRecipient(KEY, ADDRESS));
    expect(JSON.stringify(bounced).toLowerCase()).not.toContain('ana.souza');

    const complained = await minimizeResendEvent(event('email.complained'), KEY);
    expect(complained?.recipientHash).toBe(await hashRecipient(KEY, ADDRESS));

    const soft = await minimizeResendEvent(
      event('email.bounced', { bounce: { type: 'Transient' } }),
      KEY,
    );
    expect(soft?.bounceType).toBe('transient');
  });

  it('outros tipos NÃO levam hash, mesmo com destinatário no corpo', async () => {
    for (const type of [
      'email.delivered',
      'email.delivery_delayed',
      'email.failed',
      'email.suppressed',
    ]) {
      expect((await minimizeResendEvent(event(type), KEY))?.recipientHash, type).toBeUndefined();
    }
  });

  it('corpo que não é evento utilizável (JSON inválido, sem email_id, sem tipo) vira undefined', async () => {
    expect(await minimizeResendEvent('não é json', KEY)).toBeUndefined();
    expect(await minimizeResendEvent('{}', KEY)).toBeUndefined();
    expect(
      await minimizeResendEvent(JSON.stringify({ type: 'email.sent', data: {} }), KEY),
    ).toBeUndefined();
    expect(
      await minimizeResendEvent(JSON.stringify({ data: { email_id: 'x' } }), KEY),
    ).toBeUndefined();
  });

  it('o schema da inbox é estrito: campo a mais (ex.: e-mail) é recusado', () => {
    expect(
      resendEventPayloadSchema.safeParse({ type: 'email.delivered', emailId: 'x', to: 'a@b.co' })
        .success,
    ).toBe(false);
  });
});
