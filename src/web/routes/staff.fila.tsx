import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';

import {
  QUEUE_KINDS,
  QUEUE_RULES,
  formatAge,
  hiddenGroup,
  type StaffQueueDto,
} from '../../features/staff/queue';
import { ForbiddenError } from '../api/http';
import { fetchStaffQueue } from '../api/staff-queue';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/staff/fila')({ component: QueueScreen });

const TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Fila operacional (M9-01): tudo o que precisa de ação, do mais antigo para o mais novo. Cada tipo só aparece a quem pode vê-lo e o
 * botão de ação só a quem tem o grant (o servidor decide; aqui só se mostra). Sem nome, e-mail nem dado de pagamento.
 */
function QueueScreen() {
  const queue = useQuery({
    queryKey: ['staff-queue'],
    queryFn: fetchStaffQueue,
    retry: false,
    refetchInterval: 60_000,
  });
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Fila de ações</h1>
      <p className="mb-6 max-w-prose text-[var(--text-muted)]">
        O que precisa de ação, do mais antigo para o mais novo. A tela se atualiza a cada minuto.
      </p>
      {queue.isPending ? <p role="status">Carregando a fila…</p> : null}
      {queue.isError ? (
        <>
          <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
            {queue.error instanceof ForbiddenError
              ? 'Você não tem acesso a esta fila.'
              : 'Não foi possível carregar a fila agora.'}
          </p>
          <Button type="button" variant="secondary" onClick={() => void queue.refetch()}>
            Tentar novamente
          </Button>
        </>
      ) : null}
      {queue.data ? <Queue data={queue.data} onRefresh={() => void queue.refetch()} /> : null}
    </>
  );
}

function Queue({ data, onRefresh }: { data: StaffQueueDto; onRefresh: () => void }) {
  const groups = [...new Set(data.hidden.map(hiddenGroup).filter((group) => group !== null))];
  const visibleKinds = QUEUE_KINDS.filter((kind) => data.totals[kind] !== undefined);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="text-sm text-[var(--text-muted)]">
          Atualizado em {TIME.format(new Date(data.generatedAt))}
        </span>
        <Button type="button" variant="secondary" onClick={onRefresh}>
          Atualizar
        </Button>
      </div>

      <section aria-labelledby="queue-totals" className="mb-8">
        <h2 id="queue-totals" className="mb-2 text-xl font-semibold">
          Por tipo
        </h2>
        <ul className="grid gap-1">
          {visibleKinds.map((kind) => (
            <li key={kind}>
              <span className="font-medium">{data.totals[kind]}</span> · {QUEUE_RULES[kind].title}
              <span className="block text-sm text-[var(--text-muted)]">
                {QUEUE_RULES[kind].definition}
              </span>
            </li>
          ))}
        </ul>
        {groups.length > 0 ? (
          <p className="mt-3 max-w-prose text-sm text-[var(--text-muted)]">
            Itens de {groups.join(' e de ')} não aparecem para o seu perfil.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="queue-items">
        <h2 id="queue-items" className="mb-2 text-xl font-semibold">
          Itens
        </h2>
        {data.items.length === 0 ? (
          <p role="status">Nada precisa de ação agora.</p>
        ) : (
          <ul className="grid gap-3">
            {data.items.map((item) => (
              <li key={item.id} className="grid gap-1 rounded-lg border p-4">
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-[var(--text-muted)]">
                  Há {formatAge(item.ageSeconds)}
                  {item.detail ? ` · ${item.detail}` : ''}
                </p>
                {item.action ? (
                  <p>
                    <Link
                      to={item.action.screen}
                      className="inline-flex min-h-11 items-center underline"
                    >
                      {item.action.label}
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data.truncated ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Mostrando os {data.items.length} mais antigos; há mais itens do que cabem aqui.
          </p>
        ) : null}
      </section>
    </>
  );
}
