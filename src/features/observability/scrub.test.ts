import { describe, expect, it } from 'vitest';

import { scrubEvent, scrubText, scrubUrl } from './scrub';

describe('scrubUrl', () => {
  it('descarta query string e fragmento, onde viajam e-mail e token', () => {
    expect(scrubUrl('https://app.example/entrar?email=pessoa@example.com&token=abc#frag')).toBe(
      'https://app.example/entrar',
    );
  });

  it('troca o token do link mágico e do convite no caminho', () => {
    expect(scrubUrl('https://app.example/magic/AbCdEf0123456789XyZ')).toBe(
      'https://app.example/[link]',
    );
    expect(scrubUrl('https://app.example/convite/AbCdEf0123456789XyZ')).toBe(
      'https://app.example/[link]',
    );
  });

  it('mantém caminhos comuns', () => {
    expect(scrubUrl('https://app.example/cursos/neuro-1')).toBe(
      'https://app.example/cursos/neuro-1',
    );
  });
});

describe('scrubText', () => {
  it('troca e-mails em qualquer posição do texto', () => {
    expect(scrubText('Falha para pessoa@example.com e outra.pessoa+x@sub.example.com.br')).toBe(
      'Falha para [email] e [email]',
    );
  });
});

describe('scrubEvent', () => {
  it('remove usuário, cookies, cabeçalhos, corpo e query, e limpa mensagens', () => {
    const event = scrubEvent({
      user: { id: 'u_1', email: 'pessoa@example.com', ip_address: '1.2.3.4' },
      message: 'erro com pessoa@example.com',
      request: {
        url: 'https://app.example/api/x?email=pessoa@example.com#a',
        cookies: { session: 'SEGREDO' },
        headers: { cookie: 'session=SEGREDO', authorization: 'Bearer SEGREDO' },
        data: { password: 'SEGREDO' },
        query_string: 'email=pessoa@example.com',
      },
      exception: { values: [{ value: 'Falha para pessoa@example.com' }, {}] },
    });
    expect(event).toEqual({
      message: 'erro com [email]',
      request: { url: 'https://app.example/api/x' },
      exception: { values: [{ value: 'Falha para [email]' }, {}] },
    });
    expect(JSON.stringify(event)).not.toMatch(/SEGREDO|pessoa@/);
  });

  it('aceita evento sem request nem exceção', () => {
    expect(scrubEvent({})).toEqual({});
  });
});
