import { useState } from 'react';

import { Button } from '../components/ui/button';
import { offline } from './runtime';
import { useOutboxSummary } from './use-outbox';

/**
 * "Concluir aula" SEM rede (M8-03). Guarda o comando no outbox do aparelho; quem confere acesso, drip e sequência é o servidor, quando
 * a rede voltar (e pode recusar: o aviso aparece). Só aula de texto chega aqui. Uma conclusão por aula: clicar de novo não duplica.
 */
export function OfflineComplete({
  lessonId,
  courseId,
  lessonTitle,
}: {
  lessonId: string;
  courseId: string;
  lessonTitle: string;
}) {
  const { pending } = useOutboxSummary();
  const [failed, setFailed] = useState(false);
  const queued = pending.some((item) => item.lessonId === lessonId);

  async function conclude() {
    setFailed(false);
    const outcome = await offline.enqueueCompletion({ lessonId, courseId, lessonTitle });
    if (outcome === 'no_user' || outcome === 'failed') setFailed(true);
  }

  if (queued) {
    return (
      <p role="status" className="font-medium text-[var(--text-success)]">
        Conclusão guardada neste aparelho. Ela será enviada quando houver conexão.
      </p>
    );
  }
  return (
    <>
      <div>
        <Button type="button" onClick={() => void conclude()}>
          Concluir aula
        </Button>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        Sem conexão: a conclusão fica guardada neste aparelho e é enviada quando a internet voltar.
      </p>
      {failed ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível guardar a conclusão neste aparelho. Conecte-se à internet para concluir.
        </p>
      ) : null}
    </>
  );
}
