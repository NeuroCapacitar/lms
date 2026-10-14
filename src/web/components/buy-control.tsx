import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import type { AccessDto } from '../../features/access/access';
import { startCheckoutRequest } from '../api/checkout';
import { AccessStatus } from './enroll-control';
import { Button } from './ui/button';

const ERROR_MESSAGES: Record<string, string> = {
  already_has_access: 'Você já tem acesso a este curso.',
  offer_unavailable: 'Esta oferta não está mais disponível.',
  email_not_verified: 'Confirme o seu e-mail para comprar.',
  account_suspended: 'Sua conta está suspensa. Fale com o suporte.',
  terms_required: 'Aceite os Termos de Uso e a Política de Privacidade para continuar.',
  checkout_in_progress: 'Já estamos abrindo o pagamento. Aguarde alguns segundos e tente de novo.',
  checkout_unknown:
    'Não conseguimos confirmar a abertura do pagamento. Aguarde alguns minutos antes de tentar de novo, para evitar cobrança em duplicidade.',
  order_expired: 'O pedido anterior expirou. Clique em Comprar para começar de novo.',
  order_not_pending: 'Este pedido não está mais aberto. Clique em Comprar para começar de novo.',
  attempt_conflict: 'Algo deu errado com este pedido. Clique em Comprar para tentar de novo.',
  checkout_failed: 'Não foi possível abrir o pagamento agora. Tente novamente em instantes.',
  checkout_not_configured: 'A compra ainda não está disponível neste ambiente.',
};

/** Erros depois dos quais a próxima tentativa precisa de um pedido NOVO (tentativa nova). */
const RESET_ATTEMPT = new Set(['order_expired', 'order_not_pending', 'attempt_conflict']);

const attemptKey = (offerId: string) => `checkout-attempt:${offerId}`;

/** A tentativa da oferta: a mesma enquanto o pedido vale (recarregar a página não cria outro pedido). */
function attemptFor(offerId: string): string {
  try {
    const saved = sessionStorage.getItem(attemptKey(offerId));
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(attemptKey(offerId), fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

function forgetAttempt(offerId: string) {
  try {
    sessionStorage.removeItem(attemptKey(offerId));
  } catch {
    // sem armazenamento: nada a esquecer
  }
}

/**
 * Botão "Comprar" de uma oferta PAGA aberta (M6-02), na página do curso e no catálogo. Leva ao Checkout hospedado do
 * Asaas com o endereço que o servidor devolve (só `https`); nada aqui decide preço nem concede acesso. `access` é
 * `null` sem sessão: então o convite é para entrar, com retorno a esta página.
 */
export function BuyControl({
  courseId,
  offerId,
  access,
  returnTo,
}: {
  courseId: string;
  offerId: string;
  access: AccessDto | null;
  returnTo: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  if (access === null) {
    return (
      <Link to="/entrar" search={{ returnTo }} className="underline">
        Entrar para comprar
      </Link>
    );
  }
  if (access.hasAccess) return <AccessStatus access={access} courseId={courseId} />;
  if (access.reason === 'suspended') {
    return (
      <p role="status" className="font-medium">
        Seu acesso a este curso está suspenso. Fale com o suporte.
      </p>
    );
  }

  async function buy() {
    setBusy(true);
    setMessage(undefined);
    const outcome = await startCheckoutRequest(offerId, attemptFor(offerId));
    if (outcome.result === 'ok' && outcome.data?.checkoutUrl.startsWith('https://')) {
      // Segue para o Checkout hospedado; o botão continua desabilitado até a página sair.
      window.location.assign(outcome.data.checkoutUrl);
      return;
    }
    setBusy(false);
    if (outcome.code && RESET_ATTEMPT.has(outcome.code)) forgetAttempt(offerId);
    setMessage(
      outcome.result === 'unauthenticated'
        ? 'Sua sessão expirou. Entre novamente.'
        : (ERROR_MESSAGES[outcome.code ?? ''] ??
            'Não foi possível abrir o pagamento agora. Tente novamente.'),
    );
  }

  const expired = access.reason === 'expired';
  return (
    <div className="grid gap-2">
      {expired ? (
        <p className="text-sm text-[var(--text-muted)]">
          Seu acesso anterior terminou. Ao comprar de novo você continua de onde parou.
        </p>
      ) : null}
      <div>
        <Button type="button" disabled={busy} onClick={() => void buy()}>
          {busy ? 'Abrindo o pagamento…' : expired ? 'Comprar de novo' : 'Comprar'}
        </Button>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        Pix ou cartão, no ambiente seguro do Asaas. Seus dados de cartão não passam por aqui.
      </p>
      {message ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
