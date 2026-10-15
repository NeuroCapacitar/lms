import { useState, type FormEvent } from 'react';

import type { LessonQuizDto } from '../../features/access/outline';
import type { StudentQuiz } from '../../features/quiz/quiz';
import { submitQuizAttempt, type QuizAttemptResponse } from '../api/learning';
import { useBusy } from '../pwa/safe-boundary';
import { Button } from '../components/ui/button';

interface QuizPanelProps {
  lessonId: string;
  view: LessonQuizDto;
  /** Prévia da Staff: o quiz aparece, mas nada é enviado nem gravado. */
  preview: boolean;
  /** Depois de uma tentativa aceita: a tela recarrega a aula e o mapa (a aprovação conclui a aula). */
  onSubmitted: (outcome: QuizAttemptResponse) => void;
}

const FAILURES: Record<string, string> = {
  attempts_exhausted: 'Você já usou todas as tentativas deste quiz.',
  quiz_already_passed: 'Você já foi aprovado neste quiz.',
  invalid_answers:
    'Suas respostas não correspondem ao quiz (ele pode ter sido atualizado). Recarregue a página e responda de novo.',
  lesson_locked: 'Esta aula ainda não pode receber tentativas.',
  access_denied: 'Seu acesso a este curso não permite enviar o quiz.',
};

/** O resultado de uma tentativa, junto com as questões COMO FORAM APRESENTADAS naquela tentativa. */
interface Shown {
  response: QuizAttemptResponse;
  questions: StudentQuiz['questions'];
}

/**
 * Quiz da aula (M5-04). O aluno marca as opções e envia; a nota e a aprovação vêm do SERVIDOR (o cliente só
 * manda as opções marcadas). O gabarito só aparece na resposta da submissão e só se o quiz tem feedback imediato.
 * Acessível: cada questão é um `fieldset` com `legend`, opções são controles nativos com rótulo, o resultado é
 * uma região `status`. Submissão exige conexão: offline é recusada antes de enviar.
 */
export function QuizPanel({ lessonId, view, preview, onSubmitted }: QuizPanelProps) {
  const [shown, setShown] = useState<Shown | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const { quiz } = view;

  return (
    <section aria-labelledby="quiz-titulo" className="mb-10 grid max-w-prose gap-4">
      <h2 id="quiz-titulo" className="text-xl font-semibold">
        Quiz
      </h2>
      <p className="text-sm text-[var(--text-muted)]">
        Nota mínima para aprovar: {quiz.minScorePercent}%.{' '}
        {view.attemptsLeft === null
          ? 'Tentativas ilimitadas.'
          : `Tentativas restantes: ${view.attemptsLeft}.`}
      </p>

      {shown ? <Result shown={shown} /> : <LastAttempt view={view} />}
      {error ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          {error}
        </p>
      ) : null}

      {view.passed || (shown?.response.attempt.passed ?? false) ? (
        <p role="status" className="font-medium text-[var(--text-success)]">
          Você foi aprovado neste quiz.
        </p>
      ) : view.canAttempt ? (
        <AttemptForm
          // Nova tentativa = ordem possivelmente embaralhada de novo: o formulário recomeça limpo.
          key={view.attemptsUsed}
          lessonId={lessonId}
          quiz={quiz}
          preview={preview}
          busy={busy}
          onSubmit={async (answers) => {
            setBusy(true);
            setError(undefined);
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
              setError('O envio do quiz exige conexão com a internet. Conecte-se e tente de novo.');
              setBusy(false);
              return;
            }
            const outcome = await submitQuizAttempt(lessonId, answers);
            setBusy(false);
            if (outcome.result === 'ok' && outcome.data) {
              setShown({ response: outcome.data, questions: quiz.questions });
              onSubmitted(outcome.data);
              return;
            }
            setError(
              outcome.result === 'unavailable'
                ? 'Não foi possível enviar agora. O quiz exige conexão: verifique a internet e tente de novo.'
                : outcome.result === 'unauthenticated'
                  ? 'Sua sessão expirou. Entre novamente.'
                  : ((outcome.code ? FAILURES[outcome.code] : undefined) ??
                    'Não foi possível enviar o quiz agora. Tente novamente.'),
            );
          }}
        />
      ) : (
        <p role="status" className="font-medium">
          {FAILURES.attempts_exhausted}
        </p>
      )}
    </section>
  );
}

function LastAttempt({ view }: { view: LessonQuizDto }) {
  if (!view.last) return null;
  return (
    <p role="status">
      Última tentativa (nº {view.last.number}): {view.last.scorePercent}% —{' '}
      {view.last.passed ? 'aprovado' : 'não aprovado'}.
    </p>
  );
}

function Result({ shown }: { shown: Shown }) {
  const { response, questions } = shown;
  const { attempt } = response;
  const text = new Map(
    questions.flatMap((question) => question.options.map((option) => [option.id, option.text])),
  );
  return (
    <div role="status" className="grid gap-2 rounded-lg border p-4">
      <p className="font-medium">
        Tentativa {attempt.number}: {attempt.scorePercent}% ({attempt.earnedPoints} de{' '}
        {attempt.totalPoints} pontos).{' '}
        {attempt.passed
          ? 'Aprovado!'
          : `Não aprovado (mínimo ${attempt.minScorePercent}%). Você pode tentar de novo.`}
      </p>
      {response.completion?.courseJustCompleted ? (
        <p className="font-medium text-[var(--text-success)]">Parabéns, você concluiu o curso!</p>
      ) : null}
      {response.review ? (
        <ol className="grid list-decimal gap-2 pl-5">
          {response.review.map((item) => {
            const question = questions.find((candidate) => candidate.id === item.questionId);
            return (
              <li key={item.questionId}>
                <span className="font-medium">{question?.prompt}</span>{' '}
                {item.correct ? (
                  <span className="text-[var(--text-success)]">— correta</span>
                ) : (
                  <span className="text-[var(--text-danger)]">
                    — incorreta. Resposta certa:{' '}
                    {(item.correctOptionIds ?? []).map((id) => text.get(id) ?? '').join('; ')}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function AttemptForm({
  quiz,
  lessonId,
  preview,
  busy,
  onSubmit,
}: {
  quiz: StudentQuiz;
  lessonId: string;
  preview: boolean;
  busy: boolean;
  onSubmit: (answers: { questionId: string; optionIds: string[] }[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  // M8-01: quiz com resposta marcada (ou enviando) não pode ser interrompido por uma atualização do app.
  useBusy('quiz em andamento', busy || Object.values(selected).some((ids) => ids.length > 0));

  function toggle(questionId: string, optionId: string, single: boolean, checked: boolean) {
    setSelected((current) => {
      const previous = current[questionId] ?? [];
      const next = single
        ? checked
          ? [optionId]
          : []
        : checked
          ? [...previous.filter((id) => id !== optionId), optionId]
          : previous.filter((id) => id !== optionId);
      return { ...current, [questionId]: next };
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (preview) return;
    void onSubmit(
      quiz.questions.map((question) => ({
        questionId: question.id,
        optionIds: selected[question.id] ?? [],
      })),
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      {quiz.questions.map((question, index) => {
        const single = question.kind === 'single';
        return (
          <fieldset key={question.id} className="grid gap-2 rounded-lg border p-4">
            <legend className="px-1 font-medium">
              {index + 1}. {question.prompt}
              <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
                ({single ? 'escolha uma' : 'escolha todas as corretas'}; {question.points}{' '}
                {question.points === 1 ? 'ponto' : 'pontos'})
              </span>
            </legend>
            {question.options.map((option) => {
              const inputId = `q-${lessonId}-${option.id}`;
              return (
                <label
                  key={option.id}
                  htmlFor={inputId}
                  className="flex min-h-11 items-center gap-3"
                >
                  <input
                    id={inputId}
                    type={single ? 'radio' : 'checkbox'}
                    name={`q-${question.id}`}
                    className="size-5"
                    checked={(selected[question.id] ?? []).includes(option.id)}
                    onChange={(event) =>
                      toggle(question.id, option.id, single, event.target.checked)
                    }
                  />
                  <span>{option.text}</span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
      {preview ? (
        <p className="text-sm text-[var(--text-muted)]">
          Na prévia o quiz não pode ser enviado: nada é gravado.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy || preview}>
          {busy ? 'Enviando…' : 'Enviar respostas'}
        </Button>
      </div>
    </form>
  );
}
