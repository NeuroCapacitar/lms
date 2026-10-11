import { z } from 'zod';

/**
 * Texto rico seguro (M2-05). O conteúdo é guardado como JSON do Tiptap e VALIDADO por uma allowlist:
 * parágrafo, títulos 2 e 3, listas (com marcadores e numeradas), citação, quebra de linha; marcas
 * negrito, itálico e link (`http`, `https` ou `mailto`). Nó, marca ou atributo desconhecido é
 * REJEITADO (nada é "limpo em silêncio"): a mesma função valida no servidor, no componente de
 * visualização e no editor. Sem HTML em string em nenhum ponto. Puro: sem rede nem banco.
 */
export const MAX_RICH_TEXT_BYTES = 100_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_HREF_LENGTH = 2_048;

/** Protocolos de link permitidos. `javascript:`, `data:`, `vbscript:`, `file:` etc. ficam de fora. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** O texto tem espaço em branco ou caractere de controle (que viram truque em esquemas de URL)? */
function hasWhitespaceOrControl(value: string): boolean {
  if (/\s/.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** O endereço é um link seguro? Sem espaços nem controles, protocolo permitido, sem credenciais. */
export function isAllowedHref(value: string): boolean {
  if (value.length === 0 || value.length > MAX_HREF_LENGTH || hasWhitespaceOrControl(value))
    return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
  if (url.protocol === 'mailto:') return url.pathname.length > 0;
  return url.hostname.length > 0 && url.username === '' && url.password === '';
}

/** Link que abre fora do site (http e https): ganha `rel="noopener noreferrer nofollow"` ao exibir. */
export function isExternalHref(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

const hrefSchema = z.string().refine(isAllowedHref, { message: 'href_not_allowed' });

/** O Tiptap grava `target`, `rel`, `class` e `title` do link como `null` quando não usados: só `null` passa. */
const linkAttrs = z.strictObject({
  href: hrefSchema,
  target: z.null().optional(),
  rel: z.null().optional(),
  class: z.null().optional(),
  title: z.null().optional(),
});

const markSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({ type: z.literal('link'), attrs: linkAttrs }),
]);

const textNode = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  marks: z.array(markSchema).max(3).optional(),
});
const hardBreakNode = z.strictObject({ type: z.literal('hardBreak') });
const inline = z.discriminatedUnion('type', [textNode, hardBreakNode]);

const paragraph = z.strictObject({
  type: z.literal('paragraph'),
  content: z.array(inline).optional(),
});
const heading = z.strictObject({
  type: z.literal('heading'),
  attrs: z.strictObject({ level: z.union([z.literal(2), z.literal(3)]) }),
  content: z.array(inline).optional(),
});
const listItem = z.strictObject({
  type: z.literal('listItem'),
  content: z.array(paragraph).min(1),
});
const bulletList = z.strictObject({
  type: z.literal('bulletList'),
  content: z.array(listItem).min(1),
});
const orderedList = z.strictObject({
  type: z.literal('orderedList'),
  attrs: z
    .strictObject({
      start: z.number().int().min(1).max(100_000).optional(),
      type: z.null().optional(),
    })
    .optional(),
  content: z.array(listItem).min(1),
});
const blockquote = z.strictObject({
  type: z.literal('blockquote'),
  content: z.array(paragraph).min(1),
});
const block = z.discriminatedUnion('type', [
  paragraph,
  heading,
  bulletList,
  orderedList,
  blockquote,
]);

type Inline = z.infer<typeof inline>;
type Block = z.infer<typeof block>;

export interface RichText {
  type: 'doc';
  content: Block[];
}

/** O documento inteiro: tamanho em bytes limitado, além da allowlist (a profundidade já é fixa pelo esquema). */
export const richTextSchema = z
  .strictObject({ type: z.literal('doc'), content: z.array(block).min(1).max(2_000) })
  .refine((doc) => new TextEncoder().encode(JSON.stringify(doc)).length <= MAX_RICH_TEXT_BYTES, {
    message: 'rich_text_too_large',
  });

/** Valida e devolve o documento, ou `null` se algo estiver fora da allowlist. */
export function parseRichText(value: unknown): RichText | null {
  const parsed = richTextSchema.safeParse(value);
  return parsed.success ? (parsed.data as RichText) : null;
}

export type { Block as RichTextBlock, Inline as RichTextInline };

/** Documento vazio (um parágrafo sem texto), como o Tiptap o produz. */
export const EMPTY_RICH_TEXT: RichText = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Documento de um parágrafo só (útil para testes e valores iniciais). */
export function richTextFromParagraph(text: string): RichText {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', ...(text === '' ? {} : { content: [{ type: 'text', text }] }) }],
  };
}
