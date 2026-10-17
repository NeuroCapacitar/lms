import pg from 'pg';

export interface CapturedQuery {
  text: string;
  values: unknown[];
}

/**
 * Captura as idas ao banco (cada `query` do cliente `pg`, inclusive BEGIN e COMMIT) enquanto `run` executa. Cada ida custa uma viagem de
 * rede ao Neon pelo Hyperdrive, então a contagem por requisição é o que dá latência e uso de conexão. Guarda também os parâmetros, para
 * rodar `EXPLAIN` sobre o que de fato foi executado. Só para testes; um de cada vez (a captura troca o método do protótipo enquanto roda).
 */
export async function countQueries<T>(
  run: () => Promise<T>,
): Promise<{ result: T; statements: string[]; queries: CapturedQuery[] }> {
  const prototype = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = prototype.query;
  const queries: CapturedQuery[] = [];
  prototype.query = function (this: unknown, ...args: unknown[]) {
    const first = args[0];
    const config =
      typeof first === 'string'
        ? { text: first }
        : (first as { text?: string; values?: unknown[] });
    // O drizzle passa os parâmetros como SEGUNDO argumento (com um objeto de consulta no primeiro); o pg aceita também `values` no objeto.
    const values = ((typeof first === 'string'
      ? undefined
      : (config as { values?: unknown[] }).values) ?? args[1]) as unknown[] | undefined;
    queries.push({
      text: (config.text ?? '').replace(/\s+/g, ' ').trim(),
      values: Array.isArray(values) ? values : [],
    });
    return original.apply(this, args);
  };
  try {
    const result = await run();
    return { result, statements: queries.map((query) => query.text), queries };
  } finally {
    prototype.query = original;
  }
}
