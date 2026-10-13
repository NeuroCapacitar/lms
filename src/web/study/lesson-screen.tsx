import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { completeLesson, fetchLesson, fetchPreviewLesson } from '../api/learning';
import { fetchProfile } from '../api/profile';
import { RichTextView } from '../components/rich-text/rich-text-view';
import { StudyNotice, lockMessage } from '../components/study-notice';
import { Button } from '../components/ui/button';
import { VideoPlayer } from '../video/video-player';
import { LessonLink, OutlineLink, PreviewBanner, type StudyMode } from './study-links';

/**
 * Aula (M3-03), usada pelo aluno e pela prévia da Staff (M3-07). O conteúdo só chega se o servidor
 * liberou a aula; bloqueada, a resposta traz só o motivo (e a data do drip). Anterior e próxima levam
 * às aulas vizinhas. Na prévia há a faixa fixa e o "Concluir aula" fica DESABILITADO (e o servidor não
 * tem rota de escrita para a prévia).
 */
export function LessonScreen({ mode, lessonId }: { mode: StudyMode; lessonId: string }) {
  const { courseId, preview } = mode;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Preferência de autoavanço (M5-02): padrão DESLIGADA; só o aluno a lê (a prévia nunca avança sozinha).
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
    retry: false,
    enabled: !preview,
    staleTime: 60_000,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const lesson = useQuery({
    queryKey: [preview ? 'preview-lesson' : 'lesson', lessonId],
    queryFn: () => (preview ? fetchPreviewLesson(courseId, lessonId) : fetchLesson(lessonId)),
    retry: false,
    staleTime: 10_000,
  });

  const back = (
    <p className="mb-4">
      <OutlineLink mode={mode}>← Voltar ao curso</OutlineLink>
    </p>
  );
  const banner = preview ? <PreviewBanner /> : null;

  if (lesson.isPending) return <p role="status">Carregando a aula…</p>;
  if (lesson.isError) {
    return (
      <>
        {banner}
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
        {banner}
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
        {banner}
        {back}
        <h1 className="mb-4 text-3xl font-semibold">Aula</h1>
        <StudyNotice
          result={result}
          returnTo={
            preview
              ? `/staff/previa/${courseId}/aulas/${lessonId}`
              : `/estudar/${courseId}/aulas/${lessonId}`
          }
        />
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
      {banner}
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
      {current.kind === 'video' && current.video ? (
        <div className="mb-10 grid gap-3">
          <VideoPlayer
            key={current.id}
            lessonId={lessonId}
            video={current.video}
            preview={preview}
            autoAdvance={profile.data?.autoAdvance === true}
            next={next}
            onCompleted={(outcome) => {
              setMessage({
                kind: 'ok',
                text: outcome.courseJustCompleted
                  ? 'Aula concluída. Parabéns, você concluiu o curso!'
                  : 'Aula concluída.',
              });
              void Promise.all([
                queryClient.invalidateQueries({ queryKey: ['lesson', lessonId] }),
                queryClient.invalidateQueries({ queryKey: ['outline', courseId] }),
              ]);
            }}
            onNext={() => {
              if (!next) return;
              void navigate({
                to: '/estudar/$courseId/aulas/$lessonId',
                params: { courseId, lessonId: next.id },
              });
            }}
          />
          {completed && !preview ? (
            <p role="status" className="font-medium text-[var(--text-success)]">
              Aula concluída.
            </p>
          ) : null}
          {message ? (
            <p
              role={message.kind === 'ok' ? 'status' : 'alert'}
              className="font-medium text-[var(--text-success)]"
            >
              {message.text}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mb-10 grid max-w-prose gap-2">
          {preview ? (
            <>
              <div>
                <Button type="button" disabled aria-describedby="previa-concluir">
                  Concluir aula
                </Button>
              </div>
              <p id="previa-concluir" className="text-sm text-[var(--text-muted)]">
                Na prévia não é possível concluir aulas: nada é gravado.
              </p>
            </>
          ) : completed ? (
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
      )}
      <nav aria-label="Navegação entre aulas" className="flex flex-wrap justify-between gap-4">
        {previous ? (
          <LessonLink mode={mode} lessonId={previous.id}>
            ← {previous.title}
          </LessonLink>
        ) : (
          <span />
        )}
        {next ? (
          <LessonLink mode={mode} lessonId={next.id}>
            {next.title} →
          </LessonLink>
        ) : null}
      </nav>
    </>
  );
}
