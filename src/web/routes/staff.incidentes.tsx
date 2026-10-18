import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import {
  COMMUNICATIONS,
  COMMUNICATION_LABELS,
  DATA_KINDS,
  DATA_KIND_LABELS,
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABELS,
  RISK_ASSESSMENTS,
  RISK_LABELS,
  canTransition,
  type Communication,
  type DataKind,
  type IncidentCategory,
  type IncidentDto,
  type IncidentStatus,
  type RiskAssessment,
} from '../../features/privacy/incident';
import type { ActionOutcome } from '../api/action';
import { ForbiddenError } from '../api/http';
import { createIncident, fetchIncidents, updateIncident } from '../api/staff-incidents';
import { ReauthPanel } from '../components/reauth-panel';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';
import { TextArea } from '../components/ui/text-area';

export const Route = createFileRoute('/staff/incidentes')({ component: Incidents });

const MESSAGES: Record<string, string> = {
  personal_data_in_text:
    'O texto parece conter dado pessoal (e-mail, CPF, CNPJ, telefone ou link de acesso). Descreva o incidente sem identificar ninguém.',
  decision_required:
    'Para encerrar, registre antes a avaliação do risco e a decisão sobre a comunicação.',
  communicated_at_required: 'Informe quando a comunicação foi feita.',
  invalid_transition: 'O incidente não pode voltar a uma etapa anterior.',
  incident_closed: 'Este incidente está encerrado e não pode mais ser alterado.',
  not_found: 'Não encontramos o incidente. Atualize a página.',
  invalid_request: 'Confira os campos: algum valor está fora do permitido.',
};

const GENERIC: Record<string, string> = {
  unauthenticated: 'Sua sessão expirou. Entre novamente.',
  forbidden: 'Você não tem permissão para esta ação.',
  rate_limited: 'Muitos pedidos. Aguarde um pouco.',
  unavailable: 'Não foi possível concluir agora. Tente novamente em instantes.',
};

function failureText(outcome: ActionOutcome<unknown>): string {
  return (
    (outcome.code ? MESSAGES[outcome.code] : undefined) ??
    GENERIC[outcome.result] ??
    MESSAGES.invalid_request!
  );
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const formatWhen = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');
/** `datetime-local` (hora do navegador) para ISO com fuso; vazio vira `null`. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

const selectClass = 'min-h-11 rounded-lg border bg-[var(--input-bg)] px-2 text-[var(--input-fg)]';

function Incidents() {
  const queryClient = useQueryClient();
  const incidents = useQuery({ queryKey: ['incidents'], queryFn: fetchIncidents, retry: false });
  const [needsReauth, setNeedsReauth] = useState<string | undefined>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();

  /** Roda uma ação e traduz o resultado em aviso; devolve `true` quando deu certo. */
  async function run(action: () => Promise<ActionOutcome<unknown>>, ok: string, reauthFor: string) {
    setMessage(undefined);
    const outcome = await action();
    if (outcome.result === 'reauth_required') {
      setNeedsReauth(reauthFor);
      return false;
    }
    setNeedsReauth(undefined);
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: ok });
      await queryClient.invalidateQueries({ queryKey: ['incidents'] });
      return true;
    }
    setMessage({ kind: 'error', text: failureText(outcome) });
    return false;
  }

  if (incidents.isPending) return <p role="status">Carregando…</p>;
  if (incidents.error instanceof ForbiddenError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Incidentes com dados pessoais</h1>
        <p role="alert">Você não tem permissão para ver esta área.</p>
      </>
    );
  }
  if (incidents.isError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Incidentes com dados pessoais</h1>
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar os incidentes agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void incidents.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Incidentes com dados pessoais</h1>
      <div className="mb-6 grid max-w-prose gap-2 text-[var(--text-muted)]">
        <p>
          Este é o <strong>registro</strong> do que houve e do que foi decidido. Ele não comunica
          ninguém: a decisão de avisar a ANPD e as pessoas afetadas é do responsável, com o
          advogado.
        </p>
        <p>
          <strong>Não escreva dado pessoal de quem foi afetado</strong> (nome, e-mail, CPF,
          telefone). Descreva o que aconteceu e quantas pessoas foram atingidas. Todo incidente fica
          registrado, comunicado ou não, e <strong>não pode ser apagado</strong>. Encerrado, não
          muda mais.
        </p>
      </div>

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

      <NewIncidentForm
        onSubmit={(incident) =>
          run(() => createIncident(incident), 'Incidente registrado.', 'registrar o incidente')
        }
      />

      <section aria-labelledby="registrados-titulo" className="mt-10 grid gap-6">
        <h2 id="registrados-titulo" className="text-xl font-semibold">
          Incidentes registrados
        </h2>
        {incidents.data.length === 0 ? (
          <p className="text-[var(--text-muted)]">Nenhum incidente registrado.</p>
        ) : (
          incidents.data.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              onSave={(patch) =>
                run(
                  () => updateIncident(incident.id, patch),
                  'Incidente atualizado.',
                  'atualizar o incidente',
                )
              }
            />
          ))
        )}
      </section>
    </>
  );
}

function DataKindsField({
  value,
  onChange,
  legend,
}: {
  value: DataKind[];
  onChange: (next: DataKind[]) => void;
  legend: string;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="font-medium text-[var(--field-label)]">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {DATA_KINDS.map((kind) => (
          <label key={kind} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={value.includes(kind)}
              onChange={(event) =>
                onChange(event.target.checked ? [...value, kind] : value.filter((k) => k !== kind))
              }
            />
            {DATA_KIND_LABELS[kind]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NewIncidentForm({
  onSubmit,
}: {
  onSubmit: (incident: NewIncidentArg) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IncidentCategory>('exposure');
  const [dataKinds, setDataKinds] = useState<DataKind[]>([]);
  const [affected, setAffected] = useState('');
  const [detectedAt, setDetectedAt] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [actions, setActions] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const detected = toIso(detectedAt);
    const ok = await onSubmit({
      title,
      description,
      category,
      dataKinds,
      affectedCount: affected === '' ? null : Number(affected),
      ...(detected ? { detectedAt: detected } : {}),
      occurredAt: toIso(occurredAt),
      actionsTaken: actions,
    });
    setBusy(false);
    if (ok) {
      setTitle('');
      setDescription('');
      setCategory('exposure');
      setDataKinds([]);
      setAffected('');
      setDetectedAt('');
      setOccurredAt('');
      setActions('');
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid max-w-2xl gap-4">
      <h2 className="text-xl font-semibold">Registrar um incidente</h2>
      <TextField
        label="Título"
        value={title}
        maxLength={120}
        required
        onChange={(event) => setTitle(event.target.value)}
      />
      <TextArea
        id="incidente-descricao"
        label="O que aconteceu"
        description="Sem nomes, e-mails, CPF ou telefones de pessoas afetadas."
        value={description}
        maxLength={2000}
        required
        onChange={(event) => setDescription(event.target.value)}
      />
      <label className="grid gap-1.5">
        <span className="font-medium text-[var(--field-label)]">Tipo</span>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as IncidentCategory)}
          className={selectClass}
        >
          {INCIDENT_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {INCIDENT_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <DataKindsField
        legend="Quais dados foram atingidos"
        value={dataKinds}
        onChange={setDataKinds}
      />
      <TextField
        label="Quantas pessoas (estimativa)"
        type="number"
        min={0}
        value={affected}
        onChange={(event) => setAffected(event.target.value)}
      />
      <TextField
        label="Quando foi descoberto"
        description="Deixe vazio para usar agora."
        type="datetime-local"
        value={detectedAt}
        onChange={(event) => setDetectedAt(event.target.value)}
      />
      <TextField
        label="Quando começou (estimativa)"
        type="datetime-local"
        value={occurredAt}
        onChange={(event) => setOccurredAt(event.target.value)}
      />
      <TextArea
        id="incidente-acoes"
        label="O que já foi feito"
        value={actions}
        maxLength={2000}
        onChange={(event) => setActions(event.target.value)}
      />
      <div>
        <Button type="submit" disabled={busy}>
          Registrar incidente
        </Button>
      </div>
    </form>
  );
}
type NewIncidentArg = Parameters<typeof createIncident>[0];

function IncidentCard({
  incident,
  onSave,
}: {
  incident: IncidentDto;
  onSave: (patch: Parameters<typeof updateIncident>[1]) => Promise<boolean>;
}) {
  const closed = incident.status === 'closed';
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [risk, setRisk] = useState<RiskAssessment>(incident.riskAssessment);
  const [communication, setCommunication] = useState<Communication>(incident.communication);
  const [communicatedAt, setCommunicatedAt] = useState('');
  const [affected, setAffected] = useState(incident.affectedCount?.toString() ?? '');
  const [dataKinds, setDataKinds] = useState<DataKind[]>(incident.dataKinds);
  const [actions, setActions] = useState(incident.actionsTaken ?? '');
  const [busy, setBusy] = useState(false);
  const id = `incidente-${incident.id}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await onSave({
      status,
      riskAssessment: risk,
      communication,
      ...(communication === 'communicated' && communicatedAt
        ? { communicatedAt: toIso(communicatedAt) }
        : {}),
      affectedCount: affected === '' ? null : Number(affected),
      dataKinds,
      actionsTaken: actions,
    });
    setBusy(false);
  }

  return (
    <article
      aria-labelledby={`${id}-titulo`}
      className="grid max-w-2xl gap-3 rounded-lg border p-4"
    >
      <h3 id={`${id}-titulo`} className="text-lg font-semibold">
        {incident.title}
      </h3>
      <p>
        <strong>{INCIDENT_STATUS_LABELS[incident.status]}</strong> ·{' '}
        {INCIDENT_CATEGORY_LABELS[incident.category]} · {RISK_LABELS[incident.riskAssessment]} ·{' '}
        {COMMUNICATION_LABELS[incident.communication]}
      </p>
      <p>{incident.description}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Descoberto em</dt>
        <dd>{formatWhen(incident.detectedAt)}</dd>
        <dt className="font-medium">Começou (estimativa)</dt>
        <dd>{formatWhen(incident.occurredAt)}</dd>
        <dt className="font-medium">Pessoas (estimativa)</dt>
        <dd>{incident.affectedCount ?? '—'}</dd>
        <dt className="font-medium">Dados atingidos</dt>
        <dd>
          {incident.dataKinds.length === 0
            ? '—'
            : incident.dataKinds.map((kind) => DATA_KIND_LABELS[kind]).join(', ')}
        </dd>
        <dt className="font-medium">Comunicado em</dt>
        <dd>{formatWhen(incident.communicatedAt)}</dd>
        <dt className="font-medium">Contido em</dt>
        <dd>{formatWhen(incident.containedAt)}</dd>
        <dt className="font-medium">Encerrado em</dt>
        <dd>{formatWhen(incident.closedAt)}</dd>
      </dl>
      {incident.actionsTaken ? <p>O que foi feito: {incident.actionsTaken}</p> : null}

      {closed ? (
        <p className="text-[var(--text-muted)]">Encerrado: este registro não muda mais.</p>
      ) : (
        <form onSubmit={(event) => void save(event)} className="grid gap-3 border-t pt-3">
          <h4 className="font-semibold">Atualizar</h4>
          <label className="grid gap-1.5">
            <span className="font-medium text-[var(--field-label)]">Etapa ({incident.title})</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as IncidentStatus)}
              className={selectClass}
            >
              {INCIDENT_STATUSES.filter((value) => canTransition(incident.status, value)).map(
                (value) => (
                  <option key={value} value={value}>
                    {INCIDENT_STATUS_LABELS[value]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="font-medium text-[var(--field-label)]">Risco ({incident.title})</span>
            <select
              value={risk}
              onChange={(event) => setRisk(event.target.value as RiskAssessment)}
              className={selectClass}
            >
              {RISK_ASSESSMENTS.map((value) => (
                <option key={value} value={value}>
                  {RISK_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="font-medium text-[var(--field-label)]">
              Comunicação ({incident.title})
            </span>
            <select
              value={communication}
              onChange={(event) => setCommunication(event.target.value as Communication)}
              className={selectClass}
            >
              {COMMUNICATIONS.map((value) => (
                <option key={value} value={value}>
                  {COMMUNICATION_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          {communication === 'communicated' ? (
            <TextField
              label={`Comunicado em (${incident.title})`}
              type="datetime-local"
              value={communicatedAt}
              onChange={(event) => setCommunicatedAt(event.target.value)}
            />
          ) : null}
          <TextField
            label={`Pessoas, estimativa (${incident.title})`}
            type="number"
            min={0}
            value={affected}
            onChange={(event) => setAffected(event.target.value)}
          />
          <DataKindsField
            legend={`Dados atingidos (${incident.title})`}
            value={dataKinds}
            onChange={setDataKinds}
          />
          <TextArea
            id={`${id}-acoes`}
            label={`O que já foi feito (${incident.title})`}
            value={actions}
            maxLength={2000}
            onChange={(event) => setActions(event.target.value)}
          />
          <div>
            <Button type="submit" disabled={busy}>
              Salvar alterações
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}
