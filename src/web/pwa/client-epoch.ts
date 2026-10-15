import { API_CLIENT_EPOCH, CLIENT_EPOCH_HEADER } from '../../features/pwa/pwa';
import { emitPwaEvent } from './events';

/**
 * Época do cliente (M8-01): todo `fetch` same-origin para `/api/` leva `x-client-epoch`. Se a API responder
 * `409 client_outdated`, o app avisa que está desatualizado (a tela pede recarga). Instalado uma vez em `main.tsx`.
 */
function isApiRequest(input: RequestInfo | URL): boolean {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export function installClientEpoch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (!isApiRequest(input)) return original(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set(CLIENT_EPOCH_HEADER, String(API_CLIENT_EPOCH));
    const response = await original(input, { ...init, headers });
    if (response.status === 409) {
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as {
        error?: { code?: string };
      } | null;
      if (body?.error?.code === 'client_outdated') emitPwaEvent('client-outdated');
    }
    return response;
  };
}
