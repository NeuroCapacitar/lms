type SessionOptions = { headers?: unknown; returnHeaders?: boolean } & Record<string, unknown>;
type GetSession = (options: SessionOptions) => Promise<unknown>;

/**
 * Lê a sessão UMA vez por requisição (M9-07). O portão dos Termos e a própria rota pediam `getSession` cada um, e cada pedido são duas
 * idas ao banco (`session` e `user`): 2 das 9 idas de `/me/access` e 2 das 22 do heartbeat de vídeo.
 *
 * O `Auth` é criado POR REQUISIÇÃO, então a memória daqui vale só para uma requisição. Regras, para não mudar o que a autenticação decide:
 *  - só lembra o pedido simples (`headers`, com ou sem `returnHeaders`); qualquer outra opção (`query`, `asResponse`…) vai direto ao Better Auth;
 *  - a chave é o cookie: outro cookie, outra leitura;
 *  - QUALQUER outra chamada da API de autenticação (sair, revogar, trocar, confirmar link) pode mudar a sessão: esquece o que lembrava;
 *  - uma leitura que falhou não fica lembrada.
 * Revogar uma sessão continua valendo na requisição SEGUINTE (nova requisição, novo `Auth`, leitura nova).
 */
export function withSessionOnce<T extends { api: object }>(auth: T): T {
  let remembered: {
    cookie: string;
    full: Promise<{ headers: Headers; response: unknown }>;
  } | null = null;

  const api = new Proxy(auth.api, {
    get(target, name, receiver) {
      const value: unknown = Reflect.get(target, name, receiver);
      if (typeof value !== 'function') return value;
      const original = value as (...args: unknown[]) => unknown;

      if (name !== 'getSession') {
        return (...args: unknown[]) => {
          remembered = null;
          return original.apply(target, args);
        };
      }

      return (options: SessionOptions) => {
        const keys = options ? Object.keys(options) : [];
        const simple =
          options?.headers instanceof Headers &&
          keys.every((k) => k === 'headers' || k === 'returnHeaders');
        if (!simple) return (original as GetSession).call(target, options);

        const cookie = (options.headers as Headers).get('cookie') ?? '';
        if (remembered === null || remembered.cookie !== cookie) {
          // Sempre lê COM `returnHeaders`: serve os dois jeitos de pedir (o portão dos Termos precisa do cookie renovado).
          const full = (original as GetSession)
            .call(target, { headers: options.headers, returnHeaders: true })
            .then((result) => result as { headers: Headers; response: unknown });
          const entry = { cookie, full };
          remembered = entry;
          full.catch(() => {
            if (remembered === entry) remembered = null;
          });
        }
        return remembered.full.then((result) => (options.returnHeaders ? result : result.response));
      };
    },
  });

  return new Proxy(auth, {
    get(target, name, receiver) {
      return name === 'api' ? api : Reflect.get(target, name, receiver);
    },
  });
}
