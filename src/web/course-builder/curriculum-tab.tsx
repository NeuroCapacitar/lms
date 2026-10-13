import { lazy, Suspense, useEffect, useState } from 'react';

import {
  addLesson,
  addModule,
  moveLesson,
  moveLessonToModule,
  moveModule,
  removeLesson,
  removeModule,
  updateLesson,
  updateModule,
  type Direction,
  type EditableDraft,
} from '../../features/catalog/draft-edit';
import { emptyQuiz } from '../../features/quiz/quiz';
import { ConfirmButton } from '../components/confirm-button';
import { RichTextView } from '../components/rich-text/rich-text-view';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';
import { QuizEditor } from './quiz-editor';

// O editor (Tiptap) só carrega quando alguém abre o texto de uma aula.
const RichTextEditor = lazy(() =>
  import('../components/rich-text/rich-text-editor').then((module) => ({
    default: module.RichTextEditor,
  })),
);

const newKey = () => crypto.randomUUID();

interface CurriculumTabProps {
  draft: EditableDraft;
  onChange: (next: EditableDraft) => void;
  readOnly: boolean;
  /** Anuncia a mudança de ordem para leitores de tela (região `aria-live`). */
  announce: (message: string) => void;
}

/**
 * Currículo (M2-03): módulos e aulas do RASCUNHO. Reordenar é por BOTÕES (subir e descer, sem
 * arrastar), cada mudança é anunciada por `aria-live` e o foco acompanha o item movido. Mover aula
 * entre módulos mantém a mesma aula (e o mesmo id). Nada é salvo até "Salvar rascunho".
 */
export function CurriculumTab({ draft, onChange, readOnly, announce }: CurriculumTabProps) {
  const [openBodies, setOpenBodies] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | undefined>();

  useEffect(() => {
    if (!focusId) return;
    const element = document.getElementById(focusId) as HTMLButtonElement | null;
    // Se o botão ficou desabilitado (chegou à borda), o foco vai para o par.
    if (element && !element.disabled) element.focus();
    else if (element) {
      const sibling = document.getElementById(
        focusId.endsWith('-up')
          ? focusId.replace(/-up$/, '-down')
          : focusId.replace(/-down$/, '-up'),
      );
      sibling?.focus();
    }
    setFocusId(undefined);
  }, [focusId, draft]);

  function toggleBody(key: string) {
    setOpenBodies((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function moveModuleBy(index: number, direction: Direction) {
    const next = moveModule(draft, index, direction);
    if (next === draft) return;
    const to = direction === 'up' ? index - 1 : index + 1;
    onChange(next);
    announce(
      `Módulo "${draft.modules[index]!.title || `sem título ${index + 1}`}" movido para a posição ${to + 1} de ${draft.modules.length}.`,
    );
    setFocusId(`mod-${draft.modules[index]!.key}-${direction}`);
  }

  function moveLessonBy(moduleIndex: number, lessonIndex: number, direction: Direction) {
    const next = moveLesson(draft, moduleIndex, lessonIndex, direction);
    if (next === draft) return;
    const lesson = draft.modules[moduleIndex]!.lessons[lessonIndex]!;
    const to = direction === 'up' ? lessonIndex - 1 : lessonIndex + 1;
    onChange(next);
    announce(
      `Aula "${lesson.title || `sem título ${lessonIndex + 1}`}" movida para a posição ${to + 1} de ${draft.modules[moduleIndex]!.lessons.length} no módulo ${moduleIndex + 1}.`,
    );
    setFocusId(`les-${lesson.key}-${direction}`);
  }

  return (
    <div className="grid gap-6">
      {draft.modules.length === 0 ? <p>Este curso ainda não tem módulos.</p> : null}
      <ol className="grid gap-6" aria-label="Módulos do curso">
        {draft.modules.map((module, moduleIndex) => (
          <li key={module.key} className="grid gap-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-end gap-4">
              <h3 className="text-lg font-semibold">Módulo {moduleIndex + 1}</h3>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_12rem]">
              <TextField
                label={`Título do módulo ${moduleIndex + 1}`}
                value={module.title}
                disabled={readOnly}
                onChange={(event) =>
                  onChange(updateModule(draft, moduleIndex, { title: event.target.value }))
                }
              />
              <TextField
                label={`Liberar após (dias), módulo ${moduleIndex + 1}`}
                description="D+N: 0 libera de imediato."
                type="number"
                min={0}
                max={3650}
                value={String(module.dripDays)}
                disabled={readOnly}
                onChange={(event) =>
                  onChange(
                    updateModule(draft, moduleIndex, {
                      dripDays: Math.max(
                        0,
                        Math.min(3650, Math.trunc(Number(event.target.value) || 0)),
                      ),
                    }),
                  )
                }
              />
            </div>
            {!readOnly ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  id={`mod-${module.key}-up`}
                  disabled={moduleIndex === 0}
                  aria-label={`Subir o módulo ${moduleIndex + 1}`}
                  onClick={() => moveModuleBy(moduleIndex, 'up')}
                >
                  Subir
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  id={`mod-${module.key}-down`}
                  disabled={moduleIndex === draft.modules.length - 1}
                  aria-label={`Descer o módulo ${moduleIndex + 1}`}
                  onClick={() => moveModuleBy(moduleIndex, 'down')}
                >
                  Descer
                </Button>
                <ConfirmButton
                  label={`Remover o módulo ${moduleIndex + 1}`}
                  confirmLabel="Confirmar remoção do módulo"
                  disabled={false}
                  onConfirm={() => {
                    onChange(removeModule(draft, moduleIndex));
                    announce(`Módulo ${moduleIndex + 1} removido do rascunho.`);
                  }}
                />
              </div>
            ) : null}

            <ol className="grid gap-4" aria-label={`Aulas do módulo ${moduleIndex + 1}`}>
              {module.lessons.map((lesson, lessonIndex) => (
                <li key={lesson.key} className="grid gap-3 rounded-lg border p-3">
                  <TextField
                    label={`Título da aula ${lessonIndex + 1} do módulo ${moduleIndex + 1}`}
                    value={lesson.title}
                    disabled={readOnly}
                    onChange={(event) =>
                      onChange(
                        updateLesson(draft, moduleIndex, lessonIndex, {
                          title: event.target.value,
                        }),
                      )
                    }
                  />
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={lesson.isOptional}
                      disabled={readOnly}
                      onChange={(event) =>
                        onChange(
                          updateLesson(draft, moduleIndex, lessonIndex, {
                            isOptional: event.target.checked,
                          }),
                        )
                      }
                    />
                    <span>
                      Aula opcional (aula {lessonIndex + 1} do módulo {moduleIndex + 1})
                    </span>
                  </label>
                  {!readOnly ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        id={`les-${lesson.key}-up`}
                        disabled={lessonIndex === 0}
                        aria-label={`Subir a aula ${lessonIndex + 1} do módulo ${moduleIndex + 1}`}
                        onClick={() => moveLessonBy(moduleIndex, lessonIndex, 'up')}
                      >
                        Subir
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        id={`les-${lesson.key}-down`}
                        disabled={lessonIndex === module.lessons.length - 1}
                        aria-label={`Descer a aula ${lessonIndex + 1} do módulo ${moduleIndex + 1}`}
                        onClick={() => moveLessonBy(moduleIndex, lessonIndex, 'down')}
                      >
                        Descer
                      </Button>
                      {draft.modules.length > 1 ? (
                        <label className="flex items-center gap-2">
                          <span className="text-sm">
                            Mover a aula {lessonIndex + 1} do módulo {moduleIndex + 1} para
                          </span>
                          <select
                            className="min-h-11 rounded-lg border bg-[var(--input-bg)] px-2 text-[var(--input-fg)]"
                            value=""
                            onChange={(event) => {
                              const to = Number(event.target.value);
                              if (Number.isNaN(to)) return;
                              onChange(moveLessonToModule(draft, moduleIndex, lessonIndex, to));
                              announce(
                                `Aula "${lesson.title || `sem título ${lessonIndex + 1}`}" movida para o módulo ${to + 1}.`,
                              );
                            }}
                          >
                            <option value="">Escolha o módulo</option>
                            {draft.modules.map((target, targetIndex) =>
                              targetIndex === moduleIndex ? null : (
                                <option key={target.key} value={targetIndex}>
                                  Módulo {targetIndex + 1}
                                  {target.title ? `: ${target.title}` : ''}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      ) : null}
                      <ConfirmButton
                        label={`Remover a aula ${lessonIndex + 1} do módulo ${moduleIndex + 1}`}
                        confirmLabel="Confirmar remoção da aula"
                        disabled={false}
                        onConfirm={() => {
                          onChange(removeLesson(draft, moduleIndex, lessonIndex));
                          announce(
                            `Aula ${lessonIndex + 1} removida do módulo ${moduleIndex + 1}.`,
                          );
                        }}
                      />
                    </div>
                  ) : null}
                  {lesson.kind === 'quiz' ? (
                    <div className="grid gap-3">
                      <QuizEditor
                        value={lesson.quiz ?? emptyQuiz()}
                        readOnly={readOnly}
                        where={`aula ${lessonIndex + 1} do módulo ${moduleIndex + 1}`}
                        announce={announce}
                        onChange={(quiz) =>
                          onChange(updateLesson(draft, moduleIndex, lessonIndex, { quiz }))
                        }
                      />
                      {!readOnly ? (
                        <div>
                          <ConfirmButton
                            label={`Converter a aula ${lessonIndex + 1} do módulo ${moduleIndex + 1} em texto`}
                            confirmLabel="Confirmar: apagar o quiz e virar aula de texto"
                            disabled={false}
                            onConfirm={() => {
                              onChange(
                                updateLesson(draft, moduleIndex, lessonIndex, {
                                  kind: 'text',
                                  quiz: null,
                                }),
                              );
                              announce(`Aula ${lessonIndex + 1} convertida em aula de texto.`);
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : lesson.kind === 'video' ? (
                    <p className="text-sm text-[var(--text-muted)]">Aula de vídeo.</p>
                  ) : !readOnly ? (
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          onChange(
                            updateLesson(draft, moduleIndex, lessonIndex, {
                              kind: 'quiz',
                              quiz: emptyQuiz(),
                            }),
                          );
                          announce(`Aula ${lessonIndex + 1} agora é uma aula de quiz.`);
                        }}
                      >
                        {`Transformar a aula ${lessonIndex + 1} do módulo ${moduleIndex + 1} em quiz`}
                      </Button>
                    </div>
                  ) : null}
                  <div className="grid gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      aria-expanded={openBodies.has(lesson.key)}
                      onClick={() => toggleBody(lesson.key)}
                    >
                      {openBodies.has(lesson.key)
                        ? `Fechar o texto da aula ${lessonIndex + 1} do módulo ${moduleIndex + 1}`
                        : `${readOnly ? 'Ver' : 'Editar'} o texto da aula ${lessonIndex + 1} do módulo ${moduleIndex + 1}`}
                    </Button>
                    {openBodies.has(lesson.key) ? (
                      readOnly ? (
                        <RichTextView value={lesson.body} className="max-w-prose" />
                      ) : (
                        <Suspense fallback={<p role="status">Carregando editor…</p>}>
                          <RichTextEditor
                            initialValue={lesson.body}
                            label={`Texto da aula ${lessonIndex + 1} do módulo ${moduleIndex + 1}`}
                            onChange={(body) =>
                              onChange(updateLesson(draft, moduleIndex, lessonIndex, { body }))
                            }
                          />
                        </Suspense>
                      )
                    ) : (
                      <p className="text-sm text-[var(--text-muted)]">
                        {lesson.body ? 'Tem texto.' : 'Sem texto ainda.'}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {!readOnly ? (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    onChange(addLesson(draft, moduleIndex, newKey()));
                    announce(`Aula adicionada ao fim do módulo ${moduleIndex + 1}.`);
                  }}
                >
                  Adicionar aula ao módulo {moduleIndex + 1}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {!readOnly ? (
        <div>
          <Button
            type="button"
            onClick={() => {
              onChange(addModule(draft, newKey()));
              announce('Módulo adicionado ao fim do curso.');
            }}
          >
            Adicionar módulo
          </Button>
        </div>
      ) : null}
    </div>
  );
}
