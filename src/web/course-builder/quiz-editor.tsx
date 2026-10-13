import type { Quiz } from '../../features/quiz/quiz';
import {
  addOption,
  addQuestion,
  moveQuestion,
  parseMaxAttempts,
  removeOption,
  removeQuestion,
  setOptionCorrect,
  setQuestionKind,
  updateOptionText,
  updateQuestion,
} from '../../features/quiz/quiz-edit';
import { ConfirmButton } from '../components/confirm-button';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

const newId = () => crypto.randomUUID();
const SELECT_CLASS = 'min-h-11 rounded-lg border bg-[var(--input-bg)] px-2 text-[var(--input-fg)]';

interface QuizEditorProps {
  value: Quiz;
  onChange: (next: Quiz) => void;
  readOnly: boolean;
  /** Ex.: "aula 2 do módulo 1": entra nos rótulos para o leitor de tela distinguir os quizzes. */
  where: string;
  announce: (message: string) => void;
}

/**
 * Editor do quiz de uma aula (M5-04): configurações, questões e opções. Tudo é HTML nativo com rótulo; a ordem
 * das questões muda por BOTÕES (subir e descer) e cada mudança é anunciada. O gabarito (a opção correta) só
 * aparece aqui, para a Staff. Nada é salvo até "Salvar rascunho"; a publicação confere a coerência.
 */
export function QuizEditor({ value, onChange, readOnly, where, announce }: QuizEditorProps) {
  return (
    <div className="grid gap-4 rounded-lg border p-3" role="group" aria-label={`Quiz da ${where}`}>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={`Nota mínima para aprovar (%), quiz da ${where}`}
          type="number"
          min={1}
          max={100}
          value={String(value.minScorePercent)}
          disabled={readOnly}
          onChange={(event) =>
            onChange({
              ...value,
              minScorePercent: Math.max(
                1,
                Math.min(100, Math.trunc(Number(event.target.value) || 1)),
              ),
            })
          }
        />
        <TextField
          label={`Máximo de tentativas, quiz da ${where}`}
          description="Em branco = tentativas ilimitadas."
          type="number"
          min={1}
          max={100}
          value={value.maxAttempts === null ? '' : String(value.maxAttempts)}
          disabled={readOnly}
          onChange={(event) =>
            onChange({ ...value, maxAttempts: parseMaxAttempts(event.target.value) })
          }
        />
      </div>
      <label className="grid gap-1.5">
        <span className="font-medium text-[var(--field-label)]">
          Feedback depois de enviar, quiz da {where}
        </span>
        <select
          className={SELECT_CLASS}
          value={value.feedback}
          disabled={readOnly}
          onChange={(event) =>
            onChange({ ...value, feedback: event.target.value as Quiz['feedback'] })
          }
        >
          <option value="immediate">Mostrar o que acertou e as respostas certas</option>
          <option value="score_only">Mostrar só a nota</option>
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          className="size-5"
          checked={value.shuffle}
          disabled={readOnly}
          onChange={(event) => onChange({ ...value, shuffle: event.target.checked })}
        />
        <span>Embaralhar questões e opções a cada tentativa (quiz da {where})</span>
      </label>

      {value.questions.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Este quiz ainda não tem questões.</p>
      ) : null}
      <ol className="grid gap-4" aria-label={`Questões do quiz da ${where}`}>
        {value.questions.map((question, index) => {
          const at = `questão ${index + 1}`;
          return (
            <li key={question.id} className="grid gap-3 rounded-lg border p-3">
              <TextField
                label={`Enunciado da ${at} (${where})`}
                value={question.prompt}
                disabled={readOnly}
                onChange={(event) =>
                  onChange(updateQuestion(value, index, { prompt: event.target.value }))
                }
              />
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="font-medium text-[var(--field-label)]">Tipo da {at}</span>
                  <select
                    className={SELECT_CLASS}
                    value={question.kind}
                    disabled={readOnly}
                    onChange={(event) =>
                      onChange(
                        setQuestionKind(value, index, event.target.value as 'single' | 'multiple'),
                      )
                    }
                  >
                    <option value="single">Escolha única</option>
                    <option value="multiple">Múltipla escolha</option>
                  </select>
                </label>
                <TextField
                  label={`Pontos da ${at}`}
                  type="number"
                  min={1}
                  max={100}
                  value={String(question.points)}
                  disabled={readOnly}
                  onChange={(event) =>
                    onChange(
                      updateQuestion(value, index, {
                        points: Math.max(
                          1,
                          Math.min(100, Math.trunc(Number(event.target.value) || 1)),
                        ),
                      }),
                    )
                  }
                />
              </div>

              <ol className="grid gap-2" aria-label={`Opções da ${at}`}>
                {question.options.map((option, optionIndex) => (
                  <li key={option.id} className="flex flex-wrap items-end gap-3">
                    <div className="min-w-48 flex-1">
                      <TextField
                        label={`Texto da opção ${optionIndex + 1} (${at})`}
                        value={option.text}
                        disabled={readOnly}
                        onChange={(event) =>
                          onChange(updateOptionText(value, index, optionIndex, event.target.value))
                        }
                      />
                    </div>
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={option.correct}
                        disabled={readOnly}
                        onChange={(event) =>
                          onChange(
                            setOptionCorrect(value, index, optionIndex, event.target.checked),
                          )
                        }
                      />
                      <span>
                        A opção {optionIndex + 1} da {at} é correta
                      </span>
                    </label>
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Remover a opção ${optionIndex + 1} da ${at}`}
                        onClick={() => {
                          onChange(removeOption(value, index, optionIndex));
                          announce(`Opção ${optionIndex + 1} da ${at} removida.`);
                        }}
                      >
                        Remover opção
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ol>

              {!readOnly ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={question.options.length >= 10}
                    onClick={() => {
                      onChange(addOption(value, index, newId));
                      announce(`Opção adicionada à ${at}.`);
                    }}
                  >
                    Adicionar opção à {at}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={index === 0}
                    aria-label={`Subir a ${at}`}
                    onClick={() => {
                      onChange(moveQuestion(value, index, 'up'));
                      announce(`Questão ${index + 1} movida para a posição ${index}.`);
                    }}
                  >
                    Subir
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={index === value.questions.length - 1}
                    aria-label={`Descer a ${at}`}
                    onClick={() => {
                      onChange(moveQuestion(value, index, 'down'));
                      announce(`Questão ${index + 1} movida para a posição ${index + 2}.`);
                    }}
                  >
                    Descer
                  </Button>
                  <ConfirmButton
                    label={`Remover a ${at}`}
                    confirmLabel="Confirmar remoção da questão"
                    disabled={false}
                    onConfirm={() => {
                      onChange(removeQuestion(value, index));
                      announce(`Questão ${index + 1} removida.`);
                    }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!readOnly ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={value.questions.length >= 50}
            onClick={() => {
              onChange(addQuestion(value, newId));
              announce('Questão adicionada ao fim do quiz.');
            }}
          >
            Adicionar questão ao quiz da {where}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
