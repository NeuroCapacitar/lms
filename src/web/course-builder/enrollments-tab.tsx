import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { formatAccessDate } from '../../features/access/format';
import type { EnrolleeDto, EnrolleeStatus } from '../../features/access/manual-enrollment';
import {
  adjustGrant,
  fetchEnrollees,
  grantEnrollment,
  reinstateEnrollment,
  suspendEnrollment,
} from '../api/enrollments';
import { ForbiddenError } from '../api/http';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';
import { useAccess } from '../hooks/use-access';

const STATUS_LABELS: Record<EnrolleeStatus, string> = {
  active: 'Ativa',
  expired: 'Expirada',
  suspended: 'Suspensa',
  inactive: 'Sem acesso',
};

const ERRORS: Record<string, string> = {
  user_not_found:
    'Não há conta com este e-mail. A pessoa precisa se cadastrar antes (entrando uma vez pelo link de acesso).',
  course_not_found: 'Este curso não existe mais.',
  request_id_conflict: 'Este envio já foi usado para outra pessoa. Recarregue o formulário.',
  not_adjustable: 'Só a matrícula manual ainda ativa pode ter o prazo ajustado.',
  not_enrolled: 'Esta pessoa não tem matrícula neste curso.',
  invalid_request:
    'Confira os campos: o motivo tem de ter ao menos 3 letras e o prazo de 1 a 600 meses.',
};

type Message = { kind: 'ok' | 'error'; text: string };

/** Quem entrou por link de acesso pode estar sem nome: nesse caso a tela usa o e-mail. */
function nameOf(row: EnrolleeDto): string {
  return row.name.trim() || row.email;
}

function messageFor(outcome: { result: string; code?: string | undefined }): string {
  if (outcome.result === 'forbidden') return 'Você não tem permissão para esta ação.';
  if (outcome.result === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
  return ERRORS[outcome.code ?? ''] ?? 'Não foi possível concluir agora. Tente novamente.';
}

/** Chave de idempotência do envio: gerada na tela e trocada depois de cada sucesso. */
const newRequestId = () => crypto.randomUUID();

function GrantForm({ courseId, onDone }: { courseId: string; onDone: (text: string) => void }) {
  const [email, setEmail] = useState('');
  const [months, setMonths] = useState('12');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const outcome = await grantEnrollment({
      email,
      courseId,
      months: Number(months),
      reason,
      requestId,
    });
    setBusy(false);
    if (outcome.result === 'ok' && outcome.data) {
      const until = outcome.data.expiresAt
        ? ` Acesso até ${formatAccessDate(outcome.data.expiresAt)}.`
        : '';
      onDone(
        outcome.data.status === 'already_enrolled'
          ? 'Esta matrícula já tinha sido feita com este envio.'
          : `Pessoa matriculada.${until}`,
      );
      setEmail('');
      setReason('');
      setRequestId(newRequestId());
      return;
    }
    setError(messageFor(outcome));
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-label="Matricular pessoa"
      className="grid max-w-xl gap-4 rounded-lg border p-4"
    >
      <h3 className="text-lg font-semibold">Matricular pessoa</h3>
      <TextField
        label="E-mail da pessoa"
        description="A pessoa já precisa ter conta. A matrícula não cria usuário."
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <TextField
        label="Prazo (meses)"
        type="number"
        value={months}
        onChange={(event) => setMonths(event.target.value)}
        min={1}
        max={600}
        required
      />
      <TextField
        label="Motivo"
        description="Fica registrado na auditoria."
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
      />
      {error ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Matriculando…' : 'Matricular'}
        </Button>
      </div>
    </form>
  );
}

type RowAction = { userId: string; kind: 'suspend' | 'adjust' };

function RowForm({
  courseId,
  row,
  kind,
  onDone,
  onCancel,
}: {
  courseId: string;
  row: EnrolleeDto;
  kind: RowAction['kind'];
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [months, setMonths] = useState('12');
  const [requestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const outcome =
      kind === 'suspend'
        ? await suspendEnrollment(courseId, row.userId, reason)
        : await adjustGrant(row.manualGrant!.entitlementId, {
            months: Number(months),
            reason,
            requestId,
          });
    setBusy(false);
    if (outcome.result === 'ok') {
      onDone(
        kind === 'suspend'
          ? `Acesso de ${nameOf(row)} suspenso.`
          : `Prazo de ${nameOf(row)} ajustado.`,
      );
      return;
    }
    setError(messageFor(outcome));
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-label={
        kind === 'suspend' ? `Suspender ${nameOf(row)}` : `Ajustar prazo de ${nameOf(row)}`
      }
      className="grid max-w-xl gap-3"
    >
      {kind === 'adjust' ? (
        <TextField
          label="Novo prazo total (meses)"
          description="Contado a partir do início desta matrícula manual."
          type="number"
          value={months}
          onChange={(event) => setMonths(event.target.value)}
          min={1}
          max={600}
          required
        />
      ) : null}
      <TextField
        label="Motivo"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
      />
      {error ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {kind === 'suspend' ? 'Confirmar suspensão' : 'Confirmar ajuste'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Inscritos do curso (M3-06). Qualquer Staff vê a lista (nome, e-mail, situação, acesso até,
 * progresso). Quem tem `access.grant` matricula, suspende e reativa; quem tem
 * `enrollment.support_edit` ajusta o prazo de matrícula MANUAL. A tela só esconde o que a pessoa não
 * pode fazer: cada rota confere a capability no servidor.
 */
export function EnrollmentsTab({ courseId }: { courseId: string }) {
  const access = useAccess();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<RowAction | undefined>();
  const [message, setMessage] = useState<Message | undefined>();
  const [busyRow, setBusyRow] = useState<string | undefined>();
  const list = useQuery({
    queryKey: ['enrollees', courseId, page],
    queryFn: () => fetchEnrollees(courseId, page),
    retry: false,
  });
  const canGrant = access.has('access.grant');
  const canAdjust = access.has('enrollment.support_edit');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['enrollees', courseId] });
  const done = (text: string) => {
    setMessage({ kind: 'ok', text });
    setAction(undefined);
    void refresh();
  };

  async function reinstate(row: EnrolleeDto) {
    setBusyRow(row.userId);
    setMessage(undefined);
    const outcome = await reinstateEnrollment(courseId, row.userId);
    setBusyRow(undefined);
    if (outcome.result === 'ok') done(`Acesso de ${nameOf(row)} reativado.`);
    else setMessage({ kind: 'error', text: messageFor(outcome) });
  }

  if (list.error instanceof ForbiddenError) {
    return <p role="alert">Você não tem permissão para ver as pessoas inscritas.</p>;
  }
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="grid min-w-0 gap-8">
      {canGrant ? (
        <GrantForm
          courseId={courseId}
          onDone={(text) => {
            setMessage({ kind: 'ok', text });
            void refresh();
          }}
        />
      ) : null}

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

      <section aria-labelledby="inscritos-titulo" className="grid min-w-0 gap-4">
        <h2 id="inscritos-titulo" className="text-xl font-semibold">
          Pessoas inscritas {data ? `(${data.total})` : ''}
        </h2>
        {list.isPending ? <p role="status">Carregando as pessoas inscritas…</p> : null}
        {list.isError && !(list.error instanceof ForbiddenError) ? (
          <>
            <p role="alert" className="font-medium text-[var(--text-danger)]">
              Não foi possível carregar as pessoas inscritas agora.
            </p>
            <div>
              <Button type="button" variant="secondary" onClick={() => void list.refetch()}>
                Tentar novamente
              </Button>
            </div>
          </>
        ) : null}
        {data && data.items.length === 0 ? <p>Ninguém se inscreveu neste curso ainda.</p> : null}
        {data && data.items.length > 0 ? (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <caption className="sr-only">Pessoas inscritas neste curso</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-4">
                    Pessoa
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Situação
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Acesso até
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Progresso
                  </th>
                  <th scope="col" className="py-2">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <RowView
                    key={row.userId}
                    row={row}
                    courseId={courseId}
                    canGrant={canGrant}
                    canAdjust={canAdjust}
                    busy={busyRow === row.userId}
                    action={action?.userId === row.userId ? action.kind : undefined}
                    onAction={(kind) => setAction(kind ? { userId: row.userId, kind } : undefined)}
                    onReinstate={() => void reinstate(row)}
                    onDone={done}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data && pages > 1 ? (
          <nav
            aria-label="Páginas das pessoas inscritas"
            className="flex flex-wrap items-center gap-3"
          >
            <Button
              type="button"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <span>
              Página {page} de {pages}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </Button>
          </nav>
        ) : null}
      </section>
    </div>
  );
}

function RowView({
  row,
  courseId,
  canGrant,
  canAdjust,
  busy,
  action,
  onAction,
  onReinstate,
  onDone,
}: {
  row: EnrolleeDto;
  courseId: string;
  canGrant: boolean;
  canAdjust: boolean;
  busy: boolean;
  action: RowAction['kind'] | undefined;
  onAction: (kind: RowAction['kind'] | undefined) => void;
  onReinstate: () => void;
  onDone: (text: string) => void;
}) {
  return (
    <>
      <tr className="border-b align-top">
        <th scope="row" className="py-3 pr-4 font-normal">
          <span className="font-medium">{nameOf(row)}</span>
          <br />
          <span className="text-sm text-[var(--text-muted)]">{row.email}</span>
        </th>
        <td className="py-3 pr-4">
          {STATUS_LABELS[row.status]}
          {row.status === 'suspended' && row.suspendedReason ? (
            <span className="block text-sm text-[var(--text-muted)]">
              Motivo: {row.suspendedReason}
            </span>
          ) : null}
        </td>
        <td className="py-3 pr-4">{row.expiresAt ? formatAccessDate(row.expiresAt) : '—'}</td>
        <td className="py-3 pr-4">
          {row.progress.percent}% ({row.progress.completed}/{row.progress.total})
          {row.courseCompletedAt ? (
            <span className="block text-sm text-[var(--text-muted)]">
              Concluiu em {formatAccessDate(row.courseCompletedAt)}
            </span>
          ) : null}
        </td>
        <td className="py-3">
          <div className="flex flex-wrap gap-2">
            {canGrant && row.status !== 'suspended' ? (
              <Button type="button" variant="secondary" onClick={() => onAction('suspend')}>
                Suspender {nameOf(row)}
              </Button>
            ) : null}
            {canGrant && row.status === 'suspended' ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={onReinstate}>
                Reativar {nameOf(row)}
              </Button>
            ) : null}
            {canAdjust && row.manualGrant ? (
              <Button type="button" variant="secondary" onClick={() => onAction('adjust')}>
                Ajustar prazo de {nameOf(row)}
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
      {action ? (
        <tr className="border-b">
          <td colSpan={5} className="py-4">
            <RowForm
              courseId={courseId}
              row={row}
              kind={action}
              onDone={onDone}
              onCancel={() => onAction(undefined)}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}
