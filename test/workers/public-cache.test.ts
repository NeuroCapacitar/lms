import { describe, expect, it, vi } from 'vitest';

import { injectMeta, resolveCoursePage } from '../../src/server/catalog/course-page';
import { PUBLIC_CACHE_TTL, servePublicCached } from '../../src/server/http/public-cache';

/**
 * M9-07 no workerd (Cache API de verdade): o cache de borda curto das rotas públicas. Guarda só o que veio de leitura bem-sucedida,
 * a chave é o caminho, a cópia sai sem cookie, e o cache nunca derruba a resposta.
 */
const url = (path: string) => `https://qualquer-host.example${path}`;
let seq = 0;
const unique = () => `/teste-cache-${Date.now()}-${(seq += 1)}`;

function producer(body = 'corpo', init: ResponseInit = {}) {
  const produce = vi.fn(async () => ({
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', ...init.headers },
    }),
    ttl: 60 as number | null,
  }));
  return produce;
}

describe('servePublicCached', () => {
  it('a primeira vez vai à origem (miss) e a segunda vem do cache (hit), com os cabeçalhos de cache originais', async () => {
    const path = unique();
    const produce = producer('olá', {
      headers: { 'set-cookie': 'sessao=segredo', 'x-request-id': 'req-1' },
    });
    const waits: Promise<unknown>[] = [];
    const first = await servePublicCached({
      request: new Request(url(path)),
      produce,
      waitUntil: (work) => void waits.push(work),
    });
    await Promise.all(waits);
    expect(first.headers.get('x-public-cache')).toBe('miss');
    expect(await first.text()).toBe('olá');

    const second = await servePublicCached({ request: new Request(url(path)), produce });
    expect(produce).toHaveBeenCalledTimes(1);
    expect(second.headers.get('x-public-cache')).toBe('hit');
    expect(await second.text()).toBe('olá');
    expect(second.headers.get('cache-control')).toBe('no-store'); // o que a rota mandava, não o prazo interno
    expect(second.headers.get('set-cookie')).toBeNull();
    expect(second.headers.get('x-request-id')).toBeNull();
    expect(second.headers.get('x-origin-cache-control')).toBeNull();
  });

  it('a chave é o CAMINHO: outro host e outra consulta caem na mesma entrada; outro caminho, não', async () => {
    const path = unique();
    const produce = producer();
    const waits: Promise<unknown>[] = [];
    const run = (request: Request) =>
      servePublicCached({ request, produce, waitUntil: (work) => void waits.push(work) });
    await run(new Request(`https://a.example${path}?x=1`));
    await Promise.all(waits);
    const same = await run(new Request(`https://b.example${path}?x=2&y=3`));
    expect(same.headers.get('x-public-cache')).toBe('hit');
    const other = await run(new Request(url(`${path}-outro`)));
    expect(other.headers.get('x-public-cache')).toBe('miss');
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('ttl nulo (falha, SPA pura) NUNCA é guardado', async () => {
    const path = unique();
    const produce = vi.fn(async () => ({ response: new Response('falhou'), ttl: null }));
    await servePublicCached({ request: new Request(url(path)), produce });
    const again = await servePublicCached({ request: new Request(url(path)), produce });
    expect(produce).toHaveBeenCalledTimes(2);
    expect(again.headers.get('x-public-cache')).toBeNull();
  });

  it('só GET e só caminho curto entram no cache', async () => {
    const produce = producer();
    const waits: Promise<unknown>[] = [];
    const wait = (work: Promise<unknown>) => void waits.push(work);
    const path = unique();
    await servePublicCached({
      request: new Request(url(path), { method: 'POST' }),
      produce,
      waitUntil: wait,
    });
    await servePublicCached({
      request: new Request(url(path), { method: 'POST' }),
      produce,
      waitUntil: wait,
    });
    const long = `${unique()}/${'a'.repeat(250)}`;
    await servePublicCached({ request: new Request(url(long)), produce, waitUntil: wait });
    await Promise.all(waits);
    await servePublicCached({ request: new Request(url(long)), produce, waitUntil: wait });
    expect(produce).toHaveBeenCalledTimes(4);
  });

  it('expira no prazo: depois de ttl a origem é consultada de novo', async () => {
    const path = unique();
    const produce = vi.fn(async () => ({ response: new Response('v'), ttl: 1 }));
    const waits: Promise<unknown>[] = [];
    const wait = (work: Promise<unknown>) => void waits.push(work);
    await servePublicCached({ request: new Request(url(path)), produce, waitUntil: wait });
    await Promise.all(waits);
    expect(
      (await servePublicCached({ request: new Request(url(path)), produce })).headers.get(
        'x-public-cache',
      ),
    ).toBe('hit');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const expired = await servePublicCached({ request: new Request(url(path)), produce });
    expect(expired.headers.get('x-public-cache')).toBe('miss');
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('o cache nunca derruba a resposta: sem Cache API, com falha no match ou no put', async () => {
    const path = unique();
    const produce = producer('ok');
    const none = await servePublicCached({ request: new Request(url(path)), produce, cache: null });
    expect(await none.text()).toBe('ok');
    expect(none.headers.get('x-public-cache')).toBeNull();

    const broken = {
      match: async () => {
        throw new Error('match caiu');
      },
      put: async () => {
        throw new Error('put caiu');
      },
    };
    const waits: Promise<unknown>[] = [];
    const response = await servePublicCached({
      request: new Request(url(path)),
      produce,
      cache: broken,
      waitUntil: (work) => void waits.push(work),
    });
    await expect(Promise.all(waits)).resolves.toBeDefined();
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('x-public-cache')).toBe('miss');
  });

  it('o prazo do curso encontrado é de 60 s e o do "não existe" é menor', () => {
    expect(PUBLIC_CACHE_TTL).toEqual({ found: 60, missing: 30 });
  });
});

describe('resolveCoursePage: o que pode ir para o cache', () => {
  const SHELL =
    '<!doctype html><html><head><title>NeuroCapacitar Hub</title></head><body></body></html>';
  const env = {
    APP_BASE_URL: 'https://hub.example.com',
    ASSETS: {
      fetch: async () => new Response(SHELL, { headers: { 'content-type': 'text/html' } }),
    },
  } as unknown as Env;
  const request = (path: string) => new Request(`https://hub.example.com${path}`);
  const onError = vi.fn();

  it('curso encontrado: 200 com as meta tags e prazo de 60 s', async () => {
    const result = await resolveCoursePage(request('/cursos/curso-x'), env, {
      loadCourse: async () => ({ slug: 'curso-x', title: 'Curso X', description: null }) as never,
      inject: injectMeta,
      onError,
    });
    expect(result.ttl).toBe(PUBLIC_CACHE_TTL.found);
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toContain('Curso X | NeuroCapacitar');
  });

  it('curso que não existe: 404 com meta genérica e prazo de 30 s', async () => {
    const result = await resolveCoursePage(request('/cursos/nao-existe'), env, {
      loadCourse: async () => null,
      inject: injectMeta,
      onError,
    });
    expect(result.ttl).toBe(PUBLIC_CACHE_TTL.missing);
    expect(result.response.status).toBe(404);
  });

  it('falha no banco: a página sai (200, meta genérica) mas NUNCA vai para o cache, e o erro é registrado', async () => {
    onError.mockClear();
    const result = await resolveCoursePage(request('/cursos/curso-x'), env, {
      loadCourse: async () => {
        throw new Error('banco caiu');
      },
      inject: injectMeta,
      onError,
    });
    expect(result.ttl).toBeNull();
    expect(result.response.status).toBe(200);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('caminho que não é /cursos/:slug: a SPA pura, sem consultar o banco e sem cache', async () => {
    const loadCourse = vi.fn();
    const result = await resolveCoursePage(request('/cursos'), env, {
      loadCourse,
      inject: injectMeta,
      onError,
    });
    expect(result.ttl).toBeNull();
    expect(loadCourse).not.toHaveBeenCalled();
  });
});
