import { zodResolver } from '@hookform/resolvers/zod';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  canTransitionCourse,
  type CourseStatus,
  type StaffCourseDto,
} from '../../features/catalog/catalog';
import { updateDetails, type EditableDraft } from '../../features/catalog/draft-edit';
import { courseMetaFormSchema, type CourseMetaFormValues } from '../../features/catalog/forms';
import { setCourseStatus, updateCourseMeta } from '../api/catalog';
import { ConfirmButton } from '../components/confirm-button';
import { RichTextView } from '../components/rich-text/rich-text-view';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/field';

const RichTextEditor = lazy(() =>
  import('../components/rich-text/rich-text-editor').then((module) => ({
    default: module.RichTextEditor,
  })),
);

const STATUS_LABELS: Record<CourseStatus, string> = {
  draft: 'Rascunho (não aparece no catálogo)',
  published: 'Publicado (aparece no catálogo)',
  archived: 'Arquivado (fora do catálogo; os direitos de quem já tem acesso continuam)',
};

interface DetailsTabProps {
  course: StaffCourseDto;
  draft: EditableDraft;
  onChange: (next: EditableDraft) => void;
  /** Sem `course.edit`: tudo só para leitura. */
  readOnly: boolean;
  /** Troca ao recarregar o rascunho: remonta o editor da descrição. */
  reloadToken: number;
  /** O curso mudou no servidor (título, slug ou estado): a tela recarrega. */
  onCourseChanged: () => void;
}

/**
 * Detalhes (M2-03): identificação interna (título e endereço, em formulário próprio), o texto PÚBLICO
 * do rascunho (título, descrição rica e carga horária, salvos junto do currículo) e a visibilidade
 * do curso no catálogo. Publicar o curso no catálogo é separado de publicar o currículo.
 */
export function DetailsTab({
  course,
  draft,
  onChange,
  readOnly,
  reloadToken,
  onCourseChanged,
}: DetailsTabProps) {
  const [metaMessage, setMetaMessage] = useState<
    { kind: 'ok' | 'error'; text: string } | undefined
  >();
  const [statusMessage, setStatusMessage] = useState<
    { kind: 'ok' | 'error'; text: string } | undefined
  >();
  const [busy, setBusy] = useState(false);
  const locked = course.firstPublishedAt !== null;

  const form = useForm<CourseMetaFormValues>({
    resolver: zodResolver(courseMetaFormSchema),
    defaultValues: { title: course.title, slug: course.slug },
  });
  useEffect(() => {
    form.reset({ title: course.title, slug: course.slug });
  }, [course.title, course.slug, form]);
  const errors = form.formState.errors;

  async function saveMeta(values: CourseMetaFormValues) {
    setMetaMessage(undefined);
    const changes: { title?: string; slug?: string } = {};
    if (values.title !== course.title) changes.title = values.title;
    if (values.slug !== course.slug) changes.slug = values.slug;
    if (Object.keys(changes).length === 0) {
      setMetaMessage({ kind: 'ok', text: 'Nada mudou.' });
      return;
    }
    const outcome = await updateCourseMeta(course.id, changes);
    if (outcome.result === 'ok') {
      setMetaMessage({ kind: 'ok', text: 'Identificação salva.' });
      onCourseChanged();
      return;
    }
    if (outcome.code === 'slug_taken') {
      form.setError('slug', { message: 'Já existe um curso com este endereço.' });
    } else if (outcome.code === 'slug_locked') {
      form.setError('slug', { message: 'O endereço não muda depois da primeira publicação.' });
    } else if (outcome.result === 'forbidden') {
      setMetaMessage({ kind: 'error', text: 'Você não tem permissão para editar este curso.' });
    } else {
      setMetaMessage({ kind: 'error', text: 'Não foi possível salvar agora. Tente novamente.' });
    }
  }

  async function changeStatus(status: CourseStatus, success: string) {
    setBusy(true);
    setStatusMessage(undefined);
    const outcome = await setCourseStatus(course.id, status);
    setBusy(false);
    if (outcome.result === 'ok') {
      setStatusMessage({ kind: 'ok', text: success });
      onCourseChanged();
    } else {
      setStatusMessage({
        kind: 'error',
        text:
          outcome.result === 'forbidden'
            ? 'Você não tem permissão para mudar a visibilidade deste curso.'
            : 'Não foi possível mudar agora. Tente novamente.',
      });
    }
  }

  return (
    <div className="grid max-w-2xl gap-12">
      <section aria-labelledby="ident-titulo" className="grid gap-4">
        <h2 id="ident-titulo" className="text-xl font-semibold">
          Identificação interna
        </h2>
        <form noValidate onSubmit={form.handleSubmit(saveMeta)} className="grid gap-4">
          <TextField
            label="Título interno"
            disabled={readOnly}
            error={errors.title?.message}
            {...form.register('title')}
          />
          <TextField
            label="Endereço (slug)"
            description={
              locked
                ? 'Bloqueado: o curso já foi publicado e o endereço não muda mais.'
                : 'Pode mudar até a primeira publicação.'
            }
            disabled={readOnly || locked}
            error={errors.slug?.message}
            {...form.register('slug')}
          />
          <p className="text-sm text-[var(--text-muted)]">
            Como as aulas se liberam:{' '}
            {course.sequenceMode === 'guided' ? 'guiada (na ordem do curso)' : 'livre'}. Não muda
            depois de criado.
          </p>
          {metaMessage ? (
            <p
              role={metaMessage.kind === 'ok' ? 'status' : 'alert'}
              className={
                metaMessage.kind === 'ok'
                  ? 'font-medium text-[var(--text-success)]'
                  : 'font-medium text-[var(--text-danger)]'
              }
            >
              {metaMessage.text}
            </p>
          ) : null}
          {!readOnly ? (
            <div>
              <Button type="submit" variant="secondary" disabled={form.formState.isSubmitting}>
                Salvar identificação
              </Button>
            </div>
          ) : null}
        </form>
      </section>

      <section aria-labelledby="publico-titulo" className="grid gap-4">
        <h2 id="publico-titulo" className="text-xl font-semibold">
          Texto público (rascunho)
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Salvo junto do currículo, em "Salvar rascunho", e só aparece para o público depois de
          publicar o currículo.
        </p>
        <TextField
          label="Título público"
          value={draft.details.displayTitle}
          disabled={readOnly}
          onChange={(event) => onChange(updateDetails(draft, { displayTitle: event.target.value }))}
        />
        <TextField
          label="Carga horária (horas)"
          type="number"
          min={1}
          max={10000}
          value={draft.details.workloadHours === null ? '' : String(draft.details.workloadHours)}
          disabled={readOnly}
          onChange={(event) =>
            onChange(
              updateDetails(draft, {
                workloadHours:
                  event.target.value === '' ? null : Math.trunc(Number(event.target.value)),
              }),
            )
          }
        />
        <div className="grid gap-2">
          <p className="font-medium">Descrição</p>
          {readOnly ? (
            <RichTextView value={draft.details.description} className="max-w-prose" />
          ) : (
            <Suspense fallback={<p role="status">Carregando editor…</p>}>
              <RichTextEditor
                key={reloadToken}
                initialValue={draft.details.description}
                label="Descrição do curso"
                onChange={(description) => onChange(updateDetails(draft, { description }))}
              />
            </Suspense>
          )}
        </div>
      </section>

      <section aria-labelledby="visib-titulo" className="grid gap-4">
        <h2 id="visib-titulo" className="text-xl font-semibold">
          Visibilidade no catálogo
        </h2>
        <p>
          Estado atual: <strong>{STATUS_LABELS[course.status]}</strong>
        </p>
        <p className="text-sm text-[var(--text-muted)]">
          O curso só pode ser adquirido com o currículo publicado e pelo menos uma oferta ativa.
        </p>
        {statusMessage ? (
          <p
            role={statusMessage.kind === 'ok' ? 'status' : 'alert'}
            className={
              statusMessage.kind === 'ok'
                ? 'font-medium text-[var(--text-success)]'
                : 'font-medium text-[var(--text-danger)]'
            }
          >
            {statusMessage.text}
          </p>
        ) : null}
        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            {canTransitionCourse(course.status, 'published') ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void changeStatus(
                    'published',
                    course.status === 'archived'
                      ? 'Curso republicado no catálogo.'
                      : 'Curso publicado no catálogo.',
                  )
                }
              >
                {course.status === 'archived' ? 'Republicar no catálogo' : 'Publicar no catálogo'}
              </Button>
            ) : null}
            {canTransitionCourse(course.status, 'archived') ? (
              <ConfirmButton
                label="Arquivar o curso"
                confirmLabel="Confirmar arquivamento"
                disabled={busy}
                onConfirm={() => void changeStatus('archived', 'Curso arquivado.')}
              />
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
