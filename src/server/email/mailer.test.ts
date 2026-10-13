import { describe, expect, it } from 'vitest';

import { createFakeMailer, createResendMailer, type MailRequest } from './mailer';

const request: MailRequest = {
  to: 'ana@example.com',
  templateAlias: 'access-granted',
  variables: { COURSE_TITLE: 'Curso', APP_URL: 'https://hub.example' },
  idempotencyKey: 'email:access-granted:abc',
  from: 'NeuroCapacitar <acesso@example.com>',
};

function mailerWith(respond: (init: RequestInit) => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const mailer = createResendMailer({
    apiKey: 're_chave_de_teste',
    fetchImpl: (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return respond(init);
    }) as unknown as typeof fetch,
  });
  return { mailer, seen };
}

describe('ResendMailer', () => {
  it('envia o modelo hospedado e as variáveis com a chave de idempotência, sem assunto nem rastreio', async () => {
    const { mailer, seen } = mailerWith(
      () => new Response(JSON.stringify({ id: 'resend-123' }), { status: 200 }),
    );
    expect(await mailer.send(request)).toEqual({ ok: true, providerMessageId: 'resend-123' });
    const sent = seen[0]!;
    expect(sent.url).toBe('https://api.resend.com/emails');
    const headers = sent.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('email:access-granted:abc');
    expect(headers.authorization).toBe('Bearer re_chave_de_teste');
    const body = JSON.parse(sent.init.body as string);
    expect(body).toEqual({
      from: request.from,
      to: ['ana@example.com'],
      template: { id: 'access-granted', variables: request.variables },
    });
    expect(JSON.stringify(body)).not.toMatch(/track|open|click|subject|html/i);
  });

  it('aceito sem corpo legível continua aceito (só não há id)', async () => {
    const { mailer } = mailerWith(() => new Response('', { status: 200 }));
    expect(await mailer.send(request)).toEqual({ ok: true, providerMessageId: null });
  });

  it('classifica a falha: 429, 409, 5xx, timeout e recusa', async () => {
    const cases: [number, string][] = [
      [429, 'rate_limited'],
      [409, 'conflict'],
      [500, 'unavailable'],
      [503, 'unavailable'],
      [422, 'rejected'],
      [400, 'rejected'],
    ];
    for (const [status, kind] of cases) {
      const { mailer } = mailerWith(
        () => new Response('{"message":"ana@example.com"}', { status }),
      );
      expect(await mailer.send(request), String(status)).toEqual({ ok: false, kind, status });
    }
    const failing = createResendMailer({
      apiKey: 'k',
      fetchImpl: (async () => {
        throw new DOMException('timeout', 'TimeoutError');
      }) as unknown as typeof fetch,
    });
    expect(await failing.send(request)).toEqual({ ok: false, kind: 'timeout' });
  });

  it('o resultado de falha nunca carrega destinatário nem corpo da resposta', async () => {
    const { mailer } = mailerWith(
      () => new Response('{"message":"ana@example.com"}', { status: 422 }),
    );
    expect(JSON.stringify(await mailer.send(request))).not.toContain('ana@example.com');
  });
});

describe('FakeMailer', () => {
  it('guarda em memória e avisa o observador', async () => {
    const seen: string[] = [];
    const fake = createFakeMailer((sent) => seen.push(sent.templateAlias));
    expect(await fake.send(request)).toEqual({ ok: true, providerMessageId: 'fake-1' });
    expect(fake.sent).toEqual([request]);
    expect(seen).toEqual(['access-granted']);
  });
});
