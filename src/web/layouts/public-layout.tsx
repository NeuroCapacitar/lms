import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ThemeToggle } from '../components/theme-toggle';

/** Layout mínimo das páginas públicas: pular para o conteúdo, navegação, conteúdo e rodapé. */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-lg focus:bg-[var(--surface-raised)] focus:px-4 focus:py-2"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-[var(--border-control)]/40">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav aria-label="Principal" className="flex items-center gap-5 font-medium">
            <Link to="/">Início</Link>
            <Link to="/sobre">Sobre</Link>
            <Link to="/base-visual">Base visual</Link>
            <Link to="/entrar">Entrar</Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <main id="conteudo" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-10">
        {children}
      </main>
      <footer className="mx-auto max-w-5xl px-4 py-8 text-sm text-[var(--text-muted)]">
        NeuroCapacitar Hub
      </footer>
    </>
  );
}
