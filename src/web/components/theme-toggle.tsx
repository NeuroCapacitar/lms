import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import type { ComponentType } from 'react';

import { cn } from '../lib/cn';
import { setThemePreference, useThemePreference, type ThemePreference } from '../theme';

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  Icon: ComponentType<{ 'aria-hidden'?: boolean; size?: number }>;
}> = [
  { value: 'system', label: 'Sistema', Icon: Desktop },
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Escuro', Icon: Moon },
];

/** Grupo de botões com `aria-pressed`: cada opção é alcançável por Tab e acionada por Enter/Espaço. */
export function ThemeToggle() {
  const current = useThemePreference();
  return (
    <div role="group" aria-label="Tema da interface" className="inline-flex gap-1">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={current === value}
          onClick={() => setThemePreference(value)}
          className={cn(
            'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm',
            current === value
              ? 'border-[var(--border-control)] bg-[var(--surface-raised)] font-medium text-[var(--text-default)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-default)]',
          )}
        >
          <Icon aria-hidden size={20} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
