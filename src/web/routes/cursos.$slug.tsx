import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';

import type { AccessDto } from '../../features/access/access';
import { formatBrl } from '../../features/catalog/money';
import type { PublicCoursePageDto } from '../../features/catalog/public-course';
import { fetchPublicCourse } from '../api/courses';
import { fetchCourseAccess } from '../api/enroll';
import { UnauthenticatedError } from '../api/profile';
import { ForbiddenError } from '../api/staff';
import { AccessStatus, EnrollControl } from '../components/enroll-control';
import { RichTextView } from '../components/rich-text/rich-text-view';
import { Button } from '../components/ui/button';
import { PublicImage } from '../components/public-image';

export const Route = createFileRoute('/cursos/$slug')({ component: CoursePage });

function offerText(course: PublicCoursePageDto): string {
  const offer = course.offer;
  if (!offer) return '';
  const months = `acesso por ${offer.accessMonths} ${offer.accessMonths === 1 ? 'mês' : 'meses'}`;
  if (offer.kind === 'free') return `Gratuito · ${months}`;
  const installments =
    offer.maxInstallments > 1 ? ` · até ${offer.maxInstallments}x sem juros` : '';
  return `${formatBrl(offer.priceCents)} · ${months}${installments}`;
}

/**
 * Página pública do curso (M2-06), aberta a qualquer pessoa. Os metadados de compartilhamento são
 * injetados pelo Worker no primeiro HTML; aqui só a tela. Oferta gratuita aberta leva ao login (a
 * inscrição é do M3-02); oferta paga ainda não tem compra (M6); encerrada não tem ação. Curso
 * inexistente, em rascunho ou arquivado mostra a MESMA mensagem.
 */
function CoursePage() {
  const { slug } = Route.useParams();
  const course = useQuery({
    queryKey: ['public-course', slug],
    queryFn: () => fetchPublicCourse(slug),
    retry: false,
    staleTime: 30_000,
  });

  // O estado de acesso da pessoa (401 = sem sessão). Só com o curso carregado, pois precisa do id.
  const courseId = course.data?.id;
  const access = useQuery({
    queryKey: ['access', courseId],
    queryFn: () => fetchCourseAccess(courseId!),
    enabled: courseId !== undefined,
    retry: false,
    staleTime: 15_000,
  });

  if (course.isPending) return <p role="status">Carregando o curso…</p>;
  if (course.isError) {
    return (
      <>
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar o curso agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void course.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }
  if (course.data === null) {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Curso não encontrado</h1>
        <p className="mb-6 max-w-prose">Este curso não existe ou não está disponível.</p>
        <Link to="/cursos" className="underline">
          Ver os cursos
        </Link>
      </>
    );
  }

  const data = course.data;
  return (
    <article className="grid max-w-prose gap-8">
      {data.banner ? (
        <PublicImage image={data.banner} className="h-auto w-full rounded-lg object-cover" />
      ) : null}
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold">{data.title}</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {data.workloadHours !== null ? `${data.workloadHours} h · ` : ''}
          {data.sequenceMode === 'guided' ? 'Sequência guiada' : 'Sequência livre'}
        </p>
      </header>

      {data.cover ? (
        <PublicImage image={data.cover} className="h-auto w-full rounded-lg object-cover" />
      ) : null}

      <RichTextView value={data.description} />

      <section aria-labelledby="ementa" className="grid gap-3">
        <h2 id="ementa" className="text-xl font-semibold">
          Conteúdo do curso
        </h2>
        <ol className="list-decimal pl-6">
          {data.syllabus.map((title, index) => (
            <li key={index}>{title}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="acesso" className="grid gap-3 rounded-lg border p-4">
        <h2 id="acesso" className="text-xl font-semibold">
          Acesso
        </h2>
        {data.availability === 'closed' ? (
          <>
            <p className="font-medium">Inscrições encerradas</p>
            {access.data?.hasAccess ? (
              <AccessStatus access={access.data} courseId={data.id} />
            ) : null}
          </>
        ) : (
          <>
            <p className="font-medium">{offerText(data)}</p>
            {data.offer?.kind === 'free' ? (
              <FreeEnrollment
                courseId={data.id}
                offerId={data.offer.id}
                slug={data.slug}
                access={access}
              />
            ) : (
              <>
                {access.data?.hasAccess ? (
                  <AccessStatus access={access.data} courseId={data.id} />
                ) : null}
                <p className="text-sm text-[var(--text-muted)]">
                  A compra deste curso ainda não está disponível.
                </p>
              </>
            )}
          </>
        )}
      </section>
    </article>
  );
}

/** Inscrição gratuita na página pública: convite para entrar (sem sessão), estado ou botão. */
function FreeEnrollment({
  courseId,
  offerId,
  slug,
  access,
}: {
  courseId: string;
  offerId: string;
  slug: string;
  access: ReturnType<typeof useQuery<AccessDto>>;
}) {
  if (access.isPending) return <p role="status">Verificando o seu acesso…</p>;
  if (access.error instanceof UnauthenticatedError) {
    return (
      <EnrollControl
        courseId={courseId}
        offerId={offerId}
        access={null}
        returnTo={`/cursos/${slug}`}
      />
    );
  }
  if (access.error instanceof ForbiddenError) {
    return (
      <p role="alert" className="max-w-prose">
        Para se inscrever, aceite os Termos de Uso e a Política de Privacidade em{' '}
        <Link to="/conta" className="underline">
          Minha conta
        </Link>
        .
      </p>
    );
  }
  if (access.isError || !access.data) {
    return (
      <p role="alert" className="font-medium text-[var(--text-danger)]">
        Não foi possível verificar o seu acesso agora. Atualize a página.
      </p>
    );
  }
  return (
    <EnrollControl
      courseId={courseId}
      offerId={offerId}
      access={access.data}
      returnTo={`/cursos/${slug}`}
    />
  );
}
