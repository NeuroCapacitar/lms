import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useState, type FormEvent } from 'react';

import { requestLink, type RequestLinkResult } from '../api/auth';
import { Turnstile } from '../components/turnstile';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/entrar/')({ component: SignIn });

const MESSAGES: Record<Exclude<RequestLinkResult, 'sent'>, string> = {
  captcha_failed: 'Não foi possível confirmar a verificação de segurança. Tente de novo.',
  invalid_email: 'Informe um e-mail válido.',
  unavailable: 'Não foi possível enviar agora. Tente novamente em instantes.',
};

/** Pedido do link de acesso. A resposta é a mesma para qualquer e-mail válido (não revela cadastro). */
function SignIn() {
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
    </>
  );
}
