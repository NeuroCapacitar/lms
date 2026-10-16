import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { parsePastedLink, type PastedLinkResult } from '../../features/identity/pasted-link';
import { confirmLink } from '../api/auth';
import { completeSignIn } from '../sign-in-complete';
import { Button } from './ui/button';
import { TextField } from './ui/field';

const INVALID: Record<Extract<PastedLinkResult, { kind: 'invalid' }>['reason'], string> = {
  empty: 'Cole o link que chegou no seu e-mail.',
  not_a_link: 'Isso não parece o link do e-mail. Copie o link inteiro e cole de novo.',
  other_site: 'Este link não é deste site. Use o link do e-mail que o NeuroCapacitar enviou.',
  wrong_page: 'Este não é o link de acesso. Copie o botão "Entrar" do e-mail.',
  reauth:
    'Este é o link de confirmação de identidade, não o de acesso. Peça um novo link de acesso.',
  no_token: 'O link está incompleto. Copie o link inteiro do e-mail e cole de novo.',
};

/**
 * "Já recebeu o link? Cole aqui" (M8-04). No iPhone, o app instalado na tela inicial tem armazenamento próprio e o link do e-mail
 * abre no Safari: a sessão nasce lá e o app continua sem login. Aqui a pessoa cola o link (copiado SEM abri-lo) e o app o confirma
 * dentro do próprio armazenamento: o mesmo link e o mesmo endpoint de sempre, sem novo método de login. O texto colado nunca é
 * mostrado de volta nem registrado.
 */
export function PasteLinkSignIn({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Lê o valor do próprio campo no envio (e não do estado): um toque logo depois de colar não pode usar o texto de antes.
    const typed = event.currentTarget.querySelector('input')?.value ?? text;
    const parsed = parsePastedLink(typed, window.location.origin);
    if (parsed.kind === 'invalid') {
      setError(INVALID[parsed.reason]);
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await confirmLink(parsed.token);
    if (result === 'ok') {
      setText('');
      await completeSignIn(queryClient, () => navigate({ to: '/' }));
      return;
    }
    setBusy(false);
    setError(
      result === 'invalid_or_expired'
        ? 'Este link expirou ou já foi usado. Peça um novo link de acesso.'
        : 'Não foi possível entrar agora. Tente novamente em instantes.',
    );
  }

  return (
    <details open={defaultOpen || undefined} className="mt-8 max-w-md rounded-lg border p-4">
      <summary className="min-h-11 cursor-pointer font-medium">
        Já recebeu o link? Cole aqui
      </summary>
      <form onSubmit={onSubmit} noValidate className="mt-4 grid gap-4">
        <TextField
          label="Link de acesso"
          name="pasted-link"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
          description="No celular, segure o link no e-mail e escolha Copiar (não toque nele). Volte aqui e cole. Serve para entrar no app instalado na tela inicial."
          {...(error ? { error } : {})}
        />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar com o link'}
          </Button>
        </div>
      </form>
    </details>
  );
}
