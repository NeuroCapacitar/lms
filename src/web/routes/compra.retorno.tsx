import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import type { OrderDto, OrderStatus } from '../../features/commerce/commerce';
import { checkOrder } from '../api/orders';
import { RequireTerms } from '../components/require-terms';
import { Button } from '../components/ui/button';

const searchSchema = z.object({
  pedido: z.uuid().optional().catch(undefined),
  resultado: z.enum(['sucesso', 'cancelado', 'expirado']).catch('sucesso'),
});

export const Route = createFileRoute('/compra/retorno')({
  validateSearch: searchSchema,
  component: () => (
    <RequireTerms>
      <PurchaseReturn />
    </RequireTerms>
  ),
});

const STATIC_COPY = {
  cancelado: {
    title: 'Pagamento cancelado',
    text: 'Nada foi cobrado. Você pode voltar ao curso e comprar quando quiser.',
  },
  expirado: {
    title: 'O pagamento expirou',
    text: 'O prazo para pagar terminou e nada foi cobrado. Volte ao curso e clique em Comprar para começar de novo.',
  },
} as const;

const PROCESSING = {
  title: 'Estamos confirmando o seu pagamento',
  text: 'Assim que o pagamento for confirmado, o seu acesso é liberado. Pode levar alguns minutos (o Pix costuma ser rápido). Esta página só mostra o que o servidor já confirmou.',
};

/** O texto do estado do pedido, como o servidor o devolveu. Nada aqui decide acesso. */
function copyFor(status: OrderStatus): { title: string; text: string } {
  switch (status) {
    case 'paid':
      return {
        title: 'Pagamento confirmado',
        text: 'Seu acesso ao curso está liberado. Você também vai receber um e-mail de confirmação.',
      };
    case 'expired':
    case 'canceled':
      return {
        title: 'Este pedido não foi concluído',
        text: 'Nada foi cobrado neste pedido. Volte ao curso e clique em Comprar para começar de novo.',
      };
    case 'review':
    case 'disputed':
    case 'refund_requested':
    case 'refunded':
      return {
        title: 'Seu pedido está em análise',
        text: 'Precisamos conferir este pagamento. Se precisar, fale com o suporte pela página de Ajuda e informe o número do pedido.',
      };
    default:
      return PROCESSING;
  }
}

/**
 * Retorno do Checkout (M6-02 e M6-07). Autenticada. O resultado da URL é só uma DICA da pessoa: nunca concede nada. Em
 * `sucesso` com um pedido válido, a página pede UMA conferência ao servidor, que lê o pagamento na API do Asaas e decide;
 * a tela mostra o estado devolvido. "Conferir de novo" tem limite no servidor (10 por pedido).
 */
function PurchaseReturn() {
  const { resultado, pedido } = Route.useSearch();
  if (resultado !== 'sucesso') {
    const copy = STATIC_COPY[resultado];
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">{copy.title}</h1>
        <p role="status" className="mb-6 max-w-prose">
          {copy.text}
        </p>
        <Link to="/cursos" className="underline">
          Ver os cursos
        </Link>
      </>
    );
  }
  return <ConfirmedOrder orderId={pedido} />;
}

type View =
  | { kind: 'loading' }
  | { kind: 'order'; order: OrderDto; limited: boolean }
  | { kind: 'unavailable' }
  | { kind: 'not_found' }
  | { kind: 'unauthenticated' };

function ConfirmedOrder({ orderId }: { orderId: string | undefined }) {
  const [view, setView] = useState<View>(orderId ? { kind: 'loading' } : { kind: 'not_found' });
  const started = useRef(false);

  const check = useCallback(async () => {
    if (!orderId) return;
    setView({ kind: 'loading' });
    const outcome = await checkOrder(orderId);
    if (outcome.result === 'ok' && outcome.data) {
      setView({ kind: 'order', order: outcome.data.order, limited: outcome.data.limited });
    } else if (outcome.result === 'unauthenticated') {
      setView({ kind: 'unauthenticated' });
    } else if (outcome.result === 'not_found') {
      setView({ kind: 'not_found' });
    } else {
      setView({ kind: 'unavailable' });
    }
  }, [orderId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check();
  }, [check]);

  if (view.kind === 'unauthenticated') {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Entre para ver o seu pedido</h1>
        <Link to="/entrar" className="underline">
          Entrar
        </Link>
      </>
    );
  }
  if (view.kind === 'not_found') {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Pedido não encontrado</h1>
        <p role="status" className="mb-6 max-w-prose">
          Não encontramos este pedido na sua conta. Se você acabou de pagar, o seu acesso é liberado
          assim que o pagamento for confirmado.
        </p>
        <Link to="/cursos" className="underline">
          Ver os cursos
        </Link>
      </>
    );
  }
  const copy =
    view.kind === 'order'
      ? copyFor(view.order.status)
      : view.kind === 'unavailable'
        ? {
            title: 'Ainda não conseguimos confirmar',
            text: 'Não foi possível consultar o pagamento agora. Isso não cancela nada: tente conferir de novo em instantes. Seu acesso é liberado assim que o pagamento for confirmado.',
          }
        : PROCESSING;
  const pending =
    view.kind === 'unavailable' || (view.kind === 'order' && view.order.status === 'pending');
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">{copy.title}</h1>
      <p role="status" className="mb-6 max-w-prose">
        {view.kind === 'loading' ? 'Conferindo o pagamento…' : copy.text}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {pending && !(view.kind === 'order' && view.limited) ? (
          <Button type="button" variant="secondary" onClick={() => void check()}>
            Conferir de novo
          </Button>
        ) : null}
        <Link to="/cursos" className="underline">
          Ver os cursos
        </Link>
      </div>
      {view.kind === 'order' && view.limited && view.order.status === 'pending' ? (
        <p className="mt-4 max-w-prose text-sm text-[var(--text-muted)]">
          Já conferimos várias vezes. O acesso é liberado automaticamente assim que o pagamento for
          confirmado; se demorar, fale com o suporte pela página de Ajuda.
        </p>
      ) : null}
    </>
  );
}
