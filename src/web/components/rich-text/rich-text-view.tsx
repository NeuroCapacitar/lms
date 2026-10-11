import type { ReactNode } from 'react';

import {
  isExternalHref,
  parseRichText,
  type RichTextBlock,
  type RichTextInline,
} from '../../../features/content/rich-text';
import { cn } from '../../lib/cn';

/**
 * Exibe texto rico (M2-05) montando ELEMENTOS React a partir do JSON validado: nenhum HTML em
 * string, nada de `dangerouslySetInnerHTML`. O próprio componente valida (allowlist) e, se o valor
 * estiver fora dela, não mostra nada: texto como `<script>` aparece como texto, e link com esquema
 * perigoso nunca chega a virar `<a>`. Links externos levam `rel="noopener noreferrer nofollow"`.
 */
export function RichTextView({ value, className }: { value: unknown; className?: string }) {
  const doc = parseRichText(value);
  if (!doc) return null;
  return (
    <div className={cn('grid gap-4', className)}>
      {doc.content.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

function Inlines({ nodes }: { nodes: RichTextInline[] | undefined }): ReactNode {
  return (nodes ?? []).map((node, index) => {
    if (node.type === 'hardBreak') return <br key={index} />;
    let element: ReactNode = node.text;
    for (const mark of [...(node.marks ?? [])].reverse()) {
      if (mark.type === 'bold') element = <strong>{element}</strong>;
      else if (mark.type === 'italic') element = <em>{element}</em>;
      else {
        const external = isExternalHref(mark.attrs.href);
        element = (
          <a
            href={mark.attrs.href}
            className="underline"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
          >
            {element}
          </a>
        );
      }
    }
    return <span key={index}>{element}</span>;
  });
}

function Block({ block }: { block: RichTextBlock }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p>
          <Inlines nodes={block.content} />
        </p>
      );
    case 'heading': {
      const Tag = block.attrs.level === 2 ? 'h2' : 'h3';
      return (
        <Tag
          className={block.attrs.level === 2 ? 'text-2xl font-semibold' : 'text-xl font-semibold'}
        >
          <Inlines nodes={block.content} />
        </Tag>
      );
    }
    case 'bulletList':
    case 'orderedList': {
      const items = block.content.map((item, index) => (
        <li key={index} className="grid gap-1">
          {item.content.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex}>
              <Inlines nodes={paragraph.content} />
            </p>
          ))}
        </li>
      ));
      return block.type === 'bulletList' ? (
        <ul className="list-disc space-y-1 pl-6">{items}</ul>
      ) : (
        <ol className="list-decimal space-y-1 pl-6" start={block.attrs?.start ?? 1}>
          {items}
        </ol>
      );
    }
    case 'blockquote':
      return (
        <blockquote className="grid gap-2 border-l-4 border-[var(--border-control)] pl-4 italic">
          {block.content.map((paragraph, index) => (
            <p key={index}>
              <Inlines nodes={paragraph.content} />
            </p>
          ))}
        </blockquote>
      );
  }
}
