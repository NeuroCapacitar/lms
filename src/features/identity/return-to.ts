/**
 * "Login com retorno" (M3-02): depois de entrar, a pessoa volta para a página de onde veio. O destino
 * é só um CAMINHO RELATIVO INTERNO validado aqui; qualquer outra coisa (URL externa, esquema,
 * `//host`, barra invertida, caractere de controle, caminho da API ou da própria tela de entrada) é
 * recusada e o login segue para a página inicial. Puro: o navegador e o servidor usam a mesma regra.
 */
const MAX_LENGTH = 200;
const PLACEHOLDER_ORIGIN = 'https://interno.invalid';
/** Caminhos que nunca são destino de retorno: a API e o próprio fluxo de entrada (evita laço). */
const BLOCKED_PREFIXES = ['/api', '/entrar', '/convite'];

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // Barra invertida, espaço e controles: navegadores os tratam como separador ou os removem.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000- \u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  const path = url.pathname;
  for (const prefix of BLOCKED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return null;
  }
  return `${path}${url.search}`;
}

/** Quanto tempo o destino guardado vale: o tempo de abrir o e-mail e clicar no link. */
const STORED_TTL_MS = 30 * 60 * 1000;

/** O que o navegador guarda: só o caminho e quando. */
export function serializeReturnTo(path: string, now: number): string {
  return JSON.stringify({ path, at: now });
}

/**
 * Lê o destino guardado. O armazenamento é do navegador e pode ter sido alterado: o caminho é
 * REVALIDADO aqui, e valor vencido, malformado ou externo vira `null`.
 */
export function readStoredReturnTo(raw: string | null, now: number): string | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { path, at } = parsed as { path?: unknown; at?: unknown };
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (now - at > STORED_TTL_MS || now < at) return null;
  return safeReturnTo(path);
}
