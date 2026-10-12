import {
  readStoredReturnTo,
  safeReturnTo,
  serializeReturnTo,
} from '../features/identity/return-to';

const KEY = 'hub:return-to';

/**
 * Guarda o destino de retorno (só um caminho interno validado) para depois do login. O link do
 * e-mail pode abrir em outra aba, então `localStorage` (por pouco tempo); sem armazenamento, o login
 * simplesmente segue para a página inicial.
 */
export function rememberReturnTo(value: unknown): void {
  const path = safeReturnTo(value);
  if (path === null) return;
  try {
    window.localStorage.setItem(KEY, serializeReturnTo(path, Date.now()));
  } catch {
    // armazenamento indisponível: sem retorno, nada quebra
  }
}

/** Lê e APAGA o destino guardado (uso único), revalidando-o. */
export function takeReturnTo(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    window.localStorage.removeItem(KEY);
    return readStoredReturnTo(raw, Date.now());
  } catch {
    return null;
  }
}
