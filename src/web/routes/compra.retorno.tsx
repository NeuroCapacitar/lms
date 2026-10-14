import { Link, createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { RequireTerms } from '../components/require-terms';

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

const COPY = {
  sucesso: {
    title: 'Estamos confirmando o seu pagamento',
    text: 'Assim que o pagamento for confirmado, o seu acesso é liberado. Pode levar alguns minutos (o Pix costuma ser rápido). Esta página não libera o acesso: só a confirmação do pagamento libera.',
  },
  cancelado: {
    title: 'Pagamento cancelado',
    text: 'Nada foi cobrado. Você pode voltar ao curso e comprar quando quiser.',
  },
  expirado: {
    title: 'O pagamento expirou',
    text: 'O prazo para pagar terminou e nada foi cobrado. Volte ao curso e clique em Comprar para começar de novo.',
  },
} as const;

/**
 * Retorno do Checkout (M6-02). Autenticada. Só informa: o resultado da URL é uma DICA da pessoa e nunca concede
 * acesso. A leitura do pagamento e a liberação são do M6-07, que acrescenta aqui o estado do pedido.
 */
function PurchaseReturn() {
  const { resultado } = Route.useSearch();
  const copy = COPY[resultado];
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
