import {
  DESCRIPTION_MAX,
  courseMeta,
  genericMeta,
  renderMetaTags,
  slugFromPath,
  type PageMeta,
} from '../../features/catalog/course-meta';
import type { PublicCoursePageDto } from '../../features/catalog/public-course';
import { summarize } from '../../features/catalog/student-catalog';

/**
 * Troca as meta tags do `index.html` com HTMLRewriter (M2-06): sem SSR, só `<head>`. O `<title>` vira
 * texto (o HTMLRewriter escapa), a descrição e a canônica que já existirem saem e as tags novas entram
 * ESCAPADAS no fim do `<head>`. Sem `etag` nem `content-length` do arquivo original (o corpo mudou).
 */
export function injectMeta(shell: Response, meta: PageMeta, status: number): Response {
  const rewritten = new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"], link[rel="canonical"]', {
      element(element) {
        element.remove();
      },
    })
    .on('head', {
      element(element) {
        element.append(renderMetaTags(meta), { html: true });
      },
    })
    .transform(shell);
  const headers = new Headers(rewritten.headers);
  headers.delete('content-length');
  headers.delete('etag');
  // O conteúdo depende do banco: sempre revalida.
  headers.set('cache-control', 'no-cache');
  if (status === 404) headers.set('x-robots-tag', 'noindex');
  return new Response(rewritten.body, { status, headers });
}

export interface CoursePageDeps {
  loadCourse: (env: Env, slug: string) => Promise<PublicCoursePageDto | null>;
  inject: typeof injectMeta;
  onError: (error: unknown) => void;
}

/** O `index.html` da SPA, pedido ao binding de assets na raiz (sem o redirecionamento de `/index.html`). */
async function loadShell(env: Env, requestUrl: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL('/', requestUrl)));
}

/**
 * `/cursos/*` (M2-06). Caminho que não é `/cursos/:slug` válido: a SPA como está. Curso publicado: a
 * SPA com as meta tags dele. Slug inexistente, rascunho, arquivado e sem currículo publicado: a SPA
 * com 404 e meta tags GENÉRICAS, a mesma resposta nos quatro casos. Falha no banco não derruba a
 * página: a SPA sai com meta genérica e status 200 (a tela mostra o erro de carregamento).
 */
export async function serveCoursePage(
  request: Request,
  env: Env,
  deps: CoursePageDeps,
): Promise<Response> {
  const shell = await loadShell(env, request.url);
  const slug = slugFromPath(new URL(request.url).pathname);
  if (slug === null) return shell;
  try {
    const page = await deps.loadCourse(env, slug);
    if (page) {
      const meta = courseMeta({
        baseUrl: env.APP_BASE_URL,
        slug: page.slug,
        title: page.title,
        summary: summarize(page.description, DESCRIPTION_MAX),
      });
      return deps.inject(shell, meta, 200);
    }
    return deps.inject(shell, genericMeta(env.APP_BASE_URL), 404);
  } catch (error) {
    deps.onError(error);
    return deps.inject(await loadShell(env, request.url), genericMeta(env.APP_BASE_URL), 200);
  }
}
