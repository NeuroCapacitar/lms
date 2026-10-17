import { describe, expect, it, vi } from 'vitest';

import { withSessionOnce } from '../../src/server/auth/session-once.ts';

/**
 * M9-07: a sessão é lida uma vez por requisição. Aqui, com um Better Auth de mentira, as regras que mantêm o resultado igual ao de
 * antes: só o pedido simples é lembrado, a chave é o cookie, qualquer outra chamada da API esquece, e falha não fica lembrada.
 */
const SESSION = { user: { id: 'u1' }, session: { id: 's1' } };

function fake() {
  const getSession = vi.fn(async (options: { returnHeaders?: boolean }) =>
    options.returnHeaders
      ? { headers: new Headers({ 'x-renovado': '1' }), response: SESSION }
      : SESSION,
  );
  const signOut = vi.fn(async () => ({ success: true }));
  const auth = {
    api: { getSession, signOut, version: '1' },
    options: { marca: 'x' },
  };
  return { auth: withSessionOnce(auth), getSession, signOut };
}
const withCookie = (value: string, extra: Record<string, unknown> = {}) => ({
  headers: new Headers({ cookie: value }),
  ...extra,
});
const read = (auth: ReturnType<typeof fake>['auth'], options: unknown) =>
  (auth.api.getSession as unknown as (o: unknown) => Promise<unknown>)(options);

describe('sessão lida uma vez por requisição', () => {
  it('o portão (com returnHeaders) e a rota (simples) com o mesmo cookie leem UMA vez e recebem o formato de cada um', async () => {
    const { auth, getSession } = fake();
    const gate = (await read(auth, withCookie('s=1', { returnHeaders: true }))) as {
      headers: Headers;
      response: unknown;
    };
    const route = await read(auth, withCookie('s=1'));
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(gate.response).toBe(SESSION);
    expect(gate.headers.get('x-renovado')).toBe('1');
    expect(route).toBe(SESSION);
  });

  it('a ordem inversa (rota e depois portão) também lê uma vez', async () => {
    const { auth, getSession } = fake();
    await read(auth, withCookie('s=1'));
    const gate = (await read(auth, withCookie('s=1', { returnHeaders: true }))) as {
      response: unknown;
    };
    expect(gate.response).toBe(SESSION);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('outro cookie é outra leitura', async () => {
    const { auth, getSession } = fake();
    await read(auth, withCookie('s=1'));
    await read(auth, withCookie('s=2'));
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('qualquer outra chamada da API (ex.: sair) faz a próxima leitura ir ao Better Auth de novo', async () => {
    const { auth, getSession, signOut } = fake();
    await read(auth, withCookie('s=1'));
    await auth.api.signOut();
    expect(signOut).toHaveBeenCalledTimes(1);
    await read(auth, withCookie('s=1'));
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('opções além de headers e returnHeaders (ex.: query) NÃO são lembradas: vão direto, toda vez', async () => {
    const { auth, getSession } = fake();
    await read(auth, withCookie('s=1', { query: { disableCookieCache: true } }));
    await read(auth, withCookie('s=1', { query: { disableCookieCache: true } }));
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(getSession.mock.calls[0]![0]).toMatchObject({ query: { disableCookieCache: true } });
  });

  it('leitura que falhou não fica lembrada: a seguinte tenta de novo', async () => {
    const { auth, getSession } = fake();
    getSession.mockRejectedValueOnce(new Error('banco caiu'));
    await expect(read(auth, withCookie('s=1'))).rejects.toThrow('banco caiu');
    await expect(read(auth, withCookie('s=1'))).resolves.toBe(SESSION);
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('sem cookie lê (e lembra) como qualquer outro; o resto do objeto passa sem mudança', async () => {
    const { auth } = fake();
    expect(await read(auth, { headers: new Headers() })).toBe(SESSION);
    expect((auth.api as unknown as { version: string }).version).toBe('1');
    expect((auth as unknown as { options: { marca: string } }).options.marca).toBe('x');
  });
});
