import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { confirmLink, type ConfirmLinkResult } from '../api/auth';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/entrar/confirmar')({ component: ConfirmSignIn });

type State =
  | { kind: 'reading' }
  | { kind: 'no-token' }
  | { kind: 'ready'; token: string }
  | { kind: 'submitting'; token: string }
  | { kind: 'failed'; reason: Exclude<ConfirmLinkResult, 'ok'> };

/** Lê o token do fragmento (`#token=…`) e o remove da barra de endereço logo na abertura. */
function takeTokenFromHash(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('token');
  // replaceState: o token não fica no histórico nem na barra de endereço.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

/**
 * Confirmação do link. Abrir a página não faz nada: o link só é consumido por um clique em
 * "Entrar" (POST), então scanners de e-mail que apenas abrem a URL não gastam o link.
 */
function ConfirmSignIn() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'reading' });
  // A ref sobrevive ao efeito duplo do StrictMode (desenvolvimento): o fragmento é lido uma só vez.
  const captured = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    captured.current ??= takeTokenFromHash();
    const token = captured.current;
    setState(token ? { kind: 'ready', token } : { kind: 'no-token' });
  }, []);

  async function confirm(token: string) {
    setState({ kind: 'submitting', token });
    const result = await confirmLink(token);
    if (result === 'ok') {
      await navigate({ to: '/' });
      return;
    }
    setState({ kind: 'failed', reason: result });
  }

  return (
    <>
      <meta name="referrer" content="no-referrer" />
      <h1 className="mb-2 text-3xl font-semibold">Confirmar acesso</h1>
      {state.kind === 'reading' ? <p role="status">Carregando…</p> : null}
      {state.kind === 'no-token' ? (
        <>
          <p role="alert" className="mb-6 max-w-prose">
            Este link está incompleto. Peça um novo link de acesso.
          </p>
          <Link to="/entrar">Pedir um novo link</Link>
        </>
      ) : null}
      {state.kind === 'ready' || state.kind === 'submitting' ? (
        <>
          <p className="mb-6 max-w-prose text-[var(--text-muted)]">
            Confirme para entrar no NeuroCapacitar neste dispositivo.
          </p>
          <Button
            type="button"
            disabled={state.kind === 'submitting'}
            onClick={() => void confirm(state.token)}
          >
            {state.kind === 'submitting' ? 'Entrando…' : 'Entrar'}
          </Button>
        </>
      ) : null}
      {state.kind === 'failed' ? (
        <>
          <p role="alert" className="mb-6 max-w-prose font-medium text-[var(--text-danger)]">
            {state.reason === 'invalid_or_expired'
              ? 'Este link expirou ou já foi usado. Peça um novo link de acesso.'
              : 'Não foi possível entrar agora. Tente novamente em instantes.'}
          </p>
          <Link to="/entrar">Pedir um novo link</Link>
        </>
      ) : null}
    </>
  );
}
