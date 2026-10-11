import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';

import { parseRichText, type RichText } from '../../features/content/rich-text';
import { RichTextView } from '../components/rich-text/rich-text-view';

export const Route = createFileRoute('/texto-rico')({ component: RichTextShowcase });

// O editor (Tiptap/ProseMirror) é pesado: só carrega nesta tela.
const RichTextEditor = lazy(() =>
  import('../components/rich-text/rich-text-editor').then((module) => ({
    default: module.RichTextEditor,
  })),
);

/**
 * Vitrine do texto rico (M2-05), no mesmo papel da base visual: editor restrito à allowlist, a
 * visualização montada por elementos React e uma área para colar um JSON qualquer e ver que o que
 * está fora da allowlist é recusado. Sai do ar quando o Course Builder (M2-03) usar os componentes.
 */
function RichTextShowcase() {
  const [doc, setDoc] = useState<RichText | null>(null);
  const [pasted, setPasted] = useState('');
  let pastedValue: unknown = null;
  let pastedInvalid = false;
  if (pasted.trim() !== '') {
    try {
      pastedValue = JSON.parse(pasted);
      pastedInvalid = parseRichText(pastedValue) === null;
    } catch {
      pastedInvalid = true;
    }
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Texto rico</h1>
      <p className="mb-8 max-w-prose text-[var(--text-muted)]">
        Editor e visualização do conteúdo das aulas. Só parágrafos, títulos, listas, citação,
        negrito, itálico e links seguros; HTML digitado aparece como texto.
      </p>

      <section aria-labelledby="editor-titulo" className="mb-10 grid gap-4">
        <h2 id="editor-titulo" className="text-xl font-semibold">
          Editor
        </h2>
        <Suspense fallback={<p role="status">Carregando editor…</p>}>
          <RichTextEditor initialValue={null} label="Conteúdo de exemplo" onChange={setDoc} />
        </Suspense>
      </section>

      <section aria-labelledby="previa-titulo" className="mb-10 grid gap-4">
        <h2 id="previa-titulo" className="text-xl font-semibold">
          Pré-visualização
        </h2>
        <div data-testid="preview" className="max-w-prose">
          <RichTextView value={doc} />
        </div>
        <details>
          <summary className="min-h-11 cursor-pointer font-medium">JSON gerado</summary>
          <pre
            data-testid="json"
            tabIndex={0}
            aria-label="JSON gerado pelo editor"
            className="max-h-64 overflow-auto rounded-lg border p-3 text-sm"
          >
            {JSON.stringify(doc, null, 2)}
          </pre>
        </details>
      </section>

      <section aria-labelledby="colar-titulo" className="grid max-w-prose gap-3">
        <h2 id="colar-titulo" className="text-xl font-semibold">
          Exibir um JSON
        </h2>
        <label className="grid gap-1.5 font-medium" htmlFor="json-colado">
          JSON do documento
        </label>
        <textarea
          id="json-colado"
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          rows={6}
          className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3 font-mono text-sm text-[var(--input-fg)]"
        />
        {pastedInvalid ? (
          <p role="alert" className="font-medium text-[var(--text-danger)]">
            Documento inválido: há algo fora da allowlist. Nada é exibido.
          </p>
        ) : null}
        <div data-testid="pasted-preview">
          <RichTextView value={pastedValue} />
        </div>
      </section>
    </>
  );
}
