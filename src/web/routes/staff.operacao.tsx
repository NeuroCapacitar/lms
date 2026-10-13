import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';

import type { LaneName, OperationsSnapshot, ProblemItem } from '../../features/ops/operations';
import type { ActionResult } from '../api/action';
import { fetchOperations, pauseQueue, requeueItem } from '../api/operations';
import { ForbiddenError, fetchAccess } from '../api/staff';
import { ReauthPanel } from '../components/reauth-panel';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/staff/operacao')({ component: Operations });

const LANE_LABELS: Record<LaneName, string> = { finance: 'Financeira', general: 'Geral' };

const STATE_LABELS: Record<string, string> = {
  pending: 'Pendente',
  leased: 'Em processamento',
  delivered: 'Concluído',
  failed: 'Falhou (decisão humana)',
  dead: 'Esgotou as tentativas (DLQ)',
  superseded: 'Substituído',
  queued: 'Na fila',
  sending: 'Enviando',
  accepted: 'Aceito pelo provedor',
  acceptance_unknown: 'Aceite incerto',
  delayed: 'Atrasado',
  bounced: 'Devolvido (bounce)',
  complained: 'Reclamação',
  suppressed: 'Suprimido',
  blocked: 'Bloqueado (fora da lista permitida)',
};

const SEVERITY_LABELS = {
  P0: 'P0 crítico',
  P1: 'P1 urgente',
  P2: 'P2 atenção',
  P3: 'P3 aviso',
} as const;

const FAILURES: Partial<Record<ActionResult, string>> = {
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  invalid: 'Informe o motivo (de 5 a 500 caracteres).',
  forbidden: 'Você não tem permissão para esta ação.',
  not_found: 'Não encontramos o item. Atualize a página.',
  conflict: 'O item já foi tratado ou não pode ser reenfileirado agora. Atualize a página.',
  unavailable: 'Não foi possível concluir agora. Tente novamente em instantes.',
};

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const formatWhen = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');

function formatAge(seconds: number | null): string {
  if (seconds === null) return 'nenhum item aberto';
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1).replace('.', ',')} h`;
}

const label = (state: string) => STATE_LABELS[state] ?? state;

/** Tabela com legenda e cabeçalhos de coluna (leitor de tela e teclado). */
function DataTable({
  caption,
  headers,
  rows,
  empty,
}: {
  caption: string;
  headers: string[];
  rows: (string | number | ReactNode)[][];
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-[var(--text-muted)]">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="border-b p-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row" className="border-b p-2 font-normal">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex} className="border-b p-2">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProblemRow({
  item,
  canRequeue,
  busy,
  onRequeue,
}: {
  item: ProblemItem;
  canRequeue: boolean;
  busy: boolean;
  onRequeue: (id: string, reason: string) => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  if (!canRequeue) return <span className="text-[var(--text-muted)]">sem permissão</span>;
  if (!asking) {
    return (
      <Button
        type="button"
        variant="secondary"
        aria-label={`Reenfileirar o item ${item.id.slice(0, 8)}`}
        onClick={() => setAsking(true)}
      >
        Reenfileirar
      </Button>
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onRequeue(item.id, reason)) setAsking(false);
  }
  return (
    <form onSubmit={submit} noValidate className="grid min-w-56 gap-2">
      <TextField
        label="Motivo (vai para a auditoria)"
        name={`motivo-${item.id}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        autoComplete="off"
      />
      <span className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Confirmar
        </Button>
        <Button type="button" variant="secondary" onClick={() => setAsking(false)}>
          Cancelar
        </Button>
      </span>
    </form>
  );
}

function QueueControl({
  lane,
  paused,
  busy,
  onPause,
}: {
  lane: LaneName;
  paused: boolean;
  busy: boolean;
  onPause: (lane: LaneName, paused: boolean, reason: string) => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const action = paused ? 'Retomar' : 'Pausar';
  if (!asking) {
    return (
      <Button type="button" variant="secondary" onClick={() => setAsking(true)}>
        {action} a fila {LANE_LABELS[lane].toLowerCase()}
      </Button>
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onPause(lane, !paused, reason)) {
      setAsking(false);
      setReason('');
    }
  }
  return (
    <form onSubmit={submit} noValidate className="grid max-w-sm gap-2">
      <TextField
        label={`Motivo para ${action.toLowerCase()} a fila ${LANE_LABELS[lane].toLowerCase()}`}
        name={`pausa-${lane}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        autoComplete="off"
      />
      <span className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Confirmar
        </Button>
        <Button type="button" variant="secondary" onClick={() => setAsking(false)}>
          Cancelar
        </Button>
      </span>
    </form>
  );
}

function Quota({ snapshot }: { snapshot: OperationsSnapshot }) {
  const { quota } = snapshot;
  return (
    <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1">
      <dt>Hoje (UTC)</dt>
      <dd>
        {quota.today} de {quota.dailyLimit}
      </dd>
      <dt>Neste mês</dt>
      <dd>
        {quota.month} de {quota.monthlyLimit}
      </dd>
      <dt>Últimos 7 dias</dt>
      <dd>{quota.last7Days}</dd>
    </dl>
  );
}

/**
 * Tela "Operação" (M4-05). LEITURA para toda a Staff: filas, itens com problema, execuções do Cron,
 * webhooks, e-mail e cota; nunca mostra payload, e-mail nem dado pessoal. As ações só aparecem para quem
 * tem a permissão (reenfileirar: "operar fila"; pausar fila: Admin), mas isso é só conveniência: o servidor
 * confere cada ação, pede a reautenticação e grava o motivo na auditoria.
 */
function Operations() {
  const queryClient = useQueryClient();
  const operations = useQuery({
    queryKey: ['operations'],
    queryFn: fetchOperations,
    retry: false,
    refetchInterval: 60_000,
  });
  const access = useQuery({ queryKey: ['access'], queryFn: fetchAccess, retry: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const [needsReauth, setNeedsReauth] = useState<string | undefined>();

  const capabilities = new Set(access.data?.capabilities ?? []);

  async function run(action: () => Promise<ActionResult>, ok: string, reauthFor: string) {
    setBusy(true);
    setMessage(undefined);
    const result = await action();
    setBusy(false);
    if (result === 'reauth_required') {
      setNeedsReauth(reauthFor);
      return false;
    }
    setNeedsReauth(undefined);
    if (result === 'ok') {
      setMessage({ kind: 'ok', text: ok });
      await queryClient.invalidateQueries({ queryKey: ['operations'] });
      return true;
    }
    setMessage({ kind: 'error', text: FAILURES[result] ?? FAILURES.unavailable! });
    return false;
  }

  if (operations.isPending) return <p role="status">Carregando…</p>;
  if (operations.error instanceof ForbiddenError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Operação</h1>
        <p role="alert">Você não tem permissão para ver esta área.</p>
      </>
    );
  }
  if (operations.isError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Operação</h1>
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar o estado agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void operations.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }

  const { snapshot, alerts } = operations.data;
  const canRequeue = capabilities.has('ops.queue');
  const canPause = capabilities.has('system.maintenance');

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Operação</h1>
      <p className="mb-6 max-w-prose text-[var(--text-muted)]">
        O estado do que roda em segundo plano: filas, execuções do Cron, webhooks e e-mail. Esta
        tela nunca mostra o conteúdo das mensagens nem dados de pessoas. Atualiza sozinha a cada
        minuto.
      </p>
      <p className="mb-8">
        <Button type="button" variant="secondary" onClick={() => void operations.refetch()}>
          Atualizar agora
        </Button>
      </p>

      {needsReauth ? <ReauthPanel action={needsReauth} /> : null}
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

      <section aria-labelledby="alertas-titulo" className="mb-10 grid gap-3">
        <h2 id="alertas-titulo" className="text-xl font-semibold">
          Alertas
        </h2>
        {alerts.length === 0 ? (
          <p role="status">Nenhum alerta no momento.</p>
        ) : (
          <ul className="grid gap-2">
            {alerts.map((alert) => (
              <li key={alert.code} className="rounded-lg border p-3">
                <strong>{SEVERITY_LABELS[alert.severity]}</strong>: {alert.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="filas-titulo" className="mb-10 grid gap-4">
        <h2 id="filas-titulo" className="text-xl font-semibold">
          Filas
        </h2>
        <DataTable
          caption="Itens por fila e estado"
          headers={['Fila', 'Estado', 'Itens']}
          rows={snapshot.outbox.map((row) => [LANE_LABELS[row.queue], label(row.state), row.count])}
          empty="Nenhum item na fila."
        />
        <ul className="grid gap-1">
          {(['finance', 'general'] as const).map((lane) => (
            <li key={lane}>
              Fila {LANE_LABELS[lane].toLowerCase()}: item aberto mais antigo há{' '}
              {formatAge(snapshot.oldestOpenAgeSeconds[lane])}
              {snapshot.paused[lane] ? ' — PAUSADA' : ''}
            </li>
          ))}
        </ul>
        {canPause ? (
          <div className="grid gap-3">
            {(['finance', 'general'] as const).map((lane) => (
              <QueueControl
                key={lane}
                lane={lane}
                paused={snapshot.paused[lane]}
                busy={busy}
                onPause={(target, paused, reason) =>
                  run(
                    () => pauseQueue(target, paused, reason),
                    paused ? 'Fila pausada.' : 'Fila retomada.',
                    'pausar ou retomar uma fila',
                  )
                }
              />
            ))}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="problemas-titulo" className="mb-10 grid gap-4">
        <h2 id="problemas-titulo" className="text-xl font-semibold">
          Itens com problema
        </h2>
        <DataTable
          caption="Itens que esgotaram as tentativas ou falharam de forma definitiva"
          headers={['Item', 'Tipo', 'Fila', 'Estado', 'Tentativas', 'Erro', 'Quando', 'Ação']}
          rows={snapshot.problems.map((item) => [
            item.id.slice(0, 8),
            item.kind,
            LANE_LABELS[item.queue],
            label(item.state),
            item.attempts,
            item.lastErrorCode ?? '—',
            formatWhen(item.finishedAt),
            <ProblemRow
              key={item.id}
              item={item}
              canRequeue={canRequeue}
              busy={busy}
              onRequeue={(id, reason) =>
                run(() => requeueItem(id, reason), 'Item reenfileirado.', 'reenfileirar um item')
              }
            />,
          ])}
          empty="Nenhum item com problema."
        />
      </section>

      <section aria-labelledby="cron-titulo" className="mb-10 grid gap-4">
        <h2 id="cron-titulo" className="text-xl font-semibold">
          Execuções do Cron
        </h2>
        <p>
          Último ciclo:{' '}
          {snapshot.cronAgeSeconds === null
            ? 'nunca registrado'
            : `há ${formatAge(snapshot.cronAgeSeconds)}`}
          .
        </p>
        <DataTable
          caption="Última execução de cada job"
          headers={['Job', 'Resultado', 'Itens', 'Duração', 'Terminou']}
          rows={snapshot.jobs.map((job) => [
            job.name,
            job.running
              ? 'em execução'
              : job.lastStatus === 'error'
                ? `erro (${job.lastErrorCode ?? 'sem código'})`
                : job.lastStatus === 'ok'
                  ? 'ok'
                  : '—',
            job.lastCount ?? '—',
            job.lastDurationMs === null ? '—' : `${(job.lastDurationMs / 1000).toFixed(1)} s`,
            formatWhen(job.lastFinishedAt),
          ])}
          empty="Nenhuma execução registrada."
        />
      </section>

      <section aria-labelledby="webhooks-titulo" className="mb-10 grid gap-4">
        <h2 id="webhooks-titulo" className="text-xl font-semibold">
          Webhooks recebidos
        </h2>
        <DataTable
          caption="Atividade dos webhooks por provedor"
          headers={['Provedor', 'Último evento', 'A processar', 'Com problema']}
          rows={snapshot.inbox.map((provider) => [
            provider.provider,
            formatWhen(provider.lastReceivedAt),
            provider.pending,
            provider.problems,
          ])}
          empty="Nenhum evento recebido."
        />
      </section>

      <section aria-labelledby="email-titulo" className="mb-10 grid gap-4">
        <h2 id="email-titulo" className="text-xl font-semibold">
          E-mail
        </h2>
        <h3 className="font-medium">Cota do provedor (plano gratuito)</h3>
        <Quota snapshot={snapshot} />
        <p>
          Endereços suprimidos (bounce permanente ou reclamação): {snapshot.suppressedRecipients}.
        </p>
        <DataTable
          caption="Mensagens de e-mail por estado"
          headers={['Estado', 'Mensagens']}
          rows={snapshot.email.map((row) => [label(row.state), row.count])}
          empty="Nenhum e-mail registrado."
        />
      </section>
    </>
  );
}
