import { useEffect, useRef } from 'react';

interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Chave de TESTE da Cloudflare (sempre aprova); só vale em desenvolvimento. */
const DEV_TEST_SITE_KEY = '1x00000000000000000000AA';

let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile ausente'));
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error('turnstile não carregou'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

interface TurnstileProps {
  /** Recebe o token quando a verificação passa e `null` quando expira ou falha. */
  onToken: (token: string | null) => void;
  /** O token vale para UMA verificação: depois de qualquer tentativa que falhou, quem usa o widget muda este número e ele pede um novo. */
  renewSignal?: number;
}

/** Widget de verificação (Cloudflare Turnstile) do pedido de link. */
export function Turnstile({ onToken, renewSignal = 0 }: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null);
  const siteKey =
    import.meta.env.VITE_TURNSTILE_SITE_KEY ?? (import.meta.env.DEV ? DEV_TEST_SITE_KEY : '');

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId = api.render(container.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken, renewSignal]);

  if (!siteKey) {
    return <p role="alert">A verificação de segurança não está configurada neste ambiente.</p>;
  }
  return <div ref={container} role="group" aria-label="Verificação de segurança" />;
}
