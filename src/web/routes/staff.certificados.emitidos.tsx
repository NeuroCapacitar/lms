import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import {
  REVOCATION_CATEGORIES,
  REVOCATION_LABELS,
  type RevocationCategory,
  type StaffCertificateDto,
} from '../../features/certificate/lifecycle';
import type { ActionOutcome } from '../api/action';
import {
  fetchStaffCertificates,
  reissueCertificate,
  retryCertificate,
  revokeCertificate,
} from '../api/certificate-lifecycle';
import { ForbiddenError } from '../api/staff';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/staff/certificados/emitidos')({
  component: StaffIssuedCertificates,
});

const STATUS_TEXT: Record<string, string> = {
  awaiting_name: 'Aguardando o nome',
  queued: 'Na fila',
  rendering: 'Gerando',
  ready: 'Pronto',
  failed: 'Falhou',
  revoked: 'Revogado',
  superseded: 'Substituído',
};

const FAILURES: Record<string, string> = {
  reauth_required:
    'Para revogar, confirme sua identidade de novo (link por e-mail) e tente em seguida.',
  forbidden: 'Você não tem permissão para esta ação.',
  invalid_request: 'Confira os campos: o motivo precisa ter ao menos 5 caracteres.',
  not_ready: 'Só um certificado pronto pode ser revogado.',
  not_reissuable: 'Só o certificado mais recente (pronto ou revogado) pode ser reemitido.',
  no_template: 'O curso não tem template publicado.',
  invalid_snapshot: 'Algum dado não cabe no certificado (por exemplo, um nome grande demais).',
  conflict: 'Outra reemissão aconteceu ao mesmo tempo. Atualize a lista.',
  not_failed: 'Só um certificado que falhou pode ser repetido.',
  not_found: 'O certificado não existe mais.',
};

function failureText(outcome: ActionOutcome<unknown>): string {
  if (outcome.result === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
  return (outcome.code ? FAILURES[outcome.code] : undefined) ?? 'Não foi possível concluir agora.';
}

type Message = { kind: 'ok' | 'error'; text: string } | undefined;

/**
 * Certificados emitidos (M7-04), para a Staff. Revogar é só do Admin (com reautenticação recente, categoria e nota
 * interna); reemitir exige o grant e um motivo; "tentar de novo" é da fila operacional. O reembolso NÃO revoga: a
 * data do reembolso aparece junto do certificado para a Staff decidir.
 */
function StaffIssuedCertificates() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['staff-certificates'],
    queryFn: fetchStaffCertificates,
    retry: false,
  });
  const [message, setMessage] = useState<Message>();

  async function run(work: () => Promise<ActionOutcome<unknown>>, ok: string) {
    setMessage(undefined);
    const outcome = await work();
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: ok });
      await queryClient.invalidateQueries({ queryKey: ['staff-certificates'] });
      return true;
    }
    setMessage({ kind: 'error', text: failureText(outcome) });
    return false;
  }

  return (
    <>
      <p className="mb-2">
        <Link to="/staff/certificados" className="underline">
          Voltar aos certificados
        </Link>
      </p>
      <h1 className="mb-2 text-3xl font-semibold">Certificados emitidos</h1>
      <p className="mb-6 max-w-prose text-[var(--text-muted)]">
        Revogar só vale para um certificado pronto e é do Admin. Reemitir cria um certificado novo
        com o nome e o template de hoje; o antigo deixa de valer e o PDF dele não é corrigido.
      </p>
      {message ? (
        message.kind === 'ok' ? (
          <p role="status" className="mb-4 font-medium">
            {message.text}
          </p>
        ) : (
          <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
            {message.text}
          </p>
        )
      ) : null}
      {list.error instanceof ForbiddenError ? (
        <p role="alert">Você não tem permissão para ver os certificados.</p>
      ) : list.isPending ? (
        <p role="status">Carregando…</p>
      ) : list.isError ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível carregar a lista.
        </p>
      ) : list.data.length === 0 ? (
        <p>Nenhum certificado emitido ainda.</p>
      ) : (
        <ul className="grid gap-4" aria-label="Certificados">
          {list.data.map((item) => (
            <Row key={item.id} item={item} run={run} />
          ))}
        </ul>
      )}
    </>
  );
}

function Row({
  item,
  run,
}: {
  item: StaffCertificateDto;
  run: (work: () => Promise<ActionOutcome<unknown>>, ok: string) => Promise<boolean>;
}) {
  const [panel, setPanel] = useState<'revoke' | 'reissue' | null>(null);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<RevocationCategory>('wrong_data');
  const reissuable = (item.status === 'ready' || item.status === 'revoked') && !item.hasSuccessor;

  async function submit() {
    const done =
      panel === 'revoke'
        ? await run(() => revokeCertificate(item.id, category, text), 'Certificado revogado.')
        : await run(() => reissueCertificate(item.id, text), 'Certificado reemitido.');
    if (done) {
      setPanel(null);
      setText('');
    }
  }

  return (
    <li
      aria-label={`${item.holderName}, ${item.courseTitle}`}
      className="grid gap-2 rounded-lg border p-4"
    >
      <p className="font-medium">
        {item.holderName} <span className="font-normal">({item.holderEmail})</span>
      </p>
      <p>
        {item.courseTitle} · {STATUS_TEXT[item.status] ?? item.status}
        {item.status === 'failed' && item.failureCode ? ` (${item.failureCode})` : ''}
        {item.hasSuccessor ? ' · já reemitido' : ''}
      </p>
      {item.revokedAt && item.revocationCategory ? (
        <p className="text-sm text-[var(--text-muted)]">
          Revogado: {REVOCATION_LABELS[item.revocationCategory]}
        </p>
      ) : null}
      {item.refundedAt ? (
        <p className="text-sm font-medium">
          Acesso reembolsado em {new Date(item.refundedAt).toLocaleDateString('pt-BR')} (o
          certificado continua válido até decisão da equipe).
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {item.status === 'ready' ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPanel(panel === 'revoke' ? null : 'revoke')}
          >
            Revogar
          </Button>
        ) : null}
        {reissuable ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPanel(panel === 'reissue' ? null : 'reissue')}
          >
            Reemitir
          </Button>
        ) : null}
        {item.status === 'failed' ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void run(() => retryCertificate(item.id), 'Nova tentativa pedida.')}
          >
            Tentar de novo
          </Button>
        ) : null}
      </div>
      {panel ? (
        <form
          className="grid max-w-md gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {panel === 'revoke' ? (
            <label className="grid gap-1">
              <span className="font-medium">Categoria</span>
              <select
                className="min-h-11 rounded-lg border px-3"
                value={category}
                onChange={(event) => setCategory(event.target.value as RevocationCategory)}
              >
                {REVOCATION_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {REVOCATION_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1">
            <span className="font-medium">
              {panel === 'revoke' ? 'Nota interna' : 'Motivo da reemissão'}
            </span>
            <textarea
              className="min-h-24 rounded-lg border p-3"
              value={text}
              maxLength={500}
              required
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div>
            <Button type="submit" disabled={text.trim().length < 5}>
              {panel === 'revoke' ? 'Confirmar a revogação' : 'Confirmar a reemissão'}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
