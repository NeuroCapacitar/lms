/**
 * Regras puras do PWA (M8-01), compartilhadas pelo Service Worker, pelo app e pela API. Sem DOM nem Worker.
 */

/**
 * Época do contrato entre o app (cliente) e a API. Sobe quando uma mudança QUEBRA clientes antigos (campo removido,
 * rota trocada). O cliente envia a sua em todo `/api/*`; se não bater, a API responde `409 client_outdated` e a tela
 * pede recarga. Mudança compatível NÃO sobe a época (o cliente antigo continua funcionando até o update seguro).
 */
export const API_CLIENT_EPOCH = 1;
export const CLIENT_EPOCH_HEADER = 'x-client-epoch';

/** `null`/ausente = cliente sem época (curl, webhooks, testes): a API não recusa. Diferente da atual = desatualizado. */
export function isClientOutdated(header: string | null | undefined): boolean {
  if (header === null || header === undefined || header === '') return false;
  return header !== String(API_CLIENT_EPOCH);
}

/**
 * Navegações que o Service Worker NUNCA atende do cache: vão sempre à rede. A Staff é online-only; a API, o checkout
 * e a validação pública de certificado dependem do servidor a cada visita; `/cdn-cgi/` é da Cloudflare.
 */
const NAVIGATION_DENYLIST = [
  /^\/api(\/|$)/,
  /^\/staff(\/|$)/,
  /^\/certificados(\/|$)/,
  /^\/compra(r)?(\/|$)/,
  /^\/cdn-cgi(\/|$)/,
];

export function isNavigationDenied(pathname: string): boolean {
  return NAVIGATION_DENYLIST.some((pattern) => pattern.test(pathname));
}

/** As regras do denylist como `RegExp[]` para o Workbox (`NavigationRoute({ denylist })`). */
export const NAVIGATION_DENYLIST_PATTERNS: readonly RegExp[] = NAVIGATION_DENYLIST;

/** Página estática servida quando uma área só-online é aberta sem rede. */
export const OFFLINE_PAGE = '/offline.html';

/**
 * Kill switch (M8-01): com `PWA_KILL=1` no BUILD, o `sw.js` publicado é um Service Worker de desativação (limpa os
 * caches e se desregistra). O app continua tentando registrar `/sw.js`, então todo navegador que já tinha o SW antigo
 * recebe o de desativação na próxima verificação.
 */
export function pwaKillSwitch(env: Record<string, string | undefined>): boolean {
  return env.PWA_KILL === '1';
}
