import type { EditableDraft } from '../../features/catalog/draft-edit';
import { RichTextView } from '../components/rich-text/rich-text-view';

/**
 * Pré-visualização do RASCUNHO (M2-03) com o MESMO renderizador do que o aluno verá (`RichTextView`):
 * título público, carga horária, descrição e, módulo a módulo, as aulas com o texto. Mostra o que está
 * na tela agora, inclusive o que ainda não foi salvo. Todo texto passa pelo React (nenhum HTML em string).
 */
export function PreviewTab({ draft }: { draft: EditableDraft }) {
  return (
    <article className="grid max-w-prose gap-8" aria-label="Pré-visualização do curso">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold">
          {draft.details.displayTitle || 'Curso sem título público'}
        </h2>
        {draft.details.workloadHours !== null ? (
          <p className="text-sm text-[var(--text-muted)]">
            Carga horária: {draft.details.workloadHours} h
          </p>
        ) : null}
        <RichTextView value={draft.details.description} />
      </header>
      {draft.modules.length === 0 ? <p>O curso ainda não tem módulos.</p> : null}
      {draft.modules.map((module, moduleIndex) => (
        <section key={module.key} aria-label={`Módulo ${moduleIndex + 1}`} className="grid gap-4">
          <h3 className="text-xl font-semibold">
            {module.title || `Módulo ${moduleIndex + 1} sem título`}
            {module.dripDays > 0 ? (
              <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
                (libera após {module.dripDays} {module.dripDays === 1 ? 'dia' : 'dias'})
              </span>
            ) : null}
          </h3>
          {module.lessons.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Módulo sem aulas.</p>
          ) : null}
          {module.lessons.map((lesson, lessonIndex) => (
            <div key={lesson.key} className="grid gap-2 rounded-lg border p-4">
              <h4 className="font-semibold">
                {lesson.title || `Aula ${lessonIndex + 1} sem título`}
                {lesson.isOptional ? (
                  <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
                    (opcional)
                  </span>
                ) : null}
              </h4>
              <RichTextView value={lesson.body} />
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
