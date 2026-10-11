import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { CurriculumProblem } from '../../features/catalog/curriculum';
import type { DiffItem } from '../../features/catalog/curriculum-diff';
import { fetchPublishPreview, publishCurriculum } from '../api/catalog';
import { Button } from '../components/ui/button';

const PROBLEM_MESSAGES: Record<CurriculumProblem['code'], string> = {
  course_title_empty: 'Falta o título público do curso (aba Detalhes).',
  no_modules: 'O curso precisa de pelo menos um módulo.',
  module_title_empty: 'Há um módulo sem título.',
  module_no_lessons: 'Há um módulo sem aulas.',
  lesson_title_empty: 'Há uma aula sem título.',
  no_required_lesson: 'O curso precisa de pelo menos uma aula obrigatória (não opcional).',
  drip_invalid: 'Há um módulo com prazo de liberação inválido.',
  body_invalid: 'Há uma aula com texto fora do formato permitido.',
};

/** "módulo 2" ou "módulo 2, aula 1" a partir do caminho do problema. */
function describePath(path: string): string {
  const module = /modules\[(\d+)\]/.exec(path);
  const lesson = /lessons\[(\d+)\]/.exec(path);
  if (!module) return '';
  const parts = [`módulo ${Number(module[1]) + 1}`];
  if (lesson) parts.push(`aula ${Number(lesson[1]) + 1}`);
  return ` (${parts.join(', ')})`;
}

function ItemList({ title, items, empty }: { title: string; items: DiffItem[]; empty: string }) {
  return (
    <section aria-label={title} className="grid gap-1">
      <h3 className="font-semibold">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{empty}</p>
      ) : (
        <ul className="list-disc pl-6">
          {items.map((item) => (
            <li key={item.id}>
              {item.kind === 'module' ? 'Módulo' : 'Aula'}: {item.title || '(sem título)'}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Publicar (M2-03): mostra o RESUMO do que muda (adicionadas, alteradas e a aposentar) e os problemas
 * que impedem a publicação, tudo calculado no servidor sobre o rascunho SALVO. Só publica com o rascunho
 * salvo; quem não tem `course.edit` vê o resumo e não vê o botão (o servidor recusa de qualquer jeito).
 */
export function PublishPanel({
  courseId,
  dirty,
  canPublish,
  onPublished,
}: {
  courseId: string;
  /** Há alterações não salvas: o resumo seria do rascunho antigo. */
  dirty: boolean;
  canPublish: boolean;
  onPublished: () => void;
}) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['publish-preview', courseId],
    queryFn: () => fetchPublishPreview(courseId),
    retry: false,
    refetchOnMount: 'always',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();

  async function publish() {
    setBusy(true);
    setMessage(undefined);
    const outcome = await publishCurriculum(courseId);
    setBusy(false);
    if (outcome.result === 'ok' && outcome.data) {
      setMessage({
        kind: 'ok',
        text:
          outcome.data.status === 'unchanged'
            ? 'Nada mudou: o currículo publicado já é igual ao rascunho.'
            : `Currículo publicado (versão ${outcome.data.version}).`,
      });
      await queryClient.invalidateQueries({ queryKey: ['publish-preview', courseId] });
      onPublished();
      return;
    }
    if (outcome.code === 'curriculum_invalid') {
      setMessage({ kind: 'error', text: 'O rascunho tem problemas que impedem a publicação.' });
      await preview.refetch();
      return;
    }
    setMessage({
      kind: 'error',
      text:
        outcome.result === 'forbidden'
          ? 'Você não tem permissão para publicar.'
          : 'Não foi possível publicar agora. Tente novamente.',
    });
  }

  if (preview.isPending) return <p role="status">Carregando o resumo…</p>;
  if (preview.isError) {
    return (
      <>
        <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
          Não foi possível carregar o resumo agora.
        </p>
        <Button type="button" variant="secondary" onClick={() => void preview.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  }

  const { data } = preview;
  const blocked = data.problems.length > 0;
  return (
    <div className="grid max-w-2xl gap-6">
      <p>
        Versão publicada:{' '}
        <strong>{data.publishedVersion === 0 ? 'nenhuma ainda' : data.publishedVersion}</strong>
      </p>
      {dirty ? (
        <p role="alert" className="font-medium">
          Há alterações não salvas. Salve o rascunho para ver o resumo atualizado e poder publicar.
        </p>
      ) : null}

      {blocked ? (
        <section aria-label="Problemas" className="grid gap-2 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Falta resolver para publicar</h2>
          <ul className="list-disc pl-6" role="list">
            {data.problems.map((problem, index) => (
              <li key={`${problem.code}-${problem.path}-${index}`}>
                {PROBLEM_MESSAGES[problem.code]}
                {describePath(problem.path)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Resumo do que muda" className="grid gap-4">
        <h2 className="text-lg font-semibold">O que esta publicação muda</h2>
        {!data.hasChanges ? (
          <p role="status">Não há mudanças: o currículo publicado já é igual ao rascunho salvo.</p>
        ) : (
          <>
            {data.diff.details ? (
              <p>Os textos públicos do curso (título, descrição ou carga horária) mudam.</p>
            ) : null}
            <ItemList title="Adicionadas" items={data.diff.added} empty="Nada novo." />
            <ItemList title="Alteradas" items={data.diff.changed} empty="Nada alterado." />
            <ItemList
              title="Aposentadas"
              items={data.diff.retired}
              empty="Nada será aposentado. Quem já tem progresso nelas não o perde."
            />
          </>
        )}
      </section>

      {message ? (
        <p
          role={message.kind === 'ok' ? 'status' : 'alert'}
          className={
            message.kind === 'ok'
              ? 'font-medium text-[var(--text-success)]'
              : 'font-medium text-[var(--text-danger)]'
          }
        >
          {message.text}
        </p>
      ) : null}

      {canPublish ? (
        <div>
          <Button
            type="button"
            disabled={busy || dirty || blocked || !data.hasChanges}
            onClick={() => void publish()}
          >
            {busy ? 'Publicando…' : 'Publicar currículo'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
