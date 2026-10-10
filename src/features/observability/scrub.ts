import { ACCESS_LINK_PATTERN, EMAIL_PATTERN } from './patterns';

/** Subconjunto estrutural de um evento do Sentry: não importamos o SDK numa feature. */
export interface ScrubbableEvent {
  user?: unknown;
  message?: string;
  request?: {
    url?: string;
    cookies?: unknown;
    headers?: unknown;
    data?: unknown;
    query_string?: unknown;
  };
  exception?: { values?: Array<{ value?: string }> };
}

export function scrubText(text: string): string {
  return text.replace(ACCESS_LINK_PATTERN, '/[link]').replace(EMAIL_PATTERN, '[email]');
}

/** Mantém só origem e caminho: query string e fragmento carregam e-mail e token (ADR 0028). */
export function scrubUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? '';
  return scrubText(withoutQuery);
}

/**
 * Remove de um evento de erro tudo que identifica a pessoa. O SDK entrega URL completa,
 * cabeçalhos, cookies e a mensagem do erro; nenhum deles pode sair em claro.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const target: ScrubbableEvent = event;
  delete target.user;
  if (target.request) {
    delete target.request.cookies;
    delete target.request.headers;
    delete target.request.data;
    delete target.request.query_string;
    if (target.request.url) {
      target.request.url = scrubUrl(target.request.url);
    }
  }
  if (target.message) {
    target.message = scrubText(target.message);
  }
  for (const exception of target.exception?.values ?? []) {
    if (exception.value) {
      exception.value = scrubText(exception.value);
    }
  }
  return event;
}
