import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';

import type { CourseStatus } from '../../features/catalog/catalog';
import { fetchCourses } from '../api/catalog';
import { Button } from '../components/ui/button';
import { CreateCourseForm } from '../course-builder/create-course-form';
import { useAccess } from '../hooks/use-access';

export const Route = createFileRoute('/staff/cursos/')({ component: CourseList });

const STATUS_LABELS: Record<CourseStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  archived: 'Arquivado',
};

/**
 * Lista de cursos (M2-03). Quem só tem leitura vê a lista e abre o curso em modo leitura; criar
 * curso é do Admin (`course.create`). O servidor confere a capability em cada escrita.
 */
function CourseList() {
  const access = useAccess();
  const courses = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, retry: false });

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Cursos</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Cursos, currículo e ofertas. O que você pode editar depende das suas permissões.
      </p>

      {courses.isPending ? <p role="status">Carregando…</p> : null}
      {courses.isError ? (
        <>
          <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
            Não foi possível carregar os cursos agora.
          </p>
          <Button type="button" variant="secondary" onClick={() => void courses.refetch()}>
            Tentar novamente
          </Button>
        </>
      ) : null}
      {courses.data?.length === 0 ? <p className="mb-8">Nenhum curso ainda.</p> : null}

      {courses.data && courses.data.length > 0 ? (
        <ul className="mb-12 grid gap-3" aria-label="Cursos">
          {courses.data.map((course) => {
            const active = course.offers.filter((offer) => offer.status === 'active').length;
            return (
              <li key={course.id} className="grid gap-1 rounded-lg border p-4">
                <p className="text-lg font-semibold">
                  <Link to="/staff/cursos/$courseId" params={{ courseId: course.id }}>
                    {course.title}
                  </Link>
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  Endereço: {course.slug} · {STATUS_LABELS[course.status]} ·{' '}
                  {course.publishedVersion > 0
                    ? `currículo publicado (versão ${course.publishedVersion})`
                    : 'currículo ainda não publicado'}{' '}
                  · {active} de {course.offers.length}{' '}
                  {course.offers.length === 1 ? 'oferta ativa' : 'ofertas ativas'}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}

      {access.has('course.create') ? <CreateCourseForm /> : null}
    </>
  );
}
