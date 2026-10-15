import { useQuery } from '@tanstack/react-query';

import { formatAccessDate } from '../../features/access/format';
import type { OutlineLessonDto } from '../../features/access/outline';
import { fetchPreviewOutline } from '../api/learning';
import { OfflineNotice } from '../offline/offline-notice';
import { loadOutline } from '../offline/study';
import { StudyNotice, lockMessage } from '../components/study-notice';
import { Button } from '../components/ui/button';
import { LessonLink, PreviewBanner, type StudyMode } from './study-links';

function LessonRow({
  mode,
  lesson,
  offlineSaved,
}: {
  mode: StudyMode;
  lesson: OutlineLessonDto;
  /** Só sem rede: as aulas que existem guardadas no aparelho. */
  offlineSaved?: ReadonlySet<string>;
}) {
  const badges = [lesson.isOptional ? 'opcional' : null, lesson.completed ? 'concluída' : null]
    .filter(Boolean)
    .join(', ');
  const label = (
    <>
      {lesson.title}
      {badges ? (
        <>
          {' '}
          <span className="text-sm text-[var(--text-muted)]">({badges})</span>
        </>
      ) : null}
    </>
  );
  if (lesson.locked === null && offlineSaved && !offlineSaved.has(lesson.id)) {
    return (
      <span>
        {label} <span className="text-sm text-[var(--text-muted)]">— precisa de internet</span>
      </span>
    );
  }
  if (lesson.locked === null) {
    return (
      <LessonLink mode={mode} lessonId={lesson.id}>
        {label}
      </LessonLink>
    );
  }
  return (
    <span>
      {label}{' '}
      <span className="text-sm text-[var(--text-muted)]">
        — {lockMessage(lesson.locked, lesson.releasesAt)}
      </span>
    </span>
  );
}

/**
 * Mapa do curso (M3-03), usado pelo aluno e pela prévia da Staff (M3-07). Quem decide o que abre é o
 * servidor; aqui só se mostra: aula liberada é link, aula bloqueada é texto com o motivo e a data. Na
 * prévia há a faixa fixa e não há acesso, progresso nem conclusão (nada é gravado).
 */
export function OutlineScreen({ mode }: { mode: StudyMode }) {
  const { courseId, preview } = mode;
  const outline = useQuery({
    queryKey: [preview ? 'preview-outline' : 'outline', courseId],
    // Sem rede o navegador marca `navigator.onLine = false`: o padrão do React Query PAUSARIA a consulta e a tela ficaria
    // em "Carregando…". Aqui a consulta roda sempre: a falha de rede vira a leitura da cópia guardada (M8-02).
    networkMode: 'always',
    queryFn: () => (preview ? fetchPreviewOutline(courseId) : loadOutline(courseId)),
    retry: false,
    staleTime: 10_000,
  });

  if (outline.isPending) return <p role="status">Carregando o curso…</p>;
  if (outline.isError) {
    return (
      <>
        {preview ? <PreviewBanner /> : null}
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar o curso agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void outline.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }
  const result = outline.data;
  if (result.kind !== 'ok') {
    return (
      <>
        <h1 className="mb-4 text-3xl font-semibold">Curso</h1>
        <StudyNotice
          result={result}
          returnTo={preview ? `/staff/previa/${courseId}` : `/estudar/${courseId}`}
        />
      </>
    );
  }

  const { course, access, modules, progress, completedAt } = result.data;
  const offlineInfo = result.offline;
  const offlineSaved = offlineInfo ? new Set(offlineInfo.savedLessonIds ?? []) : undefined;
  return (
    <>
      {preview ? <PreviewBanner /> : null}
      {offlineInfo ? <OfflineNotice info={offlineInfo} /> : null}
      <h1 className="mb-2 text-3xl font-semibold">{course.title}</h1>
      <p className="mb-8 text-sm text-[var(--text-muted)]">
        {course.sequenceMode === 'guided'
          ? 'Sequência guiada: as aulas obrigatórias abrem em ordem.'
          : 'Sequência livre: estude as aulas liberadas na ordem que quiser.'}
        {!preview && access.expiresAt ? ` Acesso até ${formatAccessDate(access.expiresAt)}.` : ''}
        {preview ? ' Na prévia todas as aulas aparecem liberadas.' : ''}
      </p>
      {!preview && completedAt ? (
        <p role="status" className="mb-4 max-w-prose font-medium text-[var(--text-success)]">
          Você concluiu este curso em {formatAccessDate(completedAt)}.
        </p>
      ) : null}
      {!preview ? (
        <section aria-labelledby="progresso-titulo" className="mb-8 grid max-w-prose gap-2">
          <p id="progresso-titulo" className="font-medium">
            {progress.total === 0
              ? 'Este curso ainda não tem aulas obrigatórias.'
              : `Progresso: ${progress.percent}% (${progress.completed} de ${progress.total} aulas obrigatórias concluídas)`}
          </p>
          {progress.total > 0 ? (
            <progress
              aria-labelledby="progresso-titulo"
              max={progress.total}
              value={progress.completed}
              className="h-3 w-full accent-[var(--button-primary-bg)]"
            />
          ) : null}
          <p className="text-sm text-[var(--text-muted)]">
            As aulas opcionais não entram no progresso.
          </p>
        </section>
      ) : null}
      <div className="grid max-w-prose gap-8">
        {modules.map((module, index) => {
          const open = new Date(module.releasesAt).getTime() <= Date.now();
          return (
            <section key={module.id} aria-labelledby={`modulo-${module.id}`} className="grid gap-3">
              <h2 id={`modulo-${module.id}`} className="text-xl font-semibold">
                Módulo {index + 1}: {module.title}
                {!open && !preview ? (
                  <>
                    {' '}
                    <span className="text-sm font-normal text-[var(--text-muted)]">
                      (libera em {formatAccessDate(module.releasesAt)})
                    </span>
                  </>
                ) : null}
              </h2>
              <ol className="grid list-decimal gap-2 pl-6">
                {module.lessons.map((lesson) => (
                  <li key={lesson.id}>
                    <LessonRow
                      mode={mode}
                      lesson={lesson}
                      {...(offlineSaved ? { offlineSaved } : {})}
                    />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </>
  );
}
