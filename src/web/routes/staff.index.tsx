import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';

import type { StaffPanelDto } from '../../features/staff/panel';
import { fetchAccess } from '../api/http';
import { fetchStaffPanel } from '../api/staff-panel';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/staff/')({ component: StaffHome });

const NUMBER = new Intl.NumberFormat('pt-BR');
const TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Início da área da Staff (M9-01): o painel de fatos. Só contagens, cada uma com a definição e o período escritos na tela. Pedidos e
 * denúncias só aparecem a quem tem a capacidade (o servidor omite os números e marca `restricted`).
 */
function StaffHome() {
  const access = useQuery({ queryKey: ['access'], queryFn: fetchAccess, retry: false });
  const panel = useQuery({ queryKey: ['staff-panel'], queryFn: fetchStaffPanel, retry: false });
  const canManage = access.data?.capabilities.includes('staff.manage') ?? false;
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Área da equipe</h1>
      <p className="mb-6 max-w-prose text-[var(--text-muted)]">
        As ferramentas da equipe aparecem no menu conforme as permissões que você recebeu.
      </p>
      {canManage ? (
        <p className="mb-6">
          <Link to="/staff/equipe">Gerir a equipe</Link>
        </p>
      ) : (
        <p role="status" className="mb-6 max-w-prose">
          Você tem acesso de leitura à área da equipe. A gestão de pessoas é só do administrador.
        </p>
      )}

      {panel.isPending ? <p role="status">Carregando os números…</p> : null}
      {panel.isError ? (
        <>
          <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
            Não foi possível carregar os números agora.
          </p>
          <Button type="button" variant="secondary" onClick={() => void panel.refetch()}>
            Tentar novamente
          </Button>
        </>
      ) : null}
      {panel.data ? <Panel data={panel.data} onRefresh={() => void panel.refetch()} /> : null}
    </>
  );
}

function Panel({ data, onRefresh }: { data: StaffPanelDto; onRefresh: () => void }) {
  return (
    <>
      <section aria-labelledby="facts-title" className="mb-10">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h2 id="facts-title" className="text-2xl font-semibold">
            Números do momento
          </h2>
          <span className="text-sm text-[var(--text-muted)]">
            Atualizado em {TIME.format(new Date(data.generatedAt))}
          </span>
          <Button type="button" variant="secondary" onClick={onRefresh}>
            Atualizar
          </Button>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.facts.map((fact) => (
            <li key={fact.id} className="grid content-start gap-1 rounded-lg border p-4">
              <p className="font-medium">{fact.label}</p>
              <p className="text-3xl font-semibold">{NUMBER.format(fact.value)}</p>
              <p className="text-sm text-[var(--text-muted)]">{fact.definition}</p>
              <p className="text-sm text-[var(--text-muted)]">Período: {fact.period}.</p>
            </li>
          ))}
        </ul>
        {data.restricted.finance ? (
          <p className="mt-4 max-w-prose text-sm text-[var(--text-muted)]">
            Os números de pedidos aparecem só para quem tem acesso às finanças.
          </p>
        ) : null}
        {data.restricted.moderation ? (
          <p className="mt-2 max-w-prose text-sm text-[var(--text-muted)]">
            As denúncias abertas aparecem só para quem modera as discussões.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="courses-title">
        <h2 id="courses-title" className="mb-2 text-2xl font-semibold">
          Por curso
        </h2>
        <p className="mb-4 max-w-prose text-sm text-[var(--text-muted)]">
          Mesmas definições de cima, por curso. Os cursos com mais pessoas com acesso vêm primeiro.
        </p>
        {data.courses.length === 0 ? (
          <p role="status">Ainda não há cursos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <caption className="sr-only">Números por curso</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-4">
                    Curso
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right">
                    Com acesso
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right">
                    Vencem em 7 dias
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right">
                    Concluíram
                  </th>
                  <th scope="col" className="py-2 text-right">
                    Interesses
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.courses.map((course) => (
                  <tr key={course.courseId} className="border-b">
                    <th scope="row" className="py-2 pr-4 font-medium">
                      {course.title}
                    </th>
                    <td className="py-2 pr-4 text-right">{NUMBER.format(course.withAccess)}</td>
                    <td className="py-2 pr-4 text-right">
                      {NUMBER.format(course.expiringIn7Days)}
                    </td>
                    <td className="py-2 pr-4 text-right">{NUMBER.format(course.completions)}</td>
                    <td className="py-2 text-right">{NUMBER.format(course.activeInterests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.coursesTruncated ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">Mostrando os 50 primeiros cursos.</p>
        ) : null}
      </section>
    </>
  );
}
