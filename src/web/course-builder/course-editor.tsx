import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';

import {
  isDirty,
  toEditable,
  toPayload,
  type EditableDraft,
} from '../../features/catalog/draft-edit';
import { fetchCourse, fetchDraft, saveDraft } from '../api/catalog';
import { ForbiddenError } from '../api/staff';
import { Button } from '../components/ui/button';
import { useAccess } from '../hooks/use-access';
import { CurriculumTab } from './curriculum-tab';
import { DetailsTab } from './details-tab';
import { EnrollmentsTab } from './enrollments-tab';
import { OffersTab } from './offers-tab';
import { PreviewTab } from './preview-tab';
import { PublishPanel } from './publish-panel';
import { Tabs, type TabDef } from './tabs';

type TabId = 'detalhes' | 'curriculo' | 'oferta' | 'inscritos' | 'previa' | 'publicar';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; text: string }
  | { kind: 'conflict'; currentRev: number };

/**
 * Editor do curso (M2-03): abas Detalhes, Currículo, Oferta (só Admin), Pré-visualização e Publicar.
 * O rascunho (detalhes públicos + módulos e aulas) fica na memória e só vai ao servidor em "Salvar
 * rascunho", com o `expectedRev` que a tela leu: se outra pessoa salvou antes, o servidor responde
 * 409 e a tela oferece recarregar. Sair com alterações não salvas pede confirmação. A interface só
 * ESCONDE o que a pessoa não pode fazer; o servidor decide cada escrita.
 */
export function CourseEditor({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const access = useAccess();
  const course = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => fetchCourse(courseId),
    retry: false,
  });
  const server = useQuery({
    queryKey: ['draft', courseId],
    queryFn: () => fetchDraft(courseId),
    retry: false,
    // O rascunho local não pode ser sobrescrito por um refetch em segundo plano.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const [draft, setDraft] = useState<EditableDraft | null>(null);
  const [saved, setSaved] = useState<EditableDraft | null>(null);
  const [rev, setRev] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState<TabId>('detalhes');
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (server.data && saved === null) {
      const editable = toEditable(server.data);
      setDraft(editable);
      setSaved(editable);
      setRev(server.data.rev);
    }
  }, [server.data, saved]);

  const dirty = draft !== null && saved !== null && isDirty(draft, saved);
  const canEdit = access.has('course.edit');
  const canOffers = access.has('offer.manage');

  useBlocker({
    shouldBlockFn: () =>
      dirty ? !window.confirm('Há alterações não salvas. Sair mesmo assim?') : false,
    enableBeforeUnload: () => dirty,
  });

  const reloadDraft = useCallback(async () => {
    const fresh = await fetchDraft(courseId);
    const editable = toEditable(fresh);
    setDraft(editable);
    setSaved(editable);
    setRev(fresh.rev);
    setReloadToken((value) => value + 1);
    setSaveState({ kind: 'idle' });
    await queryClient.invalidateQueries({ queryKey: ['publish-preview', courseId] });
  }, [courseId, queryClient]);

  const courseChanged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['course', courseId] });
    void queryClient.invalidateQueries({ queryKey: ['courses'] });
    void queryClient.invalidateQueries({ queryKey: ['publish-preview', courseId] });
  }, [courseId, queryClient]);

  async function save() {
    if (!draft) return;
    setSaveState({ kind: 'saving' });
    const outcome = await saveDraft(courseId, toPayload(draft, rev));
    if (outcome.result === 'ok' && outcome.data) {
      const editable = toEditable(outcome.data);
      setDraft(editable);
      setSaved(editable);
      setRev(outcome.data.rev);
      setReloadToken((value) => value + 1);
      setSaveState({ kind: 'saved' });
      void queryClient.invalidateQueries({ queryKey: ['publish-preview', courseId] });
      return;
    }
    if (outcome.code === 'draft_conflict') {
      setSaveState({ kind: 'conflict', currentRev: outcome.error?.currentRev ?? rev });
      return;
    }
    setSaveState({
      kind: 'error',
      text:
        outcome.result === 'forbidden'
          ? 'Você não tem permissão para editar este curso.'
          : outcome.code === 'unknown_id'
            ? 'O rascunho mudou no servidor. Recarregue e refaça a alteração.'
            : outcome.result === 'unauthenticated'
              ? 'Sua sessão expirou. Entre novamente.'
              : 'Não foi possível salvar agora. Tente novamente.',
    });
  }

  if (course.error instanceof ForbiddenError || server.error instanceof ForbiddenError) {
    return <p role="alert">Você não tem permissão para ver este curso.</p>;
  }
  if (course.isPending || server.isPending || !draft || !course.data) {
    if (course.isError || server.isError) {
      return (
        <>
          <p role="alert" className="mb-4 font-medium text-[var(--text-danger)]">
            Não foi possível carregar o curso agora.
          </p>
          <Link to="/staff/cursos">Voltar para a lista</Link>
        </>
      );
    }
    return <p role="status">Carregando…</p>;
  }

  const tabs: TabDef<TabId>[] = [
    { id: 'detalhes', label: 'Detalhes' },
    { id: 'curriculo', label: 'Currículo' },
    ...(canOffers ? [{ id: 'oferta' as const, label: 'Oferta' }] : []),
    { id: 'inscritos', label: 'Inscritos' },
    { id: 'previa', label: 'Pré-visualização' },
    { id: 'publicar', label: 'Publicar' },
  ];
  const activeTab = tabs.some((item) => item.id === tab) ? tab : 'detalhes';

  return (
    <>
      <p className="mb-2">
        <Link to="/staff/cursos">← Cursos</Link>
      </p>
      <h1 className="mb-2 text-3xl font-semibold">{course.data.title}</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">
        {canEdit
          ? 'Edite o rascunho e publique quando estiver pronto.'
          : 'Você tem acesso só de leitura a este curso.'}
      </p>

      <div
        className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border p-3"
        aria-label="Rascunho"
      >
        {canEdit ? (
          <Button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saveState.kind === 'saving'}
          >
            {saveState.kind === 'saving' ? 'Salvando…' : 'Salvar rascunho'}
          </Button>
        ) : null}
        <p role="status" className="font-medium">
          {dirty
            ? 'Alterações não salvas.'
            : saveState.kind === 'saved'
              ? 'Rascunho salvo.'
              : 'Rascunho sem alterações.'}
        </p>
      </div>

      {saveState.kind === 'conflict' ? (
        <div role="alert" className="mb-6 grid max-w-prose gap-3 rounded-lg border p-4">
          <p className="font-medium">
            Outra pessoa salvou este rascunho depois que você o abriu. Para não sobrescrever o
            trabalho dela, recarregue a versão atual (as suas alterações não salvas serão
            descartadas).
          </p>
          <div>
            <Button type="button" variant="secondary" onClick={() => void reloadDraft()}>
              Recarregar o rascunho atual
            </Button>
          </div>
        </div>
      ) : null}
      {saveState.kind === 'error' ? (
        <p role="alert" className="mb-6 font-medium text-[var(--text-danger)]">
          {saveState.text}
        </p>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <Tabs tabs={tabs} active={activeTab} onChange={setTab} label="Seções do curso">
        {activeTab === 'detalhes' ? (
          <DetailsTab
            course={course.data}
            draft={draft}
            onChange={setDraft}
            readOnly={!canEdit}
            reloadToken={reloadToken}
            onCourseChanged={courseChanged}
          />
        ) : null}
        {activeTab === 'curriculo' ? (
          <CurriculumTab
            draft={draft}
            onChange={setDraft}
            readOnly={!canEdit}
            announce={setAnnouncement}
          />
        ) : null}
        {activeTab === 'oferta' && canOffers ? (
          <OffersTab course={course.data} onChanged={courseChanged} />
        ) : null}
        {activeTab === 'inscritos' ? <EnrollmentsTab courseId={courseId} /> : null}
        {activeTab === 'previa' ? <PreviewTab draft={draft} /> : null}
        {activeTab === 'publicar' ? (
          <PublishPanel
            courseId={courseId}
            dirty={dirty}
            canPublish={canEdit}
            onPublished={courseChanged}
          />
        ) : null}
      </Tabs>
    </>
  );
}
