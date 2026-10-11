import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState, type FormEvent } from 'react';

import { signInWithPassword, type PasswordSignInResult } from '../api/auth';
import { Turnstile } from './turnstile';
import { Button } from './ui/button';
import { TextField } from './ui/field';

const MESSAGES: Record<Exclude<PasswordSignInResult, 'ok'>, string> = {
  invalid_credentials:
    'E-mail ou senha incorretos, ou este método não está disponível para a sua conta. Você sempre pode usar o link de acesso.',
  captcha_failed: 'Não foi possível confirmar a verificação de segurança. Tente de novo.',
  rate_limited: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  unavailable: 'Não foi possível entrar agora. Tente novamente em instantes.',
};

/** Login por e-mail e senha (opcional: só quem já adicionou uma senha à conta). Tem o seu Turnstile. */
export function PasswordSignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
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
    const result = await signInWithPassword(email, password, captcha);
    setSending(false);
    if (result === 'ok') {
      await navigate({ to: '/' });
      return;
    }
    setError(MESSAGES[result]);
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid gap-5"
      aria-label="Entrar com e-mail e senha"
    >
      <TextField
        label="E-mail"
        name="password-email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        label="Senha"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Turnstile onToken={onToken} />
      {error ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={sending}>
          {sending ? 'Entrando…' : 'Entrar com senha'}
        </Button>
      </div>
    </form>
  );
}
