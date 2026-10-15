import { useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { confirmLink, confirmReauth, type ConfirmReauthResult } from '../api/auth';
import { afterSignIn } from '../offline/runtime';
import { takeReturnTo } from '../return-to';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/entrar/confirmar')({ component: ConfirmSignIn });

type State =
  | { kind: 'reading' }
  | { kind: 'no-token' }
  | { kind: 'ready'; token: string }
  | { kind: 'submitting'; token: string }
  | { kind: 'reauthenticated' }
  | { kind: 'failed'; reason: Exclude<ConfirmReauthResult, 'ok'> };

interface Captured {
  token: string | null;
  /** `reauth`: o link confirma a identidade da sessão atual, não abre uma sessão nova. */
  purpose: 'login' | 'reauth';
}

/** Lê o token e a finalidade do fragmento (`#token=…&purpose=…`) e os remove da barra de endereço. */
function takeFromHash(): Captured {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('token');
  const purpose = params.get('purpose') === 'reauth' ? 'reauth' : 'login';
  // replaceState: o token não fica no histórico nem na barra de endereço.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return { token, purpose };
}

/**
 * Confirmação do link. Abrir a página não faz nada: o link só é consumido por um clique em
 * "Entrar" (POST), então scanners de e-mail que apenas abrem a URL não gastam o link.
 */
function ConfirmSignIn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ kind: 'reading' });
  // A ref sobrevive ao efeito duplo do StrictMode (desenvolvimento): o fragmento é lido uma só vez.
  const [purpose, setPurpose] = useState<Captured['purpose']>('login');
  const captured = useRef<Captured | undefined>(undefined);

  useEffect(() => {
    captured.current ??= takeFromHash();
    const { token, purpose: found } = captured.current;
    setPurpose(found);
    setState(token ? { kind: 'ready', token } : { kind: 'no-token' });
  }, []);

  async function confirm(token: string) {
    setState({ kind: 'submitting', token });
    if (purpose === 'reauth') {
      const proof = await confirmReauth(token);
      if (proof === 'ok') {
        setState({ kind: 'reauthenticated' });
        return;
      }
      setState({ kind: 'failed', reason: proof });
      return;
    }
    const result = await confirmLink(token);
    if (result === 'ok') {
      // Outra pessoa pode ter usado este aparelho: nada da sessão anterior (como o aceite dos termos,
      // que fica em cache) pode valer para a nova.
      queryClient.clear();
      // Volta à página de onde a pessoa veio (caminho interno validado) ou à página inicial.
      const back = takeReturnTo();
      // M8-05: se entrou OUTRA pessoa, o que era da anterior sai do aparelho antes de qualquer tela ler dado local.
      await afterSignIn();
      if (back) {
        window.location.assign(back);
        return;
      }
      await navigate({ to: '/' });
      return;
    }
    setState({ kind: 'failed', reason: result });
  }

  return (
    <>
      <meta name="referrer" content="no-referrer" />
      <h1 className="mb-2 text-3xl font-semibold">
        {purpose === 'reauth' ? 'Confirmar identidade' : 'Confirmar acesso'}
      </h1>
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
            {purpose === 'reauth'
              ? 'Confirme que é você para liberar a ação sensível neste dispositivo.'
              : 'Confirme para entrar no NeuroCapacitar neste dispositivo.'}
          </p>
          <Button
            type="button"
            disabled={state.kind === 'submitting'}
            onClick={() => void confirm(state.token)}
          >
            {state.kind === 'submitting'
              ? purpose === 'reauth'
                ? 'Confirmando…'
                : 'Entrando…'
              : purpose === 'reauth'
                ? 'Confirmar'
                : 'Entrar'}
          </Button>
        </>
      ) : null}
      {state.kind === 'reauthenticated' ? (
        <>
          <p role="status" className="mb-6 max-w-prose">
            Identidade confirmada. Você já pode voltar e concluir a ação.
          </p>
          <Link to="/conta">Voltar para a conta</Link>
        </>
      ) : null}
      {state.kind === 'failed' ? (
        <>
          <p role="alert" className="mb-6 max-w-prose font-medium text-[var(--text-danger)]">
            {state.reason === 'invalid_or_expired'
              ? 'Este link expirou ou já foi usado. Peça um novo link de acesso.'
              : state.reason === 'unauthenticated'
                ? 'Este link só vale na mesma sessão em que foi pedido. Entre de novo e peça outro.'
                : 'Não foi possível entrar agora. Tente novamente em instantes.'}
          </p>
          <Link to="/entrar">Pedir um novo link</Link>
        </>
      ) : null}
    </>
  );
}
