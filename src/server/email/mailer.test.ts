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

  it('429 distingue cota do dia, cota do mês e taxa pelo NOME do erro (M4-08)', async () => {
    const respond = (name?: string) =>
      mailerWith(() => new Response(name ? JSON.stringify({ name }) : '{}', { status: 429 }))
        .mailer;
    expect(await respond('daily_quota_exceeded').send(request)).toEqual({
      ok: false,
      kind: 'rate_limited',
      status: 429,
      quota: 'daily',
    });
    expect(await respond('monthly_quota_exceeded').send(request)).toMatchObject({
      quota: 'monthly',
    });
    const rate = await respond('rate_limit_exceeded').send(request);
    expect(rate).toEqual({ ok: false, kind: 'rate_limited', status: 429 });
    expect('quota' in rate).toBe(false);
    const unreadable = await mailerWith(() => new Response('<html>', { status: 429 })).mailer.send(
      request,
    );
    expect('quota' in unreadable).toBe(false);
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
