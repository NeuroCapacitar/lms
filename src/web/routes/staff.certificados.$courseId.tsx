import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';

import {
  ALIGNS,
  FIELD_LABELS,
  WEIGHTS,
  WORST_CASE,
  defaultLayout,
  fieldOf,
  isTextField,
  layoutProblems,
  type CertificateLayout,
  type FieldId,
  type LayoutField,
  type LayoutProblem,
} from '../../features/certificate/layout';
import { MIME_BY_KIND } from '../../features/media/media';
import {
  discardTemplateDraft,
  fetchSignatory,
  fetchTemplates,
  publishTemplate,
  saveTemplateDraft,
} from '../api/certificate';
import { uploadMedia } from '../api/media';
import { ForbiddenError } from '../api/http';
import { Button } from '../components/ui/button';
import { CertificateCanvas } from '../certificate/canvas';
import { useMediaQuery } from '../hooks/use-media-query';

export const Route = createFileRoute('/staff/certificados/$courseId')({
  component: TemplateEditorPage,
});

const SAMPLE_SHORT: Partial<Record<FieldId, string>> = {
  title: 'Certificado de conclusão',
  intro: 'Certificamos que',
  holderName: 'Ana Souza',
  body: 'concluiu o curso Curso de Exemplo, com carga horária de 20 horas, em 14 de outubro de 2026.',
  signatory: 'Dra. Ana Lima\nDiretora Acadêmica',
  issuer: 'Emitido por Neuro Capacitar LTDA\nCNPJ 11.222.333/0001-81\nem 14 de outubro de 2026',
  code: 'Código AbCdEfGhIjKlMnOpQrStUv\nhttps://hub.example/certificados/AbCdEfGhIjKlMnOpQrStUv',
};
const SAMPLE_LONG: Partial<Record<FieldId, string>> = { ...SAMPLE_SHORT, ...WORST_CASE };

const PROBLEM_TEXT: Record<LayoutProblem['code'], string> = {
  out_of_page: 'está fora da página',
  inside_frame: 'invade a moldura da borda',
  overlap: 'se sobrepõe a',
  text_overflow: 'não cabe com o nome mais longo',
};

const FAILURES: Record<string, string> = {
  conflict:
    'Outro Admin alterou este rascunho. Recarregue a página para ver a versão mais recente antes de salvar.',
  layout_invalid: 'Há campo fora da página ou sobre a moldura. Corrija os erros antes de publicar.',
  invalid_request: 'O layout não é válido. Confira os números e as cores.',
  invalid_media: 'A imagem não serve como fundo. Envie um PNG, JPEG ou WebP de até 3 MB.',
  media_not_ready: 'A imagem ainda não está pronta. Envie de novo.',
  media_not_configured: 'O armazenamento de imagens ainda não está ativo neste ambiente.',
  draft_missing: 'Não há rascunho para publicar. Salve antes.',
  forbidden: 'Só o Admin edita o template do certificado.',
  not_found: 'O curso não existe mais.',
};

function TemplateEditorPage() {
  const { courseId } = Route.useParams();
  const templates = useQuery({
    queryKey: ['certificate-template', courseId],
    queryFn: () => fetchTemplates(courseId),
    retry: false,
  });
  const signatory = useQuery({
    queryKey: ['certificate-signatory', courseId],
    queryFn: () => fetchSignatory(courseId),
    retry: false,
  });
  return (
    <>
      <p className="mb-2">
        <Link to="/staff/certificados" className="underline">
          Voltar aos certificados
        </Link>
      </p>
      <h1 className="mb-2 text-3xl font-semibold">Template do certificado</h1>
      {templates.error instanceof ForbiddenError ? (
        <p role="alert">Só o Admin edita o template do certificado.</p>
      ) : templates.isPending ? (
        <p role="status">Carregando…</p>
      ) : templates.isError ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Não foi possível carregar o template. Tente de novo.
        </p>
      ) : (
        <Editor
          key={`${templates.data.draft?.id ?? 'sem'}:${templates.data.draft?.version ?? 0}:${templates.data.published?.id ?? 'sem'}`}
          courseId={courseId}
          draft={templates.data.draft}
          published={templates.data.published}
          signatureMediaId={signatory.data?.signatureMediaId ?? null}
        />
      )}
    </>
  );
}

interface History {
  items: { layout: CertificateLayout; backgroundMediaId: string | null }[];
  cursor: number;
}

const LIMIT = 100;
const ACCEPT = [MIME_BY_KIND.png, MIME_BY_KIND.jpeg, MIME_BY_KIND.webp].join(',');

function Editor({
  courseId,
  draft,
  published,
  signatureMediaId,
}: {
  courseId: string;
  draft: { layout: CertificateLayout; backgroundMediaId: string | null; version: number } | null;
  published: {
    layout: CertificateLayout;
    backgroundMediaId: string | null;
    publishedAt: string | null;
  } | null;
  signatureMediaId: string | null;
}) {
  const queryClient = useQueryClient();
  const wide = useMediaQuery('(min-width: 768px)');
  const initial = draft ?? published ?? { layout: defaultLayout(), backgroundMediaId: null };
  const [history, setHistory] = useState<History>({
    items: [{ layout: initial.layout, backgroundMediaId: initial.backgroundMediaId }],
    cursor: 0,
  });
  const [live, setLive] = useState<CertificateLayout | null>(null);
  const [version, setVersion] = useState<number | null>(draft?.version ?? null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<FieldId | null>('holderName');
  const [longName, setLongName] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const [announce, setAnnounce] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const current = history.items[history.cursor]!;
  const layout = live ?? current.layout;
  const readOnly = !wide;
  const problems = useMemo(() => layoutProblems(layout), [layout]);
  const hasErrors = problems.some((problem) => problem.severity === 'error');
  const problemIds = useMemo(
    () => new Set(problems.flatMap((p) => [p.fieldId, ...(p.otherId ? [p.otherId] : [])])),
    [problems],
  );

  const commitState = useCallback(
    (next: { layout: CertificateLayout; backgroundMediaId: string | null }) => {
      setHistory((previous) => {
        const kept = previous.items.slice(0, previous.cursor + 1);
        kept.push(next);
        const trimmed = kept.length > LIMIT ? kept.slice(kept.length - LIMIT) : kept;
        return { items: trimmed, cursor: trimmed.length - 1 };
      });
      setLive(null);
      setDirty(true);
      setMessage(undefined);
    },
    [],
  );

  const patchField = useCallback(
    (base: CertificateLayout, id: FieldId, patch: Partial<LayoutField>): CertificateLayout => ({
      ...base,
      fields: base.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }),
    [],
  );

  const onLive = (id: FieldId, patch: Partial<LayoutField>) =>
    setLive(patchField(current.layout, id, patch));
  const onCommit = (id: FieldId, patch: Partial<LayoutField>) => {
    const next = patchField(current.layout, id, patch);
    commitState({ layout: next, backgroundMediaId: current.backgroundMediaId });
    const field = fieldOf(next, id);
    setAnnounce(`${FIELD_LABELS[id]}: ${field.x} mm, ${field.y} mm, ${field.w} por ${field.h} mm.`);
  };

  const undo = () => {
    if (history.cursor === 0) return;
    setHistory({ ...history, cursor: history.cursor - 1 });
    setLive(null);
    setDirty(true);
    setAnnounce('Desfeito.');
  };
  const redo = () => {
    if (history.cursor >= history.items.length - 1) return;
    setHistory({ ...history, cursor: history.cursor + 1 });
    setLive(null);
    setDirty(true);
    setAnnounce('Refeito.');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      redo();
    }
  };

  async function chooseBackground(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMessage(undefined);
    const uploaded = await uploadMedia('certificate_asset', file, file.type);
    setUploading(false);
    if (uploaded.ok) {
      commitState({ layout: current.layout, backgroundMediaId: uploaded.media.id });
      return;
    }
    setMessage({
      kind: 'error',
      text:
        uploaded.failure === 'not_configured'
          ? FAILURES.media_not_configured!
          : uploaded.failure === 'invalid_media'
            ? FAILURES.invalid_media!
            : 'Não foi possível enviar a imagem agora.',
    });
  }

  async function reload() {
    await queryClient.invalidateQueries({ queryKey: ['certificate-template', courseId] });
  }

  async function save(): Promise<number | null> {
    setBusy(true);
    setMessage(undefined);
    const outcome = await saveTemplateDraft(courseId, {
      layout: current.layout,
      backgroundMediaId: current.backgroundMediaId,
      expectedVersion: version,
    });
    setBusy(false);
    if (outcome.result === 'ok' && outcome.data) {
      setVersion(outcome.data.draft.version);
      setDirty(false);
      setMessage({ kind: 'ok', text: `Rascunho salvo (versão ${outcome.data.draft.version}).` });
      return outcome.data.draft.version;
    }
    setMessage({
      kind: 'error',
      text:
        (outcome.code ? FAILURES[outcome.code] : undefined) ??
        (outcome.result === 'unauthenticated'
          ? 'Sua sessão expirou. Entre novamente.'
          : 'Não foi possível salvar agora.'),
    });
    return null;
  }

  async function publish() {
    const saved = dirty || version === null ? await save() : version;
    if (saved === null) return;
    setBusy(true);
    const outcome = await publishTemplate(courseId, saved);
    setBusy(false);
    if (outcome.result === 'ok') {
      setMessage({
        kind: 'ok',
        text: 'Template publicado. Vale para os certificados emitidos daqui em diante.',
      });
      await reload();
      return;
    }
    setMessage({
      kind: 'error',
      text:
        (outcome.code ? FAILURES[outcome.code] : undefined) ?? 'Não foi possível publicar agora.',
    });
  }

  async function discard() {
    setBusy(true);
    const outcome = await discardTemplateDraft(courseId);
    setBusy(false);
    if (outcome.result === 'ok') {
      setMessage({ kind: 'ok', text: 'Rascunho descartado.' });
      await reload();
    } else {
      setMessage({ kind: 'error', text: 'Não foi possível descartar agora.' });
    }
  }

  const field = selected ? fieldOf(layout, selected) : null;
  const edit = (patch: Partial<LayoutField>) => {
    if (selected) onCommit(selected, patch);
  };
  const number =
    (key: 'x' | 'y' | 'w' | 'h' | 'fontSize') => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) edit({ [key]: value });
    };

  return (
    <div onKeyDown={onKeyDown} className="grid gap-6">
      <p className="max-w-prose text-[var(--text-muted)]">
        {published
          ? `Template publicado${published.publishedAt ? ` em ${new Date(published.publishedAt).toLocaleDateString('pt-BR')}` : ''}. `
          : 'Ainda não há template publicado: sem ele nenhum certificado é emitido deste curso. '}
        {draft
          ? `Editando o rascunho (versão ${draft.version}).`
          : 'As alterações viram um rascunho.'}
      </p>
      {readOnly ? (
        <p role="note" className="font-medium">
          Em tela estreita o editor só mostra o layout. Abra em uma tela mais larga para editar.
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-3">
          <CertificateCanvas
            layout={layout}
            samples={longName ? SAMPLE_LONG : SAMPLE_SHORT}
            backgroundMediaId={current.backgroundMediaId}
            signatureMediaId={signatureMediaId}
            selected={selected}
            readOnly={readOnly}
            onSelect={setSelected}
            onLive={onLive}
            onCommit={onCommit}
            problemIds={problemIds}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={longName}
                onChange={(event) => setLongName(event.target.checked)}
              />
              Prévia com o texto mais longo
            </label>
            {!readOnly ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={undo}
                  disabled={history.cursor === 0}
                >
                  Desfazer
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={redo}
                  disabled={history.cursor >= history.items.length - 1}
                >
                  Refazer
                </Button>
              </>
            ) : null}
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            Prévia aproximada na tela: o PDF final é gerado pelo servidor com o mesmo layout.
          </p>
        </div>

        {!readOnly ? (
          <aside aria-label="Campo selecionado" className="grid content-start gap-4">
            <h2 className="text-xl font-semibold">
              {selected ? FIELD_LABELS[selected] : 'Selecione um campo'}
            </h2>
            {field && selected ? (
              <fieldset className="grid gap-3">
                <legend className="sr-only">Posição e tamanho em milímetros</legend>
                {(
                  [
                    ['x', 'Esquerda (mm)'],
                    ['y', 'Topo (mm)'],
                    ['w', 'Largura (mm)'],
                    ['h', 'Altura (mm)'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="grid gap-1">
                    <span className="font-medium">{label}</span>
                    <input
                      type="number"
                      step="0.5"
                      className="min-h-11 rounded-lg border px-3"
                      value={field[key]}
                      onChange={number(key)}
                    />
                  </label>
                ))}
                {isTextField(selected) ? (
                  <>
                    <label className="grid gap-1">
                      <span className="font-medium">Corpo (pt)</span>
                      <input
                        type="number"
                        step="0.5"
                        className="min-h-11 rounded-lg border px-3"
                        value={field.fontSize ?? 12}
                        onChange={number('fontSize')}
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="font-medium">Peso</span>
                      <select
                        className="min-h-11 rounded-lg border px-3"
                        value={field.weight ?? 400}
                        onChange={(event) => edit({ weight: Number(event.target.value) })}
                      >
                        {WEIGHTS.map((weight) => (
                          <option key={weight} value={weight}>
                            {weight}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="font-medium">Alinhamento</span>
                      <select
                        className="min-h-11 rounded-lg border px-3"
                        value={field.align ?? 'center'}
                        onChange={(event) =>
                          edit({ align: event.target.value as LayoutField['align'] })
                        }
                      >
                        {ALIGNS.map((align) => (
                          <option key={align} value={align}>
                            {{ left: 'Esquerda', center: 'Centro', right: 'Direita' }[align]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="font-medium">Cor (#rrggbb)</span>
                      <input
                        type="text"
                        className="min-h-11 rounded-lg border px-3"
                        value={field.color ?? '#000000'}
                        maxLength={7}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (/^#[0-9a-fA-F]{6}$/.test(value)) edit({ color: value });
                        }}
                      />
                    </label>
                  </>
                ) : null}
              </fieldset>
            ) : null}

            <div className="grid gap-2">
              <label htmlFor="fundo" className="font-medium">
                Fundo A4 (opcional)
              </label>
              <input
                id="fundo"
                type="file"
                accept={ACCEPT}
                disabled={uploading}
                onChange={(event) => void chooseBackground(event.target.files?.[0])}
              />
              {uploading ? <p role="status">Enviando a imagem…</p> : null}
              {current.backgroundMediaId ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => commitState({ layout: current.layout, backgroundMediaId: null })}
                >
                  Remover o fundo
                </Button>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Nenhum fundo.</p>
              )}
            </div>
          </aside>
        ) : null}
      </div>

      <section aria-labelledby="avisos" className="grid max-w-prose gap-2">
        <h2 id="avisos" className="text-xl font-semibold">
          Avisos do layout
        </h2>
        {problems.length === 0 ? (
          <p>Nenhum problema encontrado.</p>
        ) : (
          <ul className="grid gap-1">
            {problems.map((problem) => (
              <li
                key={`${problem.code}-${problem.fieldId}-${problem.otherId ?? ''}`}
                className={
                  problem.severity === 'error' ? 'font-medium text-[var(--text-danger)]' : ''
                }
              >
                {problem.severity === 'error' ? 'Erro: ' : 'Aviso: '}
                {FIELD_LABELS[problem.fieldId]} {PROBLEM_TEXT[problem.code]}
                {problem.otherId ? ` ${FIELD_LABELS[problem.otherId]}` : ''}.
              </li>
            ))}
          </ul>
        )}
      </section>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => void save()}
            disabled={busy || (!dirty && version !== null)}
          >
            {busy ? 'Salvando…' : 'Salvar rascunho'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void publish()}
            disabled={busy || hasErrors || (!dirty && version === null)}
          >
            Publicar
          </Button>
          {draft ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void discard()}
              disabled={busy}
            >
              Descartar rascunho
            </Button>
          ) : null}
          {hasErrors ? (
            <span className="text-sm text-[var(--text-muted)]">
              Corrija os erros para publicar.
            </span>
          ) : null}
        </div>
      ) : null}
      {message ? (
        message.kind === 'ok' ? (
          <p role="status" className="font-medium">
            {message.text}
          </p>
        ) : (
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            {message.text}
          </p>
        )
      ) : null}
    </div>
  );
}
