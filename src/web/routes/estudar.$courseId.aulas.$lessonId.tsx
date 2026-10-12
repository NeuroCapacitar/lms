import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';

import { completeLesson, fetchLesson } from '../api/learning';
import { RequireTerms } from '../components/require-terms';
import { RichTextView } from '../components/rich-text/rich-text-view';
import { StudyNotice, lockMessage } from '../components/study-notice';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/estudar/$courseId/aulas/$lessonId')({
  component: () => (
    <RequireTerms>
      <Lesson />
    </RequireTerms>
  ),
});

/**
 * Aula (M3-03). O conteúdo só chega se o servidor liberou a aula; bloqueada, a resposta traz só o
 * motivo (e a data do drip) e esta tela mostra a mensagem. Anterior e próxima levam às aulas
 * vizinhas; abrir uma bloqueada mostra o motivo, sem conteúdo.
 */
function Lesson() {
  const { courseId, lessonId } = Route.useParams();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const lesson = useQuery({
    queryKey: ['lesson', lessonId],
    queryFn: () => fetchLesson(lessonId),
    retry: false,
    staleTime: 10_000,
  });

  const back = (
    <p className="mb-4">
      <Link to="/estudar/$courseId" params={{ courseId }}>
        ← Voltar ao curso
      </Link>
    </p>
  );

  if (lesson.isPending) return <p role="status">Carregando a aula…</p>;
  if (lesson.isError) {
    return (
      <>
        {back}
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar a aula agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void lesson.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }
  const result = lesson.data;
  if (result.kind === 'locked') {
    return (
      <>
        {back}
        <h1 className="mb-4 text-3xl font-semibold">Aula bloqueada</h1>
        <p role="status" className="max-w-prose">
          {lockMessage(result.reason, result.releasesAt)}
        </p>
      </>
    );
  }
  if (result.kind !== 'ok') {
    return (
      <>
        {back}
        <h1 className="mb-4 text-3xl font-semibold">Aula</h1>
        <StudyNotice result={result} returnTo={`/estudar/${courseId}/aulas/${lessonId}`} />
      </>
    );
  }

  const { course, lesson: current, previous, next, completed } = result.data;

  async function conclude() {
    setBusy(true);
    setMessage(undefined);
    const outcome = await completeLesson(lessonId);
    if (outcome.result === 'ok' && outcome.data) {
      setMessage({
        kind: 'ok',
        text: outcome.data.courseJustCompleted
          ? 'Aula concluída. Parabéns, você concluiu o curso!'
          : 'Aula concluída.',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lesson', lessonId] }),
        queryClient.invalidateQueries({ queryKey: ['outline', courseId] }),
      ]);
    } else {
      setMessage({
        kind: 'error',
        text:
          outcome.result === 'unauthenticated'
            ? 'Sua sessão expirou. Entre novamente.'
            : outcome.code === 'lesson_locked'
              ? 'Esta aula ainda não pode ser concluída.'
              : outcome.code === 'access_denied'
                ? 'Seu acesso a este curso não permite concluir a aula.'
                : 'Não foi possível concluir a aula agora. Tente novamente.',
      });
    }
    setBusy(false);
  }
  return (
    <>
      {back}
      <p className="mb-1 text-sm text-[var(--text-muted)]">{course.title}</p>
      <h1 className="mb-6 text-3xl font-semibold">
        {current.title}
        {current.isOptional ? (
          <span className="ml-2 text-base font-normal text-[var(--text-muted)]">(opcional)</span>
        ) : null}
      </h1>
      <article className="mb-8 max-w-prose">
        <RichTextView value={current.body} />
      </article>
      <div className="mb-10 grid max-w-prose gap-2">
        {completed ? (
          <p role="status" className="font-medium text-[var(--text-success)]">
            Aula concluída.
          </p>
        ) : (
          <div>
            <Button type="button" disabled={busy} onClick={() => void conclude()}>
              {busy ? 'Concluindo…' : 'Concluir aula'}
            </Button>
          </div>
        )}
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
      </div>
      <nav aria-label="Navegação entre aulas" className="flex flex-wrap justify-between gap-4">
        {previous ? (
          <Link
            to="/estudar/$courseId/aulas/$lessonId"
            params={{ courseId, lessonId: previous.id }}
          >
            ← {previous.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to="/estudar/$courseId/aulas/$lessonId" params={{ courseId, lessonId: next.id }}>
            {next.title} →
          </Link>
        ) : null}
      </nav>
    </>
  );
}
