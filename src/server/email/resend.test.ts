import { describe, expect, it } from 'vitest';

import type { EmailMessage } from '../../features/identity/link-policy';
import { verifyTurnstile } from '../auth/turnstile';
import { createEmailSender } from './factory';
import { createResendSender } from './resend';

const message: EmailMessage = {
  to: 'pessoa@example.test',
  template: 'magic-link',
  variables: { LINK_URL: 'https://app.example.test/entrar/confirmar#token=abc' },
  idempotencyKey: 'magic-link:abc',
};

function recordingFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('Resend', () => {
  it('envia o modelo hospedado com remetente, destinatário, variáveis e chave de idempotência', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const sender = createResendSender({
      apiKey: 're_chave_de_teste',
      from: 'NeuroCapacitar <acesso@example.test>',
      templates: { 'magic-link': 'tpl-123' },
      fetchImpl,
    });
    await sender.send(message);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_chave_de_teste');
    expect(headers['idempotency-key']).toBe('magic-link:abc');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: 'NeuroCapacitar <acesso@example.test>',
      to: ['pessoa@example.test'],
      subject: 'Seu link de acesso ao NeuroCapacitar',
      template: { id: 'tpl-123', variables: message.variables },
    });
  });

  it('a lista de permitidos descarta os demais destinatários sem chamar o provedor', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const sender = createResendSender({
      apiKey: 'k',
      from: 'a@example.test',
      templates: { 'magic-link': 'tpl' },
      allowlist: ['so-esta@example.test'],
      fetchImpl,
    });
    await sender.send(message);
    expect(calls).toHaveLength(0);
    await sender.send({ ...message, to: 'so-esta@example.test' });
    expect(calls).toHaveLength(1);
  });

  it('erro do provedor vira falha sem o endereço nem o link na mensagem', async () => {
    const sender = createResendSender({
      apiKey: 'k',
      from: 'a@example.test',
      templates: { 'magic-link': 'tpl' },
      fetchImpl: recordingFetch(422).fetchImpl,
    });
    const failure = sender.send(message);
    await expect(failure).rejects.toThrow('Resend respondeu HTTP 422');
    await expect(failure).rejects.not.toThrow(/pessoa@/);
  });

  it('modelo não configurado falha antes de qualquer chamada', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const sender = createResendSender({
      apiKey: 'k',
      from: 'a@example.test',
      templates: { 'magic-link': '' },
      fetchImpl,
    });
    await expect(sender.send(message)).rejects.toThrow(/não configurado/);
    expect(calls).toHaveLength(0);
  });
});

describe('escolha do envio por ambiente', () => {
  const base = { EMAIL_FROM: 'x', RESEND_TEMPLATE_MAGIC_LINK: '', EMAIL_ALLOWLIST: '' };

  it('em Staging e Production, sem chave, enviar é erro (nunca finge enviar)', async () => {
    const sender = createEmailSender({
      ...base,
      APP_BASE_URL: 'https://hub-staging.example.dev',
    } as unknown as Env);
    await expect(sender.send(message)).rejects.toThrow(/RESEND_API_KEY ausente/);
  });

  it('em Development, sem chave, o envio é falso e não falha', async () => {
    const sender = createEmailSender({
      ...base,
      APP_BASE_URL: 'http://localhost:5173',
    } as unknown as Env);
    await expect(sender.send(message)).resolves.toBeUndefined();
  });
});

describe('Turnstile', () => {
  const answer = (body: unknown, status = 200) =>
    (async () => Response.json(body, { status })) as unknown as typeof fetch;

  it('só aprova com success:true', async () => {
    const input = { secret: 's', token: 't' };
    expect(await verifyTurnstile({ ...input, fetchImpl: answer({ success: true }) })).toBe(true);
    expect(await verifyTurnstile({ ...input, fetchImpl: answer({ success: false }) })).toBe(false);
    expect(await verifyTurnstile({ ...input, fetchImpl: answer({}) })).toBe(false);
    expect(await verifyTurnstile({ ...input, fetchImpl: answer({ success: true }, 500) })).toBe(
      false,
    );
  });

  it('falha de rede recusa (fecha por padrão)', async () => {
    const down = (async () => {
      throw new Error('rede');
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile({ secret: 's', token: 't', fetchImpl: down })).toBe(false);
  });

  it('envia segredo, resposta e IP como formulário', async () => {
    let body = '';
    const spy = (async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return Response.json({ success: true });
    }) as unknown as typeof fetch;
    await verifyTurnstile({ secret: 'seg', token: 'tok', ip: '203.0.113.5', fetchImpl: spy });
    const form = new URLSearchParams(body);
    expect(form.get('secret')).toBe('seg');
    expect(form.get('response')).toBe('tok');
    expect(form.get('remoteip')).toBe('203.0.113.5');
  });
});
