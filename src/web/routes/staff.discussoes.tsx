import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import type { StaffDiscussionItemDto } from '../../features/discussion/discussion';
import type { ActionOutcome } from '../api/action';
import {
  dismissDiscussionReports,
  fetchStaffDiscussions,
  moderateDiscussionPost,
  staffReplyToPost,
  type StaffDiscussionView,
} from '../api/discussion';
import { ForbiddenError } from '../api/http';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';
import { TextArea } from '../components/ui/text-area';

export const Route = createFileRoute('/staff/discussoes')({ component: StaffDiscussions });

const STATE_LABELS = { visible: 'Visível', hidden: 'Oculta', deleted: 'Excluída' } as const;
const VIEWS: { value: StaffDiscussionView; label: string }[] = [
  { value: 'reported', label: 'Denunciadas' },
  { value: 'unanswered', label: 'Sem resposta da equipe' },
];
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const FAILURES: Record<string, string> = {
  invalid_transition: 'Esta ação não vale para o estado atual da mensagem. Atualize a lista.',
  no_open_reports: 'Não há denúncia aberta nesta mensagem. Atualize a lista.',
  not_found: 'A mensagem não existe mais. Atualize a lista.',
  parent_unavailable: 'A pergunta não está mais disponível para resposta. Atualize a lista.',
  forbidden: 'Você não tem a permissão de moderar discussões.',
  invalid_request: 'Confira os campos: o motivo precisa de pelo menos 3 caracteres.',
};

function failureText(outcome: ActionOutcome<unknown>): string {
  if (outcome.result === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
  return (
    (outcome.code ? FAILURES[outcome.code] : undefined) ??
    (outcome.result === 'invalid' ? FAILURES.invalid_request! : 'Não foi possível concluir agora.')
  );
}

/**
 * Moderação das discussões (M5-05), só com o grant `discussion.moderate`. A fila mostra o texto COMPLETO e o
 * contexto da aula; ocultar, restaurar e excluir pedem MOTIVO (auditado). A equipe responde de dentro da
 * fila. O servidor decide cada ação; esta tela só envia.
 */
function StaffDiscussions() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<StaffDiscussionView>('reported');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const items = useQuery({
    queryKey: ['staff-discussions', view],
    queryFn: () => fetchStaffDiscussions(view),
    retry: false,
  });

  async function run(work: () => Promise<ActionOutcome<unknown>>, ok: string): Promise<boolean> {
    setMessage(undefined);
    const outcome = await work();
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: ok });
      await queryClient.invalidateQueries({ queryKey: ['staff-discussions'] });
      return true;
    }
    setMessage({ kind: 'error', text: failureText(outcome) });
    return false;
  }

  if (items.error instanceof ForbiddenError) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Discussões</h1>
        <p role="alert">Você não tem a permissão de moderar discussões.</p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Discussões</h1>
      <p className="mb-6 max-w-prose text-[var(--text-muted)]">
        Perguntas das pessoas inscritas nas aulas. Ocultar, restaurar e excluir pedem um motivo e
        ficam na auditoria. O nome mostrado é o do perfil, nunca o e-mail.
      </p>
      <div role="group" aria-label="Lista" className="mb-6 flex flex-wrap gap-2">
        {VIEWS.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={view === option.value ? 'primary' : 'secondary'}
            aria-pressed={view === option.value}
            onClick={() => {
              setView(option.value);
              setMessage(undefined);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {message ? (
        <p
          role={message.kind === 'ok' ? 'status' : 'alert'}
          className={
            message.kind === 'ok'
              ? 'mb-4 font-medium text-[var(--text-success)]'
              : 'mb-4 font-medium text-[var(--text-danger)]'
          }
        >
          {message.text}
        </p>
      ) : null}
      {items.isPending ? (
        <p role="status">Carregando…</p>
      ) : items.isError ? (
        <>
          <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
            Não foi possível carregar a lista agora.
          </p>
          <Button type="button" variant="secondary" onClick={() => void items.refetch()}>
            Tentar novamente
          </Button>
        </>
      ) : items.data.length === 0 ? (
        <p className="text-[var(--text-muted)]">
          {view === 'reported' ? 'Nenhuma denúncia aberta.' : 'Nenhuma pergunta sem resposta.'}
        </p>
      ) : (
        <ul className="grid gap-4" aria-label="Mensagens">
          {items.data.map((item) => (
            <li key={item.id}>
              <Item item={item} run={run} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Item({
  item,
  run,
}: {
  item: StaffDiscussionItemDto;
  run: (work: () => Promise<ActionOutcome<unknown>>, ok: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const who = `${item.authorName}, ${dateFormat.format(new Date(item.createdAt))}`;
  const canReply = !item.isReply && item.state === 'visible';

  async function moderate(action: 'hide' | 'restore' | 'delete', ok: string) {
    if (await run(() => moderateDiscussionPost(item.id, action, reason), ok)) setReason('');
  }

  return (
    <article className="grid gap-3 rounded-lg border p-4" aria-label={`Mensagem de ${who}`}>
      <p className="text-sm text-[var(--text-muted)]">
        {item.courseTitle} › {item.lessonTitle}
      </p>
      <header className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold">{item.authorName}</span>
        {item.authorRole === 'staff' ? (
          <span className="rounded border px-1.5 text-xs font-medium">Equipe</span>
        ) : null}
        <span className="text-[var(--text-muted)]">
          {dateFormat.format(new Date(item.createdAt))}
        </span>
        <span className="rounded border px-1.5 text-xs font-medium">
          {STATE_LABELS[item.state]}
        </span>
        {item.isReply ? <span className="text-[var(--text-muted)]">(resposta)</span> : null}
        {item.openReports > 0 ? (
          <span className="font-medium text-[var(--text-danger)]">
            {item.openReports} {item.openReports === 1 ? 'denúncia aberta' : 'denúncias abertas'}
          </span>
        ) : null}
      </header>
      <p className="whitespace-pre-wrap break-words">{item.body}</p>

      <TextField
        label={`Motivo da moderação (mensagem de ${who})`}
        description="Obrigatório para ocultar, restaurar ou excluir. Vai para a auditoria."
        value={reason}
        maxLength={300}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {item.state === 'visible' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={reason.trim().length < 3}
            onClick={() => void moderate('hide', 'Mensagem ocultada.')}
          >
            Ocultar a mensagem de {who}
          </Button>
        ) : null}
        {item.state === 'hidden' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={reason.trim().length < 3}
            onClick={() => void moderate('restore', 'Mensagem restaurada.')}
          >
            Restaurar a mensagem de {who}
          </Button>
        ) : null}
        {item.state !== 'deleted' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={reason.trim().length < 3}
            onClick={() => void moderate('delete', 'Mensagem excluída.')}
          >
            Excluir a mensagem de {who}
          </Button>
        ) : null}
        {item.openReports > 0 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void run(
                () => dismissDiscussionReports(item.id, reason.trim() || undefined),
                'Denúncias descartadas.',
              )
            }
          >
            Descartar as denúncias de {who}
          </Button>
        ) : null}
        {canReply && !replying ? (
          <Button type="button" onClick={() => setReplying(true)}>
            Responder a {who}
          </Button>
        ) : null}
      </div>
      {replying ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => staffReplyToPost(item.id, reply), 'Resposta publicada.').then((done) => {
              if (done) {
                setReply('');
                setReplying(false);
              }
            });
          }}
        >
          <TextArea
            id={`resposta-${item.id}`}
            label={`Resposta da equipe a ${who}`}
            value={reply}
            maxLength={2000}
            onChange={(event) => setReply(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={reply.trim() === ''}>
              Publicar resposta da equipe
            </Button>
            <Button type="button" variant="secondary" onClick={() => setReplying(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}
    </article>
  );
}
