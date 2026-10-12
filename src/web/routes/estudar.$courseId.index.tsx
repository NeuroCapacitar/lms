import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';

import { formatAccessDate } from '../../features/access/format';
import type { OutlineLessonDto } from '../../features/access/outline';
import { fetchOutline } from '../api/learning';
import { RequireTerms } from '../components/require-terms';
import { StudyNotice, lockMessage } from '../components/study-notice';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/estudar/$courseId/')({
  component: () => (
    <RequireTerms>
      <Outline />
    </RequireTerms>
  ),
});

function LessonRow({ courseId, lesson }: { courseId: string; lesson: OutlineLessonDto }) {
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
  if (lesson.locked === null) {
    return (
      <Link to="/estudar/$courseId/aulas/$lessonId" params={{ courseId, lessonId: lesson.id }}>
        {label}
      </Link>
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
 * Mapa do curso (M3-03): módulos e aulas com o estado de cada uma. Quem decide o que abre é o
 * servidor; aqui só se mostra: aula liberada é link, aula bloqueada é texto com o motivo e a data.
 */
function Outline() {
  const { courseId } = Route.useParams();
  const outline = useQuery({
    queryKey: ['outline', courseId],
    queryFn: () => fetchOutline(courseId),
    retry: false,
    staleTime: 10_000,
  });

  if (outline.isPending) return <p role="status">Carregando o curso…</p>;
  if (outline.isError) {
    return (
      <>
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
        <StudyNotice result={result} returnTo={`/estudar/${courseId}`} />
      </>
    );
  }

  const { course, access, modules } = result.data;
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">{course.title}</h1>
      <p className="mb-8 text-sm text-[var(--text-muted)]">
        {course.sequenceMode === 'guided'
          ? 'Sequência guiada: as aulas obrigatórias abrem em ordem.'
          : 'Sequência livre: estude as aulas liberadas na ordem que quiser.'}
        {access.expiresAt ? ` Acesso até ${formatAccessDate(access.expiresAt)}.` : ''}
      </p>
      <div className="grid max-w-prose gap-8">
        {modules.map((module, index) => {
          const open = new Date(module.releasesAt).getTime() <= Date.now();
          return (
            <section key={module.id} aria-labelledby={`modulo-${module.id}`} className="grid gap-3">
              <h2 id={`modulo-${module.id}`} className="text-xl font-semibold">
                Módulo {index + 1}: {module.title}
                {!open ? (
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
                    <LessonRow courseId={courseId} lesson={lesson} />
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
