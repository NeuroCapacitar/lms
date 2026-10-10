import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { acceptStaffInvitation, type AcceptInvitationResult } from '../api/auth';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/convite')({ component: AcceptInvitation });

type State =
  | { kind: 'reading' }
  | { kind: 'no-token' }
  | { kind: 'ready'; token: string }
  | { kind: 'submitting'; token: string }
  | { kind: 'accepted' }
  | { kind: 'failed'; token: string; reason: Exclude<AcceptInvitationResult, 'ok'> };

const FAILURES: Record<Exclude<AcceptInvitationResult, 'ok'>, string> = {
  unauthenticated:
    'Para aceitar, entre primeiro com o mesmo e-mail que recebeu o convite (por link de acesso) e depois abra o link do convite de novo.',
  invalid_or_expired:
    'Este convite expirou, foi revogado, já foi usado ou é de outro e-mail. Confira se você entrou com o e-mail convidado ou peça um novo convite.',
  suspended: 'Esta conta está suspensa e não pode aceitar o convite.',
  unverified:
    'O e-mail desta conta ainda não foi confirmado. Entre por link de acesso e tente de novo.',
  rate_limited: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  unavailable: 'Não foi possível aceitar agora. Tente novamente em instantes.',
};

/** Lê o token do fragmento (`#token=…`) e o remove da barra de endereço logo na abertura. */
function takeTokenFromHash(): string | null {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
  // replaceState: o token não fica no histórico nem na barra de endereço.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

/**
 * Aceite do convite de Staff. Abrir a página não faz nada: o convite só é consumido por um clique em
 * "Aceitar convite" (POST), na sessão de quem recebeu. A página NÃO abre sessão: quem decide é o
 * e-mail da sessão contra o do convite. Ao aceitar, as sessões da pessoa são encerradas por
 * segurança e ela entra de novo por link de acesso.
 */
function AcceptInvitation() {
  const [state, setState] = useState<State>({ kind: 'reading' });
  // A ref sobrevive ao efeito duplo do StrictMode: o fragmento é lido uma só vez.
  const captured = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    captured.current ??= takeTokenFromHash();
    const token = captured.current;
    setState(token ? { kind: 'ready', token } : { kind: 'no-token' });
  }, []);

  async function accept(token: string) {
    setState({ kind: 'submitting', token });
    const result = await acceptStaffInvitation(token);
    if (result === 'ok') {
      setState({ kind: 'accepted' });
      return;
    }
    setState({ kind: 'failed', token, reason: result });
  }

  return (
    <>
      <meta name="referrer" content="no-referrer" />
      <h1 className="mb-2 text-3xl font-semibold">Convite para a equipe</h1>
      {state.kind === 'reading' ? <p role="status">Carregando…</p> : null}
      {state.kind === 'no-token' ? (
        <p role="alert" className="mb-6 max-w-prose">
          Este link está incompleto. Abra o link do e-mail do convite ou peça um novo convite.
        </p>
      ) : null}
      {state.kind === 'ready' || state.kind === 'submitting' ? (
        <>
          <p className="mb-6 max-w-prose text-[var(--text-muted)]">
            Você precisa estar com a sessão aberta no mesmo e-mail que recebeu o convite. Ao
            aceitar, você passa a fazer parte da equipe e entra de novo por link de acesso.
          </p>
          <Button
            type="button"
            disabled={state.kind === 'submitting'}
            onClick={() => void accept(state.token)}
          >
            {state.kind === 'submitting' ? 'Aceitando…' : 'Aceitar convite'}
          </Button>
        </>
      ) : null}
      {state.kind === 'accepted' ? (
        <>
          <p role="status" className="mb-6 max-w-prose">
            Convite aceito. Por segurança sua sessão foi encerrada: entre de novo por link de acesso
            para usar a área da equipe.
          </p>
          <Link to="/entrar">Entrar</Link>
        </>
      ) : null}
      {state.kind === 'failed' ? (
        <>
          <p role="alert" className="mb-6 max-w-prose font-medium text-[var(--text-danger)]">
            {FAILURES[state.reason]}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/entrar">Entrar</Link>
            {state.reason === 'rate_limited' || state.reason === 'unavailable' ? (
              <Button type="button" onClick={() => void accept(state.token)}>
                Tentar de novo
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
