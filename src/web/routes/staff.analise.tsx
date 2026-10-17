import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import {
  FUNNEL_WINDOW_DAYS,
  PROGRESS_BANDS,
  VIDEO_BANDS,
  type CourseAnalyticsDto,
  type OfferAnalyticsDto,
} from '../../features/staff/analytics';
import { fetchCourses } from '../api/catalog';
import { ForbiddenError } from '../api/http';
import { fetchCourseAnalytics, fetchOfferAnalytics } from '../api/staff-analytics';
import { Button } from '../components/ui/button';
import { useAccess } from '../hooks/use-access';

export const Route = createFileRoute('/staff/analise')({ component: AnalysisScreen });

const NUMBER = new Intl.NumberFormat('pt-BR');
const TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const KIND_LABEL = { text: 'Texto', video: 'Vídeo', quiz: 'Quiz' } as const;

const percent = (part: number, whole: number) =>
  whole === 0 ? '—' : `${NUMBER.format(Math.round((100 * part) / whole))}%`;

/**
 * Análise (M9-02): fatos derivados do que a plataforma já guarda. Só contagens, cada uma com a definição escrita. Os números são de
 * pessoas matriculadas e IDENTIFICÁVEIS (não anônimos), e dizem o que aconteceu, não o que causou o quê. Sem exportação.
 */
function AnalysisScreen() {
  const access = useAccess();
  const courses = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, retry: false });
  const [chosen, setChosen] = useState<string | undefined>();
  const courseId = chosen ?? courses.data?.[0]?.id;
  const analytics = useQuery({
    queryKey: ['staff-analytics', courseId],
    queryFn: () => fetchCourseAnalytics(courseId!),
    enabled: courseId !== undefined,
    retry: false,
  });
  const canSeeSales = access.has('finance.view');
  const offers = useQuery({
    queryKey: ['staff-analytics-offers'],
    queryFn: fetchOfferAnalytics,
    enabled: canSeeSales,
    retry: false,
  });

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Análise</h1>
      <p className="mb-2 max-w-prose text-[var(--text-muted)]">
        Estes números vêm de dados que a plataforma já guarda: matrículas, aulas concluídas, vídeo,
        quiz, pedidos e avisos. São fatos sobre pessoas matriculadas, que podem ser identificadas:
        não são dados anônimos. Aqui você vê só contagens.
      </p>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Os números dizem o que aconteceu, não o que causou o quê: um aviso, um e-mail ou uma oferta
        não explica sozinho uma compra. Não há exportação.
      </p>

      <section aria-labelledby="learning-title" className="mb-12">
        <h2 id="learning-title" className="mb-4 text-2xl font-semibold">
          Aprendizagem por curso
        </h2>
        {courses.isPending ? <p role="status">Carregando os cursos…</p> : null}
        {courses.isError ? (
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            Não foi possível carregar os cursos agora.
          </p>
        ) : null}
        {courses.data && courses.data.length === 0 ? (
          <p role="status">Ainda não há cursos.</p>
        ) : null}
        {courses.data && courses.data.length > 0 ? (
          <div className="mb-6 grid max-w-md gap-1">
            <label htmlFor="analysis-course" className="font-medium">
              Curso
            </label>
            <select
              id="analysis-course"
              className="min-h-11 rounded-lg border bg-[var(--surface)] px-3"
              value={courseId ?? ''}
              onChange={(event) => setChosen(event.target.value)}
            >
              {courses.data.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {analytics.isPending && courseId ? <p role="status">Carregando os números…</p> : null}
        {analytics.isError ? (
          <>
            <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
              {analytics.error instanceof ForbiddenError
                ? 'Você não tem acesso a esta análise.'
                : 'Não foi possível carregar a análise agora.'}
            </p>
            <Button type="button" variant="secondary" onClick={() => void analytics.refetch()}>
              Tentar novamente
            </Button>
          </>
        ) : null}
        {analytics.data ? <Learning data={analytics.data} /> : null}
      </section>

      <section aria-labelledby="sales-title">
        <h2 id="sales-title" className="mb-4 text-2xl font-semibold">
          Ofertas e avisos
        </h2>
        {!canSeeSales && !access.isPending ? (
          <p className="max-w-prose text-[var(--text-muted)]">
            O funil das ofertas aparece só para quem tem acesso às finanças.
          </p>
        ) : null}
        {offers.isPending && canSeeSales ? <p role="status">Carregando o funil…</p> : null}
        {offers.isError ? (
          <>
            <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
              Não foi possível carregar o funil agora.
            </p>
            <Button type="button" variant="secondary" onClick={() => void offers.refetch()}>
              Tentar novamente
            </Button>
          </>
        ) : null}
        {offers.data ? <Sales data={offers.data} /> : null}
      </section>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <li className="grid content-start gap-1 rounded-lg border p-4">
      <p className="font-medium">{label}</p>
      <p className="text-3xl font-semibold">{value}</p>
      <p className="text-sm text-[var(--text-muted)]">{note}</p>
    </li>
  );
}

function Learning({ data }: { data: CourseAnalyticsDto }) {
  return (
    <>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Atualizado em {TIME.format(new Date(data.generatedAt))}
      </p>
      <ul className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Matriculados"
          value={NUMBER.format(data.enrolled)}
          note="Todas as pessoas matriculadas no curso, inclusive quem já perdeu o acesso."
        />
        <Stat
          label="Com acesso"
          value={NUMBER.format(data.withAccess)}
          note={data.definitions.withAccess}
        />
        <Stat
          label="Sem atividade há 14 dias ou mais"
          value={NUMBER.format(data.inactive.days14)}
          note={data.definitions.inactive}
        />
        <Stat
          label="Sem atividade há 30 dias ou mais"
          value={NUMBER.format(data.inactive.days30)}
          note="Quem tem 30 dias também está entre os de 14."
        />
      </ul>

      <h3 className="mb-2 text-xl font-semibold">Progresso das pessoas com acesso</h3>
      <p className="mb-3 max-w-prose text-sm text-[var(--text-muted)]">
        {data.definitions.progress}
      </p>
      {data.progressBands === null ? (
        <p role="status" className="mb-8">
          Este curso ainda não tem aula obrigatória.
        </p>
      ) : (
        <div className="mb-8 overflow-x-auto">
          <table className="w-full min-w-[24rem] border-collapse text-left">
            <caption className="sr-only">Pessoas por faixa de progresso</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4">
                  Concluíram
                </th>
                <th scope="col" className="py-2 text-right">
                  Pessoas
                </th>
              </tr>
            </thead>
            <tbody>
              {PROGRESS_BANDS.map((band, index) => (
                <tr key={band} className="border-b">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {band}
                  </th>
                  <td className="py-2 text-right">{NUMBER.format(data.progressBands![index]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mb-2 text-xl font-semibold">Por aula</h3>
      <ul className="mb-3 grid max-w-prose gap-1 text-sm text-[var(--text-muted)]">
        <li>{data.definitions.lessonCompletion}</li>
        <li>{data.definitions.videoPosition}</li>
        <li>{data.definitions.quiz}</li>
      </ul>
      {data.lessons.length === 0 ? (
        <p role="status">Este curso ainda não tem aulas.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">Números por aula</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4">
                  Aula
                </th>
                <th scope="col" className="py-2 pr-4">
                  Tipo
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Concluíram
                </th>
                <th scope="col" className="py-2">
                  Detalhe
                </th>
              </tr>
            </thead>
            <tbody>
              {data.lessons.map((lesson) => (
                <tr key={lesson.lessonId} className="border-b align-top">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {lesson.title}
                    {lesson.isOptional ? (
                      <span className="block text-sm font-normal text-[var(--text-muted)]">
                        Opcional
                      </span>
                    ) : null}
                  </th>
                  <td className="py-2 pr-4">{KIND_LABEL[lesson.kind]}</td>
                  <td className="py-2 pr-4 text-right">
                    {NUMBER.format(lesson.completions)}{' '}
                    <span className="text-sm text-[var(--text-muted)]">
                      ({percent(lesson.completions, data.enrolled)})
                    </span>
                  </td>
                  <td className="py-2 text-sm">
                    {lesson.video ? (
                      <>
                        {NUMBER.format(lesson.video.started)} começaram,{' '}
                        {NUMBER.format(lesson.video.completed)} concluíram.
                        <ul>
                          {VIDEO_BANDS.map((band, index) => (
                            <li key={band}>
                              {band}: {NUMBER.format(lesson.video!.bands[index]!)}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {lesson.quiz
                      ? `${NUMBER.format(lesson.quiz.attemptedPeople)} tentaram, ${NUMBER.format(lesson.quiz.attempts)} tentativas, ${NUMBER.format(lesson.quiz.passedPeople)} passaram.`
                      : null}
                    {!lesson.video && !lesson.quiz ? '—' : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Sales({ data }: { data: OfferAnalyticsDto }) {
  return (
    <>
      <p className="mb-2 max-w-prose text-sm text-[var(--text-muted)]">{data.definitions.funnel}</p>
      <p className="mb-4 max-w-prose text-sm text-[var(--text-muted)]">
        {data.definitions.causality}
      </p>
      <h3 className="mb-2 text-xl font-semibold">Funil das ofertas pagas</h3>
      {data.offers.length === 0 ? (
        <p role="status" className="mb-8">
          Ainda não há oferta paga.
        </p>
      ) : (
        <div className="mb-8 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left">
            <caption className="sr-only">
              Pedidos por oferta paga, últimos {FUNNEL_WINDOW_DAYS} dias
            </caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4">
                  Oferta
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Pedidos
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Abriram o checkout
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Pagos
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Expirados
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Cancelados
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Pendentes
                </th>
                <th scope="col" className="py-2 text-right">
                  Reembolsados
                </th>
              </tr>
            </thead>
            <tbody>
              {data.offers.map((offer) => (
                <tr key={offer.offerId} className="border-b">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {offer.offerName}
                    <span className="block text-sm font-normal text-[var(--text-muted)]">
                      {offer.courseTitle}
                    </span>
                  </th>
                  <td className="py-2 pr-4 text-right">{NUMBER.format(offer.ordersCreated)}</td>
                  <td className="py-2 pr-4 text-right">{NUMBER.format(offer.checkoutsOpened)}</td>
                  <td className="py-2 pr-4 text-right">{NUMBER.format(offer.paid)}</td>
                  <td className="py-2 pr-4 text-right">{NUMBER.format(offer.expired)}</td>
                  <td className="py-2 pr-4 text-right">{NUMBER.format(offer.canceled)}</td>
                  <td className="py-2 pr-4 text-right">{NUMBER.format(offer.pending)}</td>
                  <td className="py-2 text-right">{NUMBER.format(offer.refunded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mb-2 text-xl font-semibold">Avisos de curso</h3>
      <p className="mb-3 max-w-prose text-sm text-[var(--text-muted)]">
        {data.definitions.interests}
      </p>
      {data.interests.length === 0 ? (
        <p role="status">Ainda não há pedidos de aviso.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left">
            <caption className="sr-only">Pedidos de aviso por curso</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4">
                  Curso
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Total
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Ativos
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Retirados
                </th>
                <th scope="col" className="py-2 text-right">
                  Convertidos
                </th>
              </tr>
            </thead>
            <tbody>
              {data.interests.map((row) => (
                <tr key={row.courseId} className="border-b">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {row.courseTitle}
                  </th>
                  <td className="py-2 pr-4 text-right">{NUMBER.format(row.total)}</td>
                  <td className="py-2 pr-4 text-right">{NUMBER.format(row.active)}</td>
                  <td className="py-2 pr-4 text-right">{NUMBER.format(row.withdrawn)}</td>
                  <td className="py-2 text-right">
                    {NUMBER.format(row.converted)}{' '}
                    <span className="text-sm text-[var(--text-muted)]">
                      ({percent(row.converted, row.total)})
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
