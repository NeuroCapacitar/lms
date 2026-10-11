import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useState, type FormEvent } from 'react';

import {
  EMPTY_RICH_TEXT,
  isAllowedHref,
  parseRichText,
  type RichText,
} from '../../../features/content/rich-text';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { TextField } from '../ui/field';

interface RichTextEditorProps {
  /** Valor INICIAL (o editor não é controlado depois de montado). */
  initialValue: RichText | null;
  /** Rótulo acessível da área de edição. */
  label: string;
  /** Recebe o documento VALIDADO pela allowlist a cada mudança. */
  onChange: (value: RichText) => void;
}

/**
 * Editor Tiptap restrito às MESMAS extensões da allowlist de `rich-text.ts` (M2-05): parágrafo,
 * títulos 2 e 3, listas, citação, quebra de linha, negrito, itálico e link (`http`, `https`,
 * `mailto`). Tudo o mais do StarterKit fica desligado, inclusive autolink e colar como link. Cada
 * mudança só sai se passar pela mesma validação que o servidor aplica.
 */
export function RichTextEditor({ initialValue, label, onChange }: RichTextEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState<string | undefined>();
  const [unsupported, setUnsupported] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    // A CSP não permite `<style>` injetado: o CSS mínimo do ProseMirror fica em app.css.
    injectCSS: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          defaultProtocol: 'https',
          HTMLAttributes: { target: null, rel: null, class: null },
          isAllowedUri: (url: string) => isAllowedHref(url),
        },
      }),
    ],
    content: initialValue ?? EMPTY_RICH_TEXT,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        class:
          'min-h-40 max-w-prose rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-[var(--input-fg)] outline-none focus-visible:ring-2',
      },
    },
    onUpdate: ({ editor: current }) => {
      const parsed = parseRichText(current.getJSON());
      setUnsupported(parsed === null);
      if (parsed) onChange(parsed);
    },
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      h2: current?.isActive('heading', { level: 2 }) ?? false,
      h3: current?.isActive('heading', { level: 3 }) ?? false,
      bullet: current?.isActive('bulletList') ?? false,
      ordered: current?.isActive('orderedList') ?? false,
      quote: current?.isActive('blockquote') ?? false,
      link: current?.isActive('link') ?? false,
    }),
  });

  if (!editor || !state) return <p role="status">Carregando editor…</p>;

  function applyLink(event: FormEvent) {
    event.preventDefault();
    const value = href.trim();
    if (!isAllowedHref(value)) {
      setLinkError('Use um endereço que comece com http://, https:// ou mailto:.');
      return;
    }
    editor?.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
    setHref('');
    setLinkError(undefined);
    setLinkOpen(false);
  }

  const tool = (name: string, active: boolean, run: () => void) => (
    <button
      key={name}
      type="button"
      aria-pressed={active}
      onClick={run}
      className={cn(
        'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-medium',
        active ? 'bg-[var(--surface-raised)]' : 'bg-transparent',
      )}
    >
      {name}
    </button>
  );

  return (
    <div className="grid gap-3">
      <div role="toolbar" aria-label="Formatação do texto" className="flex flex-wrap gap-2">
        {tool('Negrito', state.bold, () => editor.chain().focus().toggleBold().run())}
        {tool('Itálico', state.italic, () => editor.chain().focus().toggleItalic().run())}
        {tool('Título 2', state.h2, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        {tool('Título 3', state.h3, () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
        {tool('Lista', state.bullet, () => editor.chain().focus().toggleBulletList().run())}
        {tool('Lista numerada', state.ordered, () =>
          editor.chain().focus().toggleOrderedList().run(),
        )}
        {tool('Citação', state.quote, () => editor.chain().focus().toggleBlockquote().run())}
        {tool('Link', state.link, () => setLinkOpen(true))}
        {state.link
          ? tool('Remover link', false, () =>
              editor.chain().focus().extendMarkRange('link').unsetLink().run(),
            )
          : null}
      </div>
      {linkOpen ? (
        <form onSubmit={applyLink} noValidate className="grid max-w-md gap-3">
          <TextField
            label="Endereço do link"
            name="rich-text-href"
            type="url"
            value={href}
            onChange={(event) => setHref(event.target.value)}
            error={linkError}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Aplicar link</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setLinkOpen(false);
                setLinkError(undefined);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}
      <EditorContent editor={editor} />
      {unsupported ? (
        <p role="alert" className="font-medium text-[var(--text-danger)]">
          Este conteúdo usa um recurso não suportado e não será salvo.
        </p>
      ) : null}
    </div>
  );
}
