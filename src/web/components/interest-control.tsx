import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { registerCourseInterest, withdrawCourseInterest } from '../api/interest';
import { Button } from './ui/button';

const FAILURES: Record<string, string> = {
  course_already_open: 'As inscrições deste curso já abriram. Atualize a página.',
  already_enrolled: 'Você já está inscrito neste curso.',
  not_found: 'Este curso não está mais disponível para aviso.',
};

/**
 * "Avisar-me quando abrir" (M5-06): a pessoa logada pede um e-mail quando as inscrições de um curso ainda
 * fechado abrirem, e retira o pedido quando quiser (também em "Minha conta"). O servidor decide se o pedido
 * vale; aqui só se envia e se mostra o resultado.
 */
export function InterestControl({
  courseId,
  courseTitle,
  interested,
}: {
  courseId: string;
  courseTitle: string;
  interested: boolean;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();

  async function change(register: boolean) {
    setBusy(true);
    setMessage(undefined);
    const outcome = register
      ? await registerCourseInterest(courseId)
      : await withdrawCourseInterest(courseId);
    setBusy(false);
    if (outcome.result === 'ok') {
      setMessage({
        kind: 'ok',
        text: register ? 'Pronto: avisaremos você por e-mail.' : 'Aviso retirado.',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['interests'] }),
      ]);
      return;
    }
    setMessage({
      kind: 'error',
      text:
        outcome.result === 'unauthenticated'
          ? 'Sua sessão expirou. Entre novamente.'
          : ((outcome.code ? FAILURES[outcome.code] : undefined) ??
            'Não foi possível concluir agora. Tente novamente.'),
    });
  }

  return (
    <div className="grid gap-2">
      {interested ? (
        <>
          <p className="font-medium">Avisaremos você por e-mail quando as inscrições abrirem.</p>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void change(false)}
            >
              Retirar o aviso de {courseTitle}
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void change(true)}
          >
            Avisar-me quando abrir: {courseTitle}
          </Button>
        </div>
      )}
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
    </div>
  );
}
