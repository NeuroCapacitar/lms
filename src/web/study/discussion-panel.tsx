import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';

import { MAX_BODY_LENGTH, type DiscussionPostDto } from '../../features/discussion/discussion';
import type { ActionOutcome } from '../api/action';
import {
  createDiscussionPost,
  deleteDiscussionPost,
  editDiscussionPost,
  fetchLessonDiscussion,
  reportDiscussionPost,
} from '../api/discussion';
import { ConfirmButton } from '../components/confirm-button';
import { Button } from '../components/ui/button';
import { TextArea } from '../components/ui/text-area';

const FAILURES: Record<string, string> = {
  rate_limited: 'Você enviou muitas mensagens ou denúncias em pouco tempo. Aguarde alguns minutos.',
  access_denied: 'Seu acesso a este curso não permite participar da discussão.',
  lesson_locked: 'Esta aula ainda não está liberada para a discussão.',
  not_author: 'Só quem escreveu a mensagem pode alterá-la.',
  post_not_editable: 'Esta mensagem não pode mais ser alterada.',
  parent_unavailable: 'A mensagem que você quer responder não está mais disponível.',
  already_reported: 'Você já denunciou esta mensagem.',
  own_post: 'Você não pode denunciar a própria mensagem.',
  invalid_request: `Confira o texto: de 1 a ${MAX_BODY_LENGTH} caracteres.`,
};

function failureText(outcome: ActionOutcome<unknown>): string {
  if (outcome.result === 'unavailable') {
    return 'Não foi possível enviar agora. Verifique a conexão e tente de novo.';
  }
  if (outcome.result === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
  return (
    (outcome.code ? FAILURES[outcome.code] : undefined) ??
    (outcome.result === 'invalid'
      ? FAILURES.invalid_request!
      : 'Não foi possível concluir agora. Tente novamente.')
  );
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Discussão da aula (M5-05): perguntas e respostas assíncronas, texto simples (sempre escapado, nunca HTML),
 * um nível de resposta. O servidor decide quem lê, escreve, edita, exclui e denuncia; aqui só se mostra e se
 * envia. Fixo acima do campo: o aviso de que é proibido incluir dados que identifiquem pacientes.
 */
export function DiscussionPanel({ lessonId }: { lessonId: string }) {
  const queryClient = useQueryClient();
  const discussion = useQuery({
    queryKey: ['discussion', lessonId],
    queryFn: () => fetchLessonDiscussion(lessonId),
    retry: false,
    staleTime: 10_000,
  });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['discussion', lessonId] });

  async function run(work: () => Promise<ActionOutcome<unknown>>, ok: string): Promise<boolean> {
    setMessage(undefined);
    const outcome = await work();
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: ok });
      await refresh();
      return true;
    }
    setMessage({ kind: 'error', text: failureText(outcome) });
    return false;
  }

  if (discussion.isPending) return <p role="status">Carregando a discussão…</p>;
  if (discussion.isError) {
    return (
      <section aria-labelledby="discussao-titulo" className="mb-10 grid max-w-prose gap-3">
        <h2 id="discussao-titulo" className="text-xl font-semibold">
          Discussão
        </h2>
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível carregar a discussão agora.
        </p>
        <div>
          <Button type="button" variant="secondary" onClick={() => void discussion.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </section>
    );
  }
  // Sem acesso à aula a tela da aula já explica; a discussão simplesmente não aparece.
  if (discussion.data.kind !== 'ok') return null;
  const { threads } = discussion.data.data;

  return (
    <section aria-labelledby="discussao-titulo" className="mb-10 grid max-w-prose gap-4">
      <h2 id="discussao-titulo" className="text-xl font-semibold">
        Discussão
      </h2>
      <p className="rounded-lg border p-3 text-sm" id="discussao-aviso">
        É proibido incluir dados que identifiquem pacientes (nome, contato, documento ou qualquer
        informação que permita reconhecê-los). Mensagens assim são ocultadas.
      </p>
      <PostForm
        label="Escreva sua pergunta"
        submit="Publicar pergunta"
        onSubmit={(body) => run(() => createDiscussionPost(lessonId, body), 'Pergunta publicada.')}
      />
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
      {threads.length === 0 ? (
        <p className="text-[var(--text-muted)]">Ainda não há mensagens nesta aula.</p>
      ) : (
        <ul className="grid gap-4" aria-label="Conversas da aula">
          {threads.map((thread) => (
            <li key={thread.post.id} className="grid gap-3 rounded-lg border p-4">
              <Message lessonId={lessonId} post={thread.post} run={run} />
              {thread.replies.length > 0 ? (
                <ul className="grid gap-3 border-l-2 pl-4" aria-label="Respostas">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <Message lessonId={lessonId} post={reply} run={run} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <ReplyBox lessonId={lessonId} parent={thread.post} run={run} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Run = (work: () => Promise<ActionOutcome<unknown>>, ok: string) => Promise<boolean>;

function PostForm({
  label,
  submit,
  initial = '',
  onSubmit,
  onCancel,
}: {
  label: string;
  submit: string;
  initial?: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const id = useId();

  async function send(event: FormEvent) {
    event.preventDefault();
    if (body.trim() === '') return;
    setBusy(true);
    const done = await onSubmit(body);
    setBusy(false);
    if (done) setBody('');
  }

  return (
    <form onSubmit={send} noValidate className="grid gap-3">
      <TextArea
        id={id}
        label={label}
        value={body}
        maxLength={MAX_BODY_LENGTH}
        onChange={(event) => setBody(event.target.value)}
        description={`${body.length} de ${MAX_BODY_LENGTH} caracteres. Texto simples.`}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || body.trim() === ''}>
          {busy ? 'Enviando…' : submit}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Message({ lessonId, post, run }: { lessonId: string; post: DiscussionPostDto; run: Run }) {
  const [editing, setEditing] = useState(false);
  const when = dateFormat.format(new Date(post.createdAt));
  if (post.body === null) {
    return (
      <p className="text-[var(--text-muted)]">
        {post.placeholder === 'hidden' ? 'Mensagem removida pela moderação.' : 'Mensagem excluída.'}
      </p>
    );
  }
  return (
    <article className="grid gap-2" aria-label={`Mensagem de ${post.authorName}`}>
      <header className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold">{post.authorName}</span>
        {post.authorRole === 'staff' ? (
          <span className="rounded border px-1.5 text-xs font-medium">Equipe</span>
        ) : null}
        <time dateTime={post.createdAt} className="text-[var(--text-muted)]">
          {when}
        </time>
        {post.editedAt ? <span className="text-[var(--text-muted)]">(editada)</span> : null}
      </header>
      {editing ? (
        <PostForm
          label={`Editar a mensagem de ${post.authorName}`}
          submit="Salvar alteração"
          initial={post.body}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const done = await run(
              () => editDiscussionPost(lessonId, post.id, body),
              'Mensagem alterada.',
            );
            if (done) setEditing(false);
            return done;
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words">{post.body}</p>
      )}
      {!editing ? (
        <div className="flex flex-wrap gap-2">
          {post.mine ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                Editar a mensagem de {post.authorName}
              </Button>
              <ConfirmButton
                label={`Excluir a mensagem de ${post.authorName}`}
                confirmLabel="Confirmar exclusão"
                disabled={false}
                onConfirm={() =>
                  void run(() => deleteDiscussionPost(lessonId, post.id), 'Mensagem excluída.')
                }
              />
            </>
          ) : (
            <ConfirmButton
              label={`Denunciar a mensagem de ${post.authorName}`}
              confirmLabel="Confirmar denúncia"
              disabled={false}
              onConfirm={() =>
                void run(
                  () => reportDiscussionPost(lessonId, post.id),
                  'Denúncia enviada à equipe. Obrigado.',
                )
              }
            />
          )}
        </div>
      ) : null}
    </article>
  );
}

function ReplyBox({
  lessonId,
  parent,
  run,
}: {
  lessonId: string;
  parent: DiscussionPostDto;
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  // Só se responde a mensagem que ainda existe na conversa.
  if (parent.body === null) return null;
  if (!open) {
    return (
      <div>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Responder a {parent.authorName}
        </Button>
      </div>
    );
  }
  return (
    <PostForm
      label={`Sua resposta a ${parent.authorName}`}
      submit="Publicar resposta"
      onCancel={() => setOpen(false)}
      onSubmit={async (body) => {
        const done = await run(
          () => createDiscussionPost(lessonId, body, parent.id),
          'Resposta publicada.',
        );
        if (done) setOpen(false);
        return done;
      }}
    />
  );
}
