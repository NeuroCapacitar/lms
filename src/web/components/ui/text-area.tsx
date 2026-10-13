import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

interface TextAreaProps extends ComponentProps<'textarea'> {
  label: string;
  description?: string;
}

/** Área de texto com rótulo sempre visível e descrição associada (mesmo visual do campo de texto). */
export function TextArea({ label, description, id, className, ...props }: TextAreaProps) {
  const descriptionId = description && id ? `${id}-desc` : undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-medium text-[var(--field-label)]">
        {label}
      </label>
      <textarea
        id={id}
        aria-describedby={descriptionId}
        className={cn(
          'min-h-24 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--input-fg)] placeholder:text-[var(--input-placeholder)] disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      />
      {description ? (
        <p id={descriptionId} className="text-sm text-[var(--field-description)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}
