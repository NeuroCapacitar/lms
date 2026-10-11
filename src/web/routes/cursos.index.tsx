import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';

import {
  CATALOG_FILTERS,
  catalogSearchSchema,
  filterCatalog,
  type CatalogCourseDto,
  type CatalogFilter,
} from '../../features/catalog/student-catalog';
import { formatBrl } from '../../features/catalog/money';
import { fetchCatalog } from '../api/courses';
import { ForbiddenError } from '../api/staff';
import { UnauthenticatedError } from '../api/profile';
import { RequireTerms } from '../components/require-terms';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/cursos/')({
  validateSearch: catalogSearchSchema,
  // Os padrões não vão para a URL: `/cursos` continua `/cursos` até a pessoa buscar ou filtrar.
  search: { middlewares: [stripSearchParams({ busca: '', filtro: 'todos' })] },
  component: () => (
    <RequireTerms>
      <Catalog />
    </RequireTerms>
  ),
});

const FILTER_LABELS: Record<CatalogFilter, string> = {
  todos: 'Todos',
  abertos: 'Inscrições abertas',
  encerrados: 'Inscrições encerradas',
};

function offerLine(course: CatalogCourseDto): string {
  const offer = course.offer;
  if (!offer) return '';
  const months = `acesso por ${offer.accessMonths} ${offer.accessMonths === 1 ? 'mês' : 'meses'}`;
  if (offer.kind === 'free') return `Gratuito · ${months}`;
  const installments =
    offer.maxInstallments > 1 ? ` · até ${offer.maxInstallments}x sem juros` : '';
  return `${formatBrl(offer.priceCents)} · ${months}${installments}`;
}

/**
 * Catálogo do aluno (M2-04): cursos publicados, com busca e filtro nos parâmetros da URL (validados
 * com Zod; valor inválido cai no padrão). A lista vem do servidor só para quem tem sessão e aceitou os
 * termos. Curso encerrado não tem ação: a inscrição é do M3-02. Dados não sensíveis, cache curto.
 */
function Catalog() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/cursos/' });
  const courses = useQuery({
    queryKey: ['catalog'],
    queryFn: fetchCatalog,
    retry: false,
    staleTime: 30_000,
  });

  const unauthenticated = courses.error instanceof UnauthenticatedError;
  const visible = courses.data ? filterCatalog(courses.data, search) : [];

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Cursos</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Veja os cursos disponíveis e como funciona o acesso a cada um.
      </p>

      {courses.isPending ? <p role="status">Carregando os cursos…</p> : null}

      {unauthenticated ? (
        <p role="alert" className="max-w-prose">
          Entre na sua conta para ver os cursos.{' '}
          <Link to="/entrar" className="underline">
            Entrar
          </Link>
        </p>
      ) : null}

      {courses.isError && !unauthenticated ? (
        <>
          <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
            {courses.error instanceof ForbiddenError
              ? 'Você não tem acesso a esta lista.'
              : 'Não foi possível carregar os cursos agora.'}
          </p>
          <Button type="button" variant="secondary" onClick={() => void courses.refetch()}>
            Tentar novamente
          </Button>
        </>
      ) : null}

      {courses.data ? (
        <>
          <form
            role="search"
            aria-label="Filtrar a lista de cursos"
            className="mb-6 grid max-w-xl gap-4"
            onSubmit={(event) => event.preventDefault()}
          >
            <TextField
              label="Buscar"
              type="search"
              maxLength={80}
              value={search.busca}
              onChange={(event) =>
                void navigate({
                  search: (previous) => ({ ...previous, busca: event.target.value }),
                  replace: true,
                })
              }
            />
            <fieldset className="grid gap-1">
              <legend className="mb-1 font-medium">Mostrar</legend>
              <div className="flex flex-wrap gap-x-6">
                {CATALOG_FILTERS.map((filter) => (
                  <label key={filter} className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="filtro"
                      className="size-5"
                      checked={search.filtro === filter}
                      onChange={() =>
                        void navigate({
                          search: (previous) => ({ ...previous, filtro: filter }),
                          replace: true,
                        })
                      }
                    />
                    <span>{FILTER_LABELS[filter]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </form>

          <p role="status" className="mb-4 text-sm text-[var(--text-muted)]">
            {courses.data.length === 0
              ? 'Ainda não há cursos publicados.'
              : visible.length === 0
                ? 'Nenhum curso encontrado com esses critérios.'
                : `${visible.length} ${visible.length === 1 ? 'curso encontrado' : 'cursos encontrados'}.`}
          </p>

          {visible.length > 0 ? (
            <ul className="grid gap-4" aria-label="Cursos">
              {visible.map((course) => (
                <li key={course.slug} className="grid gap-2 rounded-lg border p-4">
                  <h2 className="text-xl font-semibold">{course.title}</h2>
                  {course.summary ? <p className="max-w-prose">{course.summary}</p> : null}
                  <p className="text-sm text-[var(--text-muted)]">
                    {course.workloadHours !== null ? `${course.workloadHours} h · ` : ''}
                    {course.sequenceMode === 'guided' ? 'Sequência guiada' : 'Sequência livre'}
                  </p>
                  <p className="font-medium">
                    {course.availability === 'open'
                      ? `Inscrições abertas · ${offerLine(course)}`
                      : 'Inscrições encerradas'}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </>
  );
}
