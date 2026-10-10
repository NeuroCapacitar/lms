import { Field as BaseField } from '@base-ui/react/field';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Input } from './input';

interface TextFieldProps extends Omit<ComponentProps<typeof Input>, 'children'> {
  label: string;
  description?: ReactNode;
  /** Mensagem de erro. Quando presente, o campo fica inválido e o leitor de tela a anuncia. */
  error?: string;
  invalid?: boolean;
}

/** Campo de texto completo: rótulo sempre visível, descrição opcional e erro associado ao controle. */
export function TextField({
  label,
  description,
  error,
  invalid,
  className,
  name,
  ...inputProps
}: TextFieldProps) {
  return (
    <BaseField.Root name={name} invalid={invalid ?? Boolean(error)} className="grid gap-1.5">
      <BaseField.Label className="font-medium text-[var(--field-label)]">{label}</BaseField.Label>
      <BaseField.Control render={<Input className={className} />} {...inputProps} />
      {description ? (
        <BaseField.Description className="text-sm text-[var(--field-description)]">
          {description}
        </BaseField.Description>
      ) : null}
      {error ? (
        <BaseField.Error match className={cn('text-sm font-medium text-[var(--field-error)]')}>
          {error}
        </BaseField.Error>
      ) : null}
    </BaseField.Root>
  );
}
