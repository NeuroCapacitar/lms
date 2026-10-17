/**
 * Cache de borda CURTO das rotas públicas sem sessão (M9-07, ADR 0032). Cada visita anônima (visitante, robô de busca, prévia de rede
 * social) a essas rotas consultava o banco e acordava o Neon Free; com isto, no máximo uma consulta por prazo e por ponto de presença.
 *
 * Só vale para resposta PÚBLICA e IGUAL para todo mundo (curso publicado, imagens do login). Nunca para o que muda por pessoa. Regras:
 *  - só GET, só caminho curto, e a chave é o CAMINHO (sem host, sem consulta, sem cookie): uma entrada por página;
 *  - só se guarda o que veio de uma leitura bem-sucedida do banco (achou ou "não existe"); falha de banco nunca é guardada;
 *  - a cópia guardada sai sem `set-cookie` e sem `x-request-id`; quem pede recebe os cabeçalhos de cache que a rota já mandava;
 *  - qualquer falha do cache (inclusive não haver `caches`) cai no caminho de sempre: o cache nunca derruba a resposta;
 *  - não há como limpar um ponto de presença de dentro do Worker: uma publicação demora até o prazo para aparecer (60 s).
 * Observação: o Cache API NÃO funciona em `*.workers.dev` (Staging); só no domínio próprio (Production). `x-public-cache` diz o que houve.
 */
const KEY_ORIGIN = 'https://public-cache.invalid';
const MAX_PATH_LENGTH = 200;
const ORIGIN_CACHE_CONTROL = 'x-origin-cache-control';

/** Prazos, em segundos: curso encontrado e "não existe" (mais curto, para a publicação aparecer logo). */
export const PUBLIC_CACHE_TTL = { found: 60, missing: 30 } as const;

interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface Produced {
  response: Response;
  /** Segundos que a resposta pode ficar guardada; `null` = não guardar (falha, ou resposta que não é para guardar). */
  ttl: number | null;
}

function defaultCache(): CacheLike | null {
  return (globalThis as { caches?: { default?: CacheLike } }).caches?.default ?? null;
}

function withState(response: Response, state: 'hit' | 'miss', headers?: Headers): Response {
  const merged = new Headers(headers ?? response.headers);
  merged.set('x-public-cache', state);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

export async function servePublicCached(input: {
  request: Request;
  produce: () => Promise<Produced>;
  waitUntil?: (work: Promise<unknown>) => void;
  /** Só para teste: `null` simula ambiente sem Cache API. */
  cache?: CacheLike | null;
}): Promise<Response> {
  const cache = input.cache === undefined ? defaultCache() : input.cache;
  const path = new URL(input.request.url).pathname;
  if (cache === null || input.request.method !== 'GET' || path.length > MAX_PATH_LENGTH) {
    return (await input.produce()).response;
  }

  const key = new Request(new URL(path, KEY_ORIGIN));
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const headers = new Headers(hit.headers);
    const original = headers.get(ORIGIN_CACHE_CONTROL);
    headers.delete(ORIGIN_CACHE_CONTROL);
    if (original) headers.set('cache-control', original);
    else headers.delete('cache-control');
    return withState(hit, 'hit', headers);
  }

  const { response, ttl } = await input.produce();
  if (ttl === null) return response;

  const stored = new Headers(response.headers);
  stored.delete('set-cookie');
  stored.delete('x-request-id');
  stored.delete('x-public-cache');
  const original = stored.get('cache-control');
  if (original) stored.set(ORIGIN_CACHE_CONTROL, original);
  stored.set('cache-control', `public, max-age=${ttl}`);
  const copy = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers: stored,
  });
  const work = cache.put(key, copy).catch(() => undefined);
  if (input.waitUntil) input.waitUntil(work);
  else void work;
  return withState(response, 'miss');
}

/** O `waitUntil` do Worker, quando existe (nos testes de Node não há contexto de execução). */
export function waitUntilOf(c: { executionCtx: { waitUntil(work: Promise<unknown>): void } }) {
  return (work: Promise<unknown>) => {
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      void work;
    }
  };
}
