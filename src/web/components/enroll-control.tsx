import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import type { AccessDto } from '../../features/access/access';
import { formatAccessDate } from '../../features/access/format';
import { enrollInCourse } from '../api/enroll';
import { Button } from './ui/button';

const ERROR_MESSAGES: Record<string, string> = {
  offer_unavailable: 'Esta oferta não está mais disponível.',
  offer_not_free: 'Esta oferta não é gratuita e não pode ser iniciada por aqui.',
  enrollment_suspended: 'Seu acesso a este curso está suspenso. Fale com o suporte.',
  account_suspended: 'Sua conta está suspensa. Fale com o suporte.',
  terms_required: 'Aceite os Termos de Uso e a Política de Privacidade para continuar.',
};

/** "Você está inscrito. Acesso até dd/mm/aaaa." (a pessoa já tem acesso válido). */
export function AccessStatus({ access }: { access: AccessDto }) {
  return (
    <p role="status" className="font-medium text-[var(--text-success)]">
      Você está inscrito
      {access.expiresAt ? `. Acesso até ${formatAccessDate(access.expiresAt)}.` : '.'}
    </p>
  );
}

/**
 * Estado de acesso e botão "Inscrever-se" de UM curso com oferta gratuita aberta (M3-02), usado na
 * página do curso e no catálogo. `access` é `null` quando a pessoa NÃO tem sessão: então o convite é
 * para entrar, com retorno a esta página. O botão fica desabilitado enquanto o pedido está em curso
 * (duplo clique), e o servidor é idempotente de qualquer forma. Nada aqui concede acesso: só o
 * servidor decide, e a tela mostra o resultado.
 */
export function EnrollControl({
  courseId,
  offerId,
  access,
  returnTo,
}: {
  courseId: string;
  /** A oferta gratuita aberta que a pessoa está vendo. */
  offerId: string;
  access: AccessDto | null;
  /** Caminho interno desta página, para voltar depois do login. */
  returnTo: string;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();

  if (access === null) {
    return (
      <Link to="/entrar" search={{ returnTo }} className="underline">
        Entrar para se inscrever
      </Link>
    );
  }
  if (access.hasAccess) return <AccessStatus access={access} />;
  if (access.reason === 'suspended') {
    return (
      <p role="status" className="font-medium">
        Seu acesso a este curso está suspenso. Fale com o suporte.
      </p>
    );
  }

  async function enroll() {
    setBusy(true);
    setMessage(undefined);
    const outcome = await enrollInCourse(courseId, offerId);
    if (outcome.result === 'ok' && outcome.data) {
      const until = outcome.data.access.expiresAt
        ? ` Acesso até ${formatAccessDate(outcome.data.access.expiresAt)}.`
        : '';
      setMessage({ kind: 'ok', text: `Inscrição feita.${until}` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['access', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['catalog'] }),
      ]);
      setBusy(false);
      return;
    }
    setBusy(false);
    setMessage({
      kind: 'error',
      text:
        outcome.result === 'unauthenticated'
          ? 'Sua sessão expirou. Entre novamente.'
          : (ERROR_MESSAGES[outcome.code ?? ''] ??
            'Não foi possível fazer a inscrição agora. Tente novamente.'),
    });
  }

  const expired = access.reason === 'expired';
  return (
    <div className="grid gap-2">
      {expired && access.expiresAt ? (
        <p className="text-sm text-[var(--text-muted)]">
          Seu acesso anterior terminou em {formatAccessDate(access.expiresAt)}. Ao se inscrever de
          novo você continua de onde parou.
        </p>
      ) : null}
      <div>
        <Button type="button" disabled={busy} onClick={() => void enroll()}>
          {busy ? 'Inscrevendo…' : expired ? 'Inscrever-se de novo' : 'Inscrever-se'}
        </Button>
      </div>
      {message ? (
        <p
          role={message.kind === 'ok' ? 'status' : 'alert'}
          className={
            message.kind === 'ok'
              ? 'font-medium text-[var(--text-success)]'
              : 'font-medium text-[var(--text-danger)]'
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
