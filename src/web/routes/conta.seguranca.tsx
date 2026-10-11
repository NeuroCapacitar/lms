import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../features/identity/credentials';
import { requestReauth, type RequestReauthResult } from '../api/auth';
import { UnauthenticatedError } from '../api/profile';
import {
  fetchSecurity,
  linkGoogle,
  removePassword,
  setPassword,
  unlinkGoogle,
  type ChangeResult,
} from '../api/security';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/conta/seguranca')({
  component: AccountSecurity,
  validateSearch: (search: Record<string, unknown>): { erro?: 'google' } =>
    search.erro === 'google' ? { erro: 'google' } : {},
});

const FAILURES: Partial<Record<ChangeResult, string>> = {
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  invalid: `A senha precisa ter de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres.`,
  forbidden: 'Esta conta não pode usar esse método de entrada.',
  not_found: 'Esse método já não estava ligado à sua conta.',
  unavailable: 'Não foi possível concluir agora. Tente novamente em instantes.',
};

const REAUTH_MESSAGES: Record<RequestReauthResult, string> = {
  sent: 'Enviamos um link de confirmação para o seu e-mail. Abra-o neste navegador, volte aqui e repita a ação.',
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  rate_limited: 'Muitos pedidos. Aguarde alguns minutos e tente de novo.',
  unavailable: 'Não foi possível enviar agora. Tente novamente em instantes.',
};

/**
 * "Segurança da conta": o aluno pode ADICIONAR senha e Google ao link de acesso, que é a base e
 * nunca some. Mudar método exige reautenticação recente (um novo link). A equipe só entra por link.
 */
function AccountSecurity() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const security = useQuery({ queryKey: ['security'], queryFn: fetchSecurity, retry: false });
  const [password, setPasswordValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauth, setReauth] = useState<RequestReauthResult | undefined>();

  async function run(action: () => Promise<ChangeResult>, success: string) {
    setBusy(true);
    setMessage(undefined);
    const result = await action();
    setBusy(false);
    if (result === 'reauth_required') {
      setNeedsReauth(true);
      return;
    }
    setNeedsReauth(false);
    if (result === 'ok') {
      setMessage({ kind: 'ok', text: success });
      setPasswordValue('');
      await queryClient.invalidateQueries({ queryKey: ['security'] });
      return;
    }
    setMessage({ kind: 'error', text: FAILURES[result] ?? FAILURES.unavailable! });
  }

  async function connectGoogle() {
    setBusy(true);
    setMessage(undefined);
    const { result, url } = await linkGoogle();
    setBusy(false);
    if (result === 'ok' && url) {
      window.location.assign(url);
      return;
    }
    if (result === 'reauth_required') {
      setNeedsReauth(true);
      return;
    }
    setMessage({ kind: 'error', text: FAILURES[result] ?? FAILURES.unavailable! });
  }

  async function sendReauth() {
    setReauth(await requestReauth());
  }

  const title = <h1 className="mb-2 text-3xl font-semibold">Segurança da conta</h1>;

  if (security.isPending) {
    return (
      <>
        {title}
        <p role="status">Carregando…</p>
      </>
    );
  }
  if (security.error instanceof UnauthenticatedError) {
    return (
      <>
        {title}
        <p className="mb-4 max-w-prose">Entre para ver a segurança da sua conta.</p>
        <Link to="/entrar">Entrar</Link>
      </>
    );
  }
  if (security.isError) {
    return (
      <>
        {title}
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void security.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }

  const { methods, googleAvailable, canManageMethods } = security.data;
  const onPasswordSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => setPassword(password), methods.password ? 'Senha trocada.' : 'Senha definida.');
  };

  return (
    <>
      {title}
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        O link de acesso enviado ao seu e-mail sempre funciona. Você pode, se quiser, adicionar uma
        senha ou a sua conta Google como outras formas de entrar.
      </p>

      {search.erro === 'google' ? (
        <p role="alert" className="mb-6 max-w-prose font-medium text-[var(--text-danger)]">
          Não foi possível ligar o Google. Use o mesmo e-mail desta conta, com o e-mail verificado
          no Google.
        </p>
      ) : null}

      {!canManageMethods ? (
        <p role="status" className="mb-6 max-w-prose">
          A equipe entra somente por link de acesso. Senha e Google não ficam disponíveis para esta
          conta.
        </p>
      ) : null}

      <ul className="mb-8 grid max-w-md gap-2" aria-label="Métodos de entrada">
        <li>
          <strong>Link de acesso:</strong> sempre disponível
        </li>
        <li>
          <strong>Senha:</strong> {methods.password ? 'definida' : 'não definida'}
        </li>
        <li>
          <strong>Google:</strong>{' '}
          {methods.google ? 'ligado' : googleAvailable ? 'não ligado' : 'indisponível'}
        </li>
      </ul>

      {needsReauth ? (
        <div role="alert" className="mb-8 grid max-w-prose gap-3 rounded-lg border p-4">
          <p className="font-medium">
            Para alterar um método de entrada, confirme primeiro a sua identidade.
          </p>
          <div>
            <Button type="button" variant="secondary" onClick={() => void sendReauth()}>
              Enviar link de confirmação
            </Button>
          </div>
          {reauth ? (
            <p role="status" className="text-[var(--text-muted)]">
              {REAUTH_MESSAGES[reauth]}
            </p>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p
          role={message.kind === 'ok' ? 'status' : 'alert'}
          className={
            message.kind === 'ok'
              ? 'mb-6 font-medium text-[var(--text-success)]'
              : 'mb-6 font-medium text-[var(--text-danger)]'
          }
        >
          {message.text}
        </p>
      ) : null}

      {canManageMethods ? (
        <div className="grid max-w-md gap-10">
          <section aria-labelledby="senha-titulo" className="grid gap-4">
            <h2 id="senha-titulo" className="text-xl font-semibold">
              Senha
            </h2>
            <form onSubmit={onPasswordSubmit} noValidate className="grid gap-4">
              <TextField
                label={methods.password ? 'Nova senha' : 'Senha'}
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPasswordValue(event.target.value)}
                description={`De ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres.`}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy || password.length === 0}>
                  {methods.password ? 'Trocar senha' : 'Definir senha'}
                </Button>
                {methods.password ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void run(removePassword, 'Senha removida.')}
                  >
                    Remover senha
                  </Button>
                ) : null}
              </div>
            </form>
          </section>

          {googleAvailable ? (
            <section aria-labelledby="google-titulo" className="grid gap-4">
              <h2 id="google-titulo" className="text-xl font-semibold">
                Google
              </h2>
              {methods.google ? (
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void run(unlinkGoogle, 'Google removido.')}
                  >
                    Remover Google
                  </Button>
                </div>
              ) : (
                <div>
                  <Button type="button" disabled={busy} onClick={() => void connectGoogle()}>
                    Ligar conta Google
                  </Button>
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
