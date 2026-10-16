import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { OFFLINE_BLOCKED } from '../components/study-notice';
import { offline } from './runtime';

const FORMAT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Porta de entrada do estudo SEM rede (M8-04). O app instalado não tem barra de endereço e abre sempre na página inicial: se a
 * rede falhar ali ou no catálogo, a pessoa precisa de um caminho até o que já está guardado neste aparelho. A lista sai do
 * armazenamento offline e vale a mesma regra de sempre (lease em dia e relógio coerente); o servidor segue sendo a fonte.
 */
export function OfflineSavedCourses() {
  const saved = useQuery({
    queryKey: ['offline', 'saved-courses'],
    // Sem rede o React Query PAUSARIA a consulta: aqui ela lê só o aparelho e roda sempre.
    networkMode: 'always',
    queryFn: () => offline.readSavedCourses(),
    retry: false,
    gcTime: 0,
  });

  if (saved.isPending) return null;
  const result = saved.data;
  if (!result || result.kind === 'blocked') {
    return (
      <p role="alert" className="mb-4 max-w-prose font-medium">
        {OFFLINE_BLOCKED[result?.reason ?? 'no_user']}
      </p>
    );
  }
  if (result.courses.length === 0) {
    return (
      <p role="status" className="mb-4 max-w-prose font-medium">
        Você está sem conexão. Nenhum curso foi guardado neste aparelho ainda: abra um curso com
        internet primeiro.
      </p>
    );
  }
  return (
    <section aria-labelledby="offline-courses-title" className="mb-6 max-w-prose">
      <h2 id="offline-courses-title" className="mb-2 text-xl font-semibold">
        Guardados neste aparelho
      </h2>
      <p role="status" className="mb-4 font-medium">
        Você está sem conexão. Estes cursos abrem sem internet.
      </p>
      <ul className="grid gap-3">
        {result.courses.map((course) => (
          <li key={course.courseId} className="grid gap-1 rounded-lg border p-4">
            <Link
              to="/estudar/$courseId"
              params={{ courseId: course.courseId }}
              className="min-h-11 text-lg font-semibold underline"
            >
              {course.title}
            </Link>
            <span className="text-sm text-[var(--text-muted)]">
              {course.savedLessons === 1
                ? '1 aula guardada'
                : `${course.savedLessons} aulas guardadas`}{' '}
              · vale até {FORMAT.format(course.leaseUntil)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
