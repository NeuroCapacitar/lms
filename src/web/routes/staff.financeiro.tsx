import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { formatBrl } from '../../features/catalog/money';
import {
  DISMISSABLE_REVIEW_TYPES,
  REVIEW_TYPE_LABELS,
  type ReviewDto,
} from '../../features/commerce/review';
import type { ActionOutcome } from '../api/action';
import {
  fetchFinanceOrders,
  fetchRefunds,
  fetchReviews,
  revealDocument,
  requestRefundRequest,
  resolveReviewRequest,
} from '../api/finance';
import { REFUND_STATE_LABELS } from '../../features/commerce/refund';
import { ORDER_STATUSES } from '../../features/commerce/commerce';
import type { FinanceOrdersQuery } from '../../features/commerce/finance-view';
import { fetchAccess } from '../api/http';
import { ReauthPanel } from '../components/reauth-panel';
import { TextField } from '../components/ui/field';
import { ForbiddenError } from '../api/http';
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
  invalid_request: 'Confira o número do pedido e o motivo (pelo menos 5 caracteres).',
  order_not_refundable:
    'Este pedido não pode ser reembolsado agora (só pedidos pagos, com acesso ativo).',
  refund_already_active: 'Já existe um reembolso em andamento para este pedido.',
  refund_window_closed: 'Passaram os 7 dias: só o Admin pode reembolsar depois do prazo.',
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
  const access = useQuery({ queryKey: ['access'], queryFn: fetchAccess, retry: false });
  const canViewOrders = access.data?.capabilities.includes('finance.view') ?? false;
  const canRefund = access.data?.capabilities.includes('refund.execute') ?? false;
  const [prefill, setPrefill] = useState('');

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
      {canViewOrders ? (
        <OrdersSection
          canRefund={canRefund}
          onRefund={(orderId) => {
            setPrefill(orderId);
            document.getElementById('reembolsos-titulo')?.scrollIntoView({ block: 'start' });
          }}
        />
      ) : null}
      <RefundSection prefill={prefill} />
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

/**
 * Reembolsos (M6-05): pedido INTEGRAL, com motivo, só com o grant `refund.execute` e reautenticação recente. Enquanto não
 * há a tela de pedidos (M6-08) o pedido é identificado pelo número. Dentro de 7 dias qualquer Suporte com o grant; depois,
 * só o Admin. Ao pedir, o acesso da pessoa é suspenso; se o Asaas recusar, é devolvido.
 */
function RefundSection({ prefill }: { prefill: string }) {
  const queryClient = useQueryClient();
  const refunds = useQuery({ queryKey: ['finance-refunds'], queryFn: fetchRefunds, retry: false });
  const [orderId, setOrderId] = useState(prefill);
  useEffect(() => {
    if (prefill) setOrderId(prefill);
  }, [prefill]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();

  async function submit() {
    setBusy(true);
    setMessage(undefined);
    setNeedsReauth(false);
    const outcome = await requestRefundRequest(orderId.trim(), reason);
    setBusy(false);
    if (outcome.result === 'ok') {
      setMessage({
        kind: 'ok',
        text: 'Reembolso pedido. O acesso da pessoa foi suspenso até o Asaas concluir.',
      });
      setOrderId('');
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['finance-refunds'] });
      return;
    }
    if (outcome.result === 'reauth_required') {
      setNeedsReauth(true);
      return;
    }
    setMessage({ kind: 'error', text: failureText(outcome) });
  }

  // Sem o grant a seção some (a API responde 403 e o resto da página segue).
  if (refunds.error instanceof ForbiddenError) return null;
  return (
    <section aria-labelledby="reembolsos-titulo" className="mb-10 grid gap-4">
      <h2 id="reembolsos-titulo" className="text-xl font-semibold">
        Reembolsos
      </h2>
      {needsReauth ? <ReauthPanel action="pedir um reembolso" /> : null}
      <form
        noValidate
        aria-label="Pedir reembolso integral"
        className="grid max-w-xl gap-3 rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="Número do pedido"
          description="O reembolso é sempre do valor INTEGRAL. Dentro de 7 dias qualquer Suporte com o grant; depois, só o Admin."
          value={orderId}
          maxLength={36}
          onChange={(event) => setOrderId(event.target.value)}
        />
        <TextArea
          id="motivo-reembolso"
          label="Motivo do reembolso"
          description="Obrigatório (mínimo de 5 caracteres). Fica na auditoria."
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
        <div>
          <Button
            type="submit"
            disabled={busy || orderId.trim() === '' || reason.trim().length < 5}
          >
            Pedir reembolso integral
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
      </form>
      {refunds.isPending ? (
        <p role="status">Carregando…</p>
      ) : refunds.isError ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível carregar os reembolsos agora.
        </p>
      ) : refunds.data.length === 0 ? (
        <p className="text-[var(--text-muted)]">Nenhum reembolso pedido ainda.</p>
      ) : (
        <ul className="grid gap-3" aria-label="Reembolsos pedidos">
          {refunds.data.map((refund) => (
            <li key={refund.id} className="grid gap-1 rounded-lg border p-4 text-sm">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{refund.buyerName}</span>
                <span>{refund.courseTitle}</span>
                <span className="rounded border px-1.5 text-xs font-medium">
                  {REFUND_STATE_LABELS[refund.state] ?? refund.state}
                </span>
              </p>
              <p className="text-[var(--text-muted)]">
                {formatBrl(refund.priceCents)} · {dateFormat.format(new Date(refund.createdAt))}
                {refund.failureCode ? ` · Motivo da falha: ${refund.failureCode}` : ''}
              </p>
              <p>{refund.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  expired: 'Vencido',
  canceled: 'Cancelado',
  refund_requested: 'Reembolso pedido',
  refunded: 'Reembolsado',
  disputed: 'Em disputa',
  review: 'Em revisão',
};
const METHOD_LABELS = { pix: 'Pix', card: 'Cartão' } as const;

/**
 * Pedidos e pagamentos (M6-08), só com o grant `finance.view`: filtros por período e estado, totais do mesmo filtro
 * (o "recebido" NÃO inclui os pedidos pendentes) e o pagador com o CPF/CNPJ MASCARADO. Revelar o número completo pede
 * reautenticação e grava auditoria no servidor; o número só fica na tela, nunca em cache. Sem exportação: só se o
 * contador pedir.
 */
function OrdersSection({
  canRefund,
  onRefund,
}: {
  canRefund: boolean;
  onRefund: (orderId: string) => void;
}) {
  const [filters, setFilters] = useState<FinanceOrdersQuery>({});
  const [draft, setDraft] = useState<FinanceOrdersQuery>({});
  const orders = useQuery({
    queryKey: ['finance-orders', filters],
    queryFn: () => fetchFinanceOrders(filters),
    retry: false,
    gcTime: 0,
  });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [needsReauth, setNeedsReauth] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function reveal(paymentId: string) {
    setError(undefined);
    setNeedsReauth(false);
    const outcome = await revealDocument(paymentId);
    if (outcome.result === 'ok' && outcome.data) {
      setRevealed((current) => ({ ...current, [paymentId]: outcome.data!.document }));
      return;
    }
    if (outcome.result === 'reauth_required') {
      setNeedsReauth(true);
      return;
    }
    setError(
      outcome.code === 'document_vault_unavailable'
        ? 'O cofre de documentos não está disponível neste ambiente.'
        : 'Não foi possível revelar o documento agora.',
    );
  }

  return (
    <section aria-labelledby="pedidos-titulo" className="mb-10 grid gap-4">
      <h2 id="pedidos-titulo" className="text-xl font-semibold">
        Pedidos e pagamentos
      </h2>
      {needsReauth ? <ReauthPanel action="revelar o CPF/CNPJ" /> : null}
      <form
        noValidate
        aria-label="Filtrar pedidos"
        className="grid max-w-3xl gap-3 sm:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters({ ...draft });
          setRevealed({});
        }}
      >
        <label className="grid gap-1.5">
          <span className="font-medium text-[var(--field-label)]">De</span>
          <input
            type="date"
            value={draft.from ?? ''}
            onChange={(event) => setDraft({ ...draft, from: event.target.value || undefined })}
            className="min-h-11 rounded-lg border bg-[var(--input-bg)] px-2 text-[var(--input-fg)]"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="font-medium text-[var(--field-label)]">Até</span>
          <input
            type="date"
            value={draft.to ?? ''}
            onChange={(event) => setDraft({ ...draft, to: event.target.value || undefined })}
            className="min-h-11 rounded-lg border bg-[var(--input-bg)] px-2 text-[var(--input-fg)]"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="font-medium text-[var(--field-label)]">Estado do pedido</span>
          <select
            value={draft.status ?? ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                status: (event.target.value || undefined) as FinanceOrdersQuery['status'],
              })
            }
            className="min-h-11 rounded-lg border bg-[var(--input-bg)] px-2 text-[var(--input-fg)]"
          >
            <option value="">Todos</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button type="submit">Filtrar</Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          {error}
        </p>
      ) : null}
      {orders.isPending ? (
        <p role="status">Carregando…</p>
      ) : orders.isError ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível carregar os pedidos agora.
        </p>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-3" aria-label="Totais do filtro">
            <div className="rounded-lg border p-3">
              <dt className="text-sm text-[var(--text-muted)]">Recebido (pedidos pagos)</dt>
              <dd className="text-lg font-semibold">
                {formatBrl(orders.data.summary.paidCents)} · {orders.data.summary.paidCount}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-sm text-[var(--text-muted)]">Reembolsado</dt>
              <dd className="text-lg font-semibold">
                {formatBrl(orders.data.summary.refundedCents)} · {orders.data.summary.refundedCount}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-sm text-[var(--text-muted)]">Pendente (não entra no recebido)</dt>
              <dd className="text-lg font-semibold">
                {formatBrl(orders.data.summary.pendingCents)} · {orders.data.summary.pendingCount}
              </dd>
            </div>
          </dl>
          {orders.data.orders.length === 0 ? (
            <p className="text-[var(--text-muted)]">Nenhum pedido neste filtro.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
                <caption className="sr-only">Pedidos e pagamentos</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="p-2">
                      Data
                    </th>
                    <th scope="col" className="p-2">
                      Curso e comprador
                    </th>
                    <th scope="col" className="p-2">
                      Valor
                    </th>
                    <th scope="col" className="p-2">
                      Forma
                    </th>
                    <th scope="col" className="p-2">
                      Estado
                    </th>
                    <th scope="col" className="p-2">
                      Pagador
                    </th>
                    <th scope="col" className="p-2">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data.orders.map((row) => (
                    <tr key={row.orderId} className="border-b align-top">
                      <td className="p-2">
                        <time dateTime={row.createdAt}>
                          {dateFormat.format(new Date(row.createdAt))}
                        </time>
                      </td>
                      <td className="p-2">
                        <p className="font-medium">{row.courseTitle}</p>
                        <p className="text-[var(--text-muted)]">{row.buyerName}</p>
                        <p className="break-all text-xs text-[var(--text-muted)]">{row.orderId}</p>
                      </td>
                      <td className="p-2">{formatBrl(row.priceCents)}</td>
                      <td className="p-2">
                        {row.method ? METHOD_LABELS[row.method] : '—'}
                        {row.paymentCount > 1 ? ` (${row.paymentCount}x)` : ''}
                      </td>
                      <td className="p-2">{STATUS_LABELS[row.status] ?? row.status}</td>
                      <td className="p-2">
                        <p>{row.payerName ?? 'Não lido'}</p>
                        {row.revealablePaymentId && revealed[row.revealablePaymentId] ? (
                          <p className="font-mono">
                            {revealed[row.revealablePaymentId]}{' '}
                            <button
                              type="button"
                              className="underline"
                              onClick={() =>
                                setRevealed((current) => {
                                  const { [row.revealablePaymentId!]: _hidden, ...rest } = current;
                                  return rest;
                                })
                              }
                            >
                              Ocultar
                            </button>
                          </p>
                        ) : (
                          <p className="font-mono">
                            {row.payerDocumentMasked ?? 'CPF/CNPJ não informado'}
                          </p>
                        )}
                        {row.revealablePaymentId && !revealed[row.revealablePaymentId] ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void reveal(row.revealablePaymentId!)}
                            aria-label={`Revelar CPF/CNPJ do pedido ${row.orderId}`}
                          >
                            Revelar
                          </Button>
                        ) : null}
                      </td>
                      <td className="p-2">
                        {canRefund && row.status === 'paid' ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => onRefund(row.orderId)}
                            aria-label={`Reembolsar o pedido ${row.orderId}`}
                          >
                            Reembolsar
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {orders.data.truncated ? (
            <p className="text-sm text-[var(--text-muted)]">
              Mostrando os 200 mais recentes: use o período ou o estado para refinar.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
