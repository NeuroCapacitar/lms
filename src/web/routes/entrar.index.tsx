import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  fetchAuthOptions,
  requestLink,
  startGoogleSignIn,
  type RequestLinkResult,
} from '../api/auth';
import { safeReturnTo } from '../../features/identity/return-to';
import { rememberReturnTo } from '../return-to';
import { PasswordSignIn } from '../components/password-sign-in';
import { Turnstile } from '../components/turnstile';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/entrar/')({
  component: SignIn,
  validateSearch: (search: Record<string, unknown>): { erro?: 'google'; returnTo?: string } => {
    // `returnTo` só passa se for um caminho interno válido (M3-02); o resto some.
    const returnTo = safeReturnTo(search.returnTo);
    return {
      ...(search.erro === 'google' ? { erro: 'google' as const } : {}),
      ...(returnTo ? { returnTo } : {}),
    };
  },
});

const MESSAGES: Record<Exclude<RequestLinkResult, 'sent'>, string> = {
  captcha_failed: 'Não foi possível confirmar a verificação de segurança. Tente de novo.',
  invalid_email: 'Informe um e-mail válido.',
  unavailable: 'Não foi possível enviar agora. Tente novamente em instantes.',
};

/** Pedido do link de acesso. A resposta é a mesma para qualquer e-mail válido (não revela cadastro). */
function SignIn() {
  const search = Route.useSearch();
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState(false);
  useEffect(() => {
    void fetchAuthOptions().then((options) => setGoogleEnabled(options.google));
  }, []);
  // Depois do login a pessoa volta à página de onde veio (o link do e-mail pode abrir em outra aba).
  useEffect(() => {
    if (search.returnTo) rememberReturnTo(search.returnTo);
  }, [search.returnTo]);

  async function signInWithGoogle() {
    setGoogleBusy(true);
    setGoogleError(false);
    const url = await startGoogleSignIn();
    if (url) {
      window.location.assign(url);
      return;
    }
    setGoogleBusy(false);
    setGoogleError(true);
  }

  const [email, setEmail] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const onToken = useCallback((token: string | null) => setCaptcha(token), []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!captcha) {
      setError('Conclua a verificação de segurança para continuar.');
      return;
    }
    setSending(true);
    setError(undefined);
    const result = await requestLink(email, captcha);
    setSending(false);
    if (result === 'sent') {
      setSent(true);
      return;
    }
    setError(MESSAGES[result]);
  }

  if (sent) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Verifique seu e-mail</h1>
        <p role="status" className="max-w-prose">
          Se o e-mail informado puder entrar, enviamos um link de acesso. Ele vale por 15 minutos e
          só funciona uma vez.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Entrar</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Informe seu e-mail e enviaremos um link de acesso. Não é preciso criar senha.
      </p>
      {search.erro === 'google' || googleError ? (
        <p role="alert" className="mb-6 max-w-prose font-medium text-[var(--text-danger)]">
          Não foi possível entrar com o Google. Use o link de acesso abaixo.
        </p>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-5">
        <TextField
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error === MESSAGES.invalid_email ? error : undefined}
        />
        <Turnstile onToken={onToken} />
        {error && error !== MESSAGES.invalid_email ? (
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={sending}>
            {sending ? 'Enviando…' : 'Enviar link de acesso'}
          </Button>
        </div>
      </form>

      <section aria-labelledby="outras-formas" className="mt-12 grid max-w-md gap-4">
        <h2 id="outras-formas" className="text-xl font-semibold">
          Outras formas de entrar
        </h2>
        <p className="text-[var(--text-muted)]">
          Valem para quem já adicionou senha ou Google em "Segurança da conta". A equipe entra
          somente por link de acesso.
        </p>
        {googleEnabled ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={googleBusy}
              onClick={() => void signInWithGoogle()}
            >
              {googleBusy ? 'Abrindo o Google…' : 'Entrar com Google'}
            </Button>
          </div>
        ) : null}
        {showPassword ? (
          <PasswordSignIn />
        ) : (
          <div>
            <Button type="button" variant="secondary" onClick={() => setShowPassword(true)}>
              Entrar com e-mail e senha
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
