import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { formatBrl } from '../../features/catalog/money';
import {
  DISMISSABLE_REVIEW_TYPES,
  REVIEW_TYPE_LABELS,
  type ReviewDto,
} from '../../features/commerce/review';
import type { ActionOutcome } from '../api/action';
import { fetchReviews, resolveReviewRequest } from '../api/finance';
import { ForbiddenError } from '../api/staff';
import { Button } from '../components/ui/button';
import { TextArea } from '../components/ui/text-area';

export const Route = createFileRoute('/staff/financeiro')({ component: StaffFinance });

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const FAILURES: Record<string, string> = {
  already_resolved: 'Esta revisão já foi resolvida. Atualize a lista.',
  action_not_allowed: 'Esta ação não vale para este tipo de revisão.',
  not_reconcilable: 'Não há pagamento para reconciliar nesta revisão.',
  stale: 'O pagamento mudou desde que a revisão foi aberta. Atualize e decida de novo.',
  other_open_reviews: 'Há outra revisão aberta neste pedido. Resolva as outras primeiro.',
  still_divergent: 'O Asaas ainda mostra a divergência: nada foi alterado.',
  payment_provider_unavailable:
    'Não foi possível consultar o Asaas agora. Tente de novo em instantes.',
  payment_provider_error: 'O Asaas recusou a consulta. Fale com quem administra a conta.',
  checkout_not_configured: 'O Asaas não está configurado neste ambiente.',
  not_found: 'A revisão não existe mais. Atualize a lista.',
  forbidden: 'Você não tem a permissão de resolver revisões financeiras.',
  invalid_request: 'O motivo precisa de pelo menos 5 caracteres.',
};

function failureText(outcome: ActionOutcome<unknown>): string {
  if (outcome.result === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
  return (
    (outcome.code ? FAILURES[outcome.code] : undefined) ??
    (outcome.result === 'invalid' ? FAILURES.invalid_request! : 'Não foi possível concluir agora.')
  );
}

/**
 * Revisões financeiras (M6-04), só com o grant `finance.review`. Lista o que o sistema não pôde decidir e oferece as
 * três ações, sempre com MOTIVO (auditado): reconciliar (reler o pagamento), aprovar (só valor divergente, com o valor
 * observado à vista) e dispensar (só tipos sem pagamento). O servidor decide e confere cada ação.
 */
function StaffFinance() {
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ['finance-reviews'],
    queryFn: () => fetchReviews('open'),
    retry: false,
  });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();

  async function run(work: () => Promise<ActionOutcome<unknown>>, ok: string): Promise<boolean> {
    setMessage(undefined);
    const outcome = await work();
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: ok });
      await queryClient.invalidateQueries({ queryKey: ['finance-reviews'] });
      return true;
    }
    setMessage({ kind: 'error', text: failureText(outcome) });
    return false;
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Financeiro</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Revisões de pagamentos que o sistema não pôde decidir sozinho. Nada é liberado por dúvida: o
        acesso só sai depois de uma evidência segura ou de uma decisão sua, com motivo.
      </p>
      {reviews.error instanceof ForbiddenError ? (
        <p role="alert">Você não tem a permissão de ver as revisões financeiras.</p>
      ) : reviews.isPending ? (
        <p role="status">Carregando…</p>
      ) : reviews.isError ? (
        <>
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            Não foi possível carregar as revisões agora.
          </p>
          <div>
            <Button type="button" variant="secondary" onClick={() => void reviews.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </>
      ) : (
        <>
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
          {reviews.data.length === 0 ? (
            <p className="text-[var(--text-muted)]">Nenhuma revisão aberta.</p>
          ) : (
            <ul className="grid gap-4" aria-label="Revisões abertas">
              {reviews.data.map((review) => (
                <li key={review.id}>
                  <ReviewCard review={review} run={run} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function ReviewCard({
  review,
  run,
}: {
  review: ReviewDto;
  run: (work: () => Promise<ActionOutcome<unknown>>, ok: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const label = REVIEW_TYPE_LABELS[review.type] ?? review.type;
  const canApprove = review.type === 'amount_mismatch';
  const canDismiss = (DISMISSABLE_REVIEW_TYPES as readonly string[]).includes(review.type);
  const canReconcile = review.providerPaymentId !== null;
  const ready = reason.trim().length >= 5 && !busy;

  async function act(action: 'approve' | 'reconcile' | 'dismiss', ok: string) {
    setBusy(true);
    const done = await run(() => resolveReviewRequest(review.id, action, reason), ok);
    setBusy(false);
    if (done) setReason('');
  }

  return (
    <article aria-label={`Revisão: ${label}`} className="grid gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold">{label}</span>
        <time dateTime={review.createdAt} className="text-[var(--text-muted)]">
          {dateFormat.format(new Date(review.createdAt))}
        </time>
      </header>
      <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
        {review.courseTitle ? (
          <>
            <dt className="text-[var(--text-muted)]">Curso</dt>
            <dd>{review.courseTitle}</dd>
          </>
        ) : null}
        {review.buyerName ? (
          <>
            <dt className="text-[var(--text-muted)]">Comprador</dt>
            <dd>{review.buyerName}</dd>
          </>
        ) : null}
        {review.priceCents !== null ? (
          <>
            <dt className="text-[var(--text-muted)]">Valor do pedido</dt>
            <dd>{formatBrl(review.priceCents)}</dd>
          </>
        ) : null}
        {review.observedCents !== null ? (
          <>
            <dt className="text-[var(--text-muted)]">Valor observado no Asaas</dt>
            <dd className="font-medium">{formatBrl(review.observedCents)}</dd>
          </>
        ) : null}
        {review.orderStatus ? (
          <>
            <dt className="text-[var(--text-muted)]">Estado do pedido</dt>
            <dd>{review.orderStatus}</dd>
          </>
        ) : null}
        <dt className="text-[var(--text-muted)]">Código</dt>
        <dd>{review.reason}</dd>
      </dl>
      <TextArea
        id={`motivo-${review.id}`}
        label={`Motivo (${label})`}
        description="Obrigatório (mínimo de 5 caracteres). Fica na auditoria."
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {canReconcile ? (
          <Button
            type="button"
            variant="secondary"
            disabled={!ready}
            onClick={() => void act('reconcile', 'Pagamento conferido: a revisão foi resolvida.')}
          >
            Reconciliar ({label})
          </Button>
        ) : null}
        {canApprove ? (
          <Button
            type="button"
            disabled={!ready}
            onClick={() => void act('approve', 'Valor aprovado: o acesso foi liberado.')}
          >
            Aprovar o valor observado ({label})
          </Button>
        ) : null}
        {canDismiss ? (
          <Button
            type="button"
            variant="secondary"
            disabled={!ready}
            onClick={() => void act('dismiss', 'Revisão dispensada.')}
          >
            Dispensar ({label})
          </Button>
        ) : null}
      </div>
    </article>
  );
}
