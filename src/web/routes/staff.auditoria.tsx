import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { ForbiddenError } from '../api/http';
import { fetchAuditPage, type AuditFilters } from '../api/staff-audit';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

export const Route = createFileRoute('/staff/auditoria')({ component: AuditScreen });

const TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const EMPTY: AuditFilters = { action: '', targetType: '', targetId: '' };

/**
 * Auditoria (M9-01, `audit.view`): o registro de acréscimo do que a Staff e o sistema fizeram, do mais novo para o mais antigo, por
 * cursor. Só identificadores (a auditoria não guarda nome nem e-mail). Filtros por ação e por alvo.
 */
function AuditScreen() {
  const [draft, setDraft] = useState<AuditFilters>(EMPTY);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY);
  const audit = useInfiniteQuery({
    queryKey: ['staff-audit', filters],
    queryFn: ({ pageParam }) => fetchAuditPage(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = audit.data?.pages.flatMap((page) => page.items) ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    // Mesmos filtros: a chave da consulta não muda, então "Filtrar" de novo busca outra vez (a auditoria cresce o tempo todo).
    if (JSON.stringify(draft) === JSON.stringify(filters)) void audit.refetch();
    else setFilters(draft);
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Auditoria</h1>
      <p className="mb-6 max-w-prose text-[var(--text-muted)]">
        Registro do que foi feito na plataforma, do mais novo para o mais antigo. Mostra só
        identificadores, nunca nome nem e-mail.
      </p>

      <form
        onSubmit={submit}
        role="search"
        aria-label="Filtrar a auditoria"
        className="mb-8 grid max-w-xl gap-4"
      >
        <TextField
          label="Ação"
          name="action"
          maxLength={64}
          description="Exata, por exemplo role.grant ou finance.review.resolve."
          value={draft.action}
          onChange={(event) => setDraft({ ...draft, action: event.target.value })}
        />
        <TextField
          label="Tipo do alvo"
          name="targetType"
          maxLength={64}
          value={draft.targetType}
          onChange={(event) => setDraft({ ...draft, targetType: event.target.value })}
        />
        <TextField
          label="Identificador do alvo"
          name="targetId"
          maxLength={200}
          value={draft.targetId}
          onChange={(event) => setDraft({ ...draft, targetId: event.target.value })}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit">Filtrar</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
            }}
          >
            Limpar filtros
          </Button>
        </div>
      </form>

      {audit.isPending ? <p role="status">Carregando a auditoria…</p> : null}
      {audit.isError ? (
        <>
          <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
            {audit.error instanceof ForbiddenError
              ? 'Você não tem acesso à auditoria.'
              : 'Não foi possível carregar a auditoria agora.'}
          </p>
          <Button type="button" variant="secondary" onClick={() => void audit.refetch()}>
            Tentar novamente
          </Button>
        </>
      ) : null}

      {audit.data && items.length === 0 ? (
        <p role="status">Nenhum registro com esses filtros.</p>
      ) : null}
      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">Registros da auditoria</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4">
                  Quando
                </th>
                <th scope="col" className="py-2 pr-4">
                  Quem
                </th>
                <th scope="col" className="py-2 pr-4">
                  Ação
                </th>
                <th scope="col" className="py-2">
                  Alvo
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className="border-b align-top">
                  <td className="py-2 pr-4">{TIME.format(new Date(entry.at))}</td>
                  <td className="break-all py-2 pr-4">{entry.actorId ?? 'Sistema'}</td>
                  <td className="py-2 pr-4">
                    <span className="font-medium">{entry.action}</span>
                    {Object.keys(entry.details).length > 0 ? (
                      <details className="text-sm">
                        <summary className="min-h-11 cursor-pointer">Detalhes</summary>
                        <pre className="whitespace-pre-wrap break-all">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </td>
                  <td className="break-all py-2">
                    {entry.targetType}
                    <span className="block text-sm text-[var(--text-muted)]">{entry.targetId}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {audit.hasNextPage ? (
        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            disabled={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            {audit.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </Button>
        </div>
      ) : null}
    </>
  );
}
