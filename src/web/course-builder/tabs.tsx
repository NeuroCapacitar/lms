import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface TabDef<Id extends string> {
  id: Id;
  label: string;
}

/**
 * Abas acessíveis (padrão WAI-ARIA): `role="tablist"`, uma aba por vez no Tab (roving tabindex),
 * setas e Home/End trocam de aba. O painel ativo é `role="tabpanel"` ligado à aba.
 */
export function Tabs<Id extends string>({
  tabs,
  active,
  onChange,
  label,
  children,
}: {
  tabs: TabDef<Id>[];
  active: Id;
  onChange: (id: Id) => void;
  label: string;
  children: ReactNode;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = tabs[target]!;
    onChange(next.id);
    refs.current[next.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="mb-6 flex flex-wrap gap-2 border-b">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[tab.id] = element;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls={`painel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'min-h-11 rounded-t-lg border border-b-0 px-4 font-medium',
              tab.id === active ? 'bg-[var(--surface-raised)]' : 'bg-transparent',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`painel-${active}`} aria-labelledby={`tab-${active}`} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
