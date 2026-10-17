import { Dialog } from '@base-ui/react/dialog';
import { List, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

import type { Capability } from '../../features/identity/capabilities';
import { UnauthenticatedError } from '../api/profile';
import { fetchAccess } from '../api/http';
import { RequireTerms } from '../components/require-terms';
import { ThemeToggle } from '../components/theme-toggle';

interface NavItem {
  to:
    | '/staff'
    | '/staff/cursos'
    | '/staff/fila'
    | '/staff/operacao'
    | '/staff/discussoes'
    | '/staff/ajuda'
    | '/staff/banners'
    | '/staff/certificados'
    | '/staff/certificados/emitidos'
    | '/staff/financeiro'
    | '/staff/videos'
    | '/staff/auditoria'
    | '/staff/equipe';
  label: string;
  /** Capability que mostra o item. É só conveniência: o servidor protege cada rota. */
  needs: Capability | readonly Capability[];
}

const NAV: NavItem[] = [
  { to: '/staff', label: 'Início', needs: 'staff.read' },
  { to: '/staff/cursos', label: 'Cursos', needs: 'staff.read' },
  { to: '/staff/fila', label: 'Fila de ações', needs: 'staff.read' },
  { to: '/staff/operacao', label: 'Operação', needs: 'staff.read' },
  { to: '/staff/discussoes', label: 'Discussões', needs: 'discussion.moderate' },
  { to: '/staff/ajuda', label: 'Ajuda', needs: 'staff.read' },
  { to: '/staff/banners', label: 'Banners', needs: 'staff.manage' },
  { to: '/staff/certificados', label: 'Certificados', needs: 'staff.manage' },
  // A lista de emitidos também serve a quem reemite ou opera a fila (o mesmo que a API aceita, ver docs/spec/staff-matrix.md).
  {
    to: '/staff/certificados/emitidos',
    label: 'Certificados emitidos',
    needs: ['certificate.reissue', 'ops.queue'],
  },
  {
    to: '/staff/financeiro',
    label: 'Financeiro',
    needs: ['finance.view', 'finance.review', 'refund.execute'],
  },
  { to: '/staff/videos', label: 'Vídeo', needs: 'integration.credentials' },
  { to: '/staff/auditoria', label: 'Auditoria', needs: 'audit.view' },
  { to: '/staff/equipe', label: 'Equipe', needs: 'staff.manage' },
];

const linkClass =
  'flex min-h-11 items-center rounded-lg px-3 font-medium hover:bg-[var(--surface-raised)]';

function Nav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Área da equipe">
      <ul className="grid gap-1">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              activeOptions={{ exact: item.to === '/staff' }}
              activeProps={{ className: `${linkClass} bg-[var(--surface-raised)]` }}
              inactiveProps={{ className: linkClass }}
              onClick={onNavigate}
            >
              {item.label}
            </Link>
          </li>
        ))}
        <li>
          <Link to="/" className={linkClass} onClick={onNavigate}>
            Voltar ao site
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/**
 * Casca da área da Staff (M1-10): barra lateral em telas largas e gaveta no celular, na mesma
 * linguagem visual do aluno. Os itens aparecem pela capability, mas isso é só conveniência: cada
 * rota da API confere a capability no servidor. Sem papel de Staff mostra um aviso, sem conteúdo.
 */
export function StaffShell({ children }: { children: ReactNode }) {
  return (
    <RequireTerms>
      <ShellContent>{children}</ShellContent>
    </RequireTerms>
  );
}

function ShellContent({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const access = useQuery({ queryKey: ['access'], queryFn: fetchAccess, retry: false });

  if (access.isPending) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p role="status">Carregando…</p>
      </main>
    );
  }
  if (access.error instanceof UnauthenticatedError) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="mb-2 text-3xl font-semibold">Área da equipe</h1>
        <p className="mb-4 max-w-prose">Entre para acessar a área da equipe.</p>
        <Link to="/entrar">Entrar</Link>
      </main>
    );
  }
  if (access.isError || !access.data.capabilities.includes('staff.read')) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="mb-2 text-3xl font-semibold">Área da equipe</h1>
        <p role="alert" className="mb-4 max-w-prose">
          {access.isError
            ? 'Não foi possível carregar agora. Tente novamente em instantes.'
            : 'Esta área é só para a equipe.'}
        </p>
        <Link to="/">Voltar ao site</Link>
      </main>
    );
  }

  const items = NAV.filter((item) =>
    (Array.isArray(item.needs) ? item.needs : [item.needs]).some((needed) =>
      access.data.capabilities.includes(needed),
    ),
  );
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-lg focus:bg-[var(--surface-raised)] focus:px-4 focus:py-2"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-[var(--border-control)]/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Dialog.Root open={drawer} onOpenChange={setDrawer}>
              <Dialog.Trigger
                aria-label="Abrir o menu da equipe"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border md:hidden"
              >
                <List aria-hidden size={22} />
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Backdrop className="fixed inset-0 bg-black/40 md:hidden" />
                <Dialog.Popup className="fixed inset-y-0 left-0 z-10 w-72 max-w-[85vw] bg-[var(--surface-page)] p-4 shadow-xl md:hidden">
                  <div className="mb-4 flex items-center justify-between">
                    <Dialog.Title className="text-lg font-semibold">Menu da equipe</Dialog.Title>
                    <Dialog.Close
                      aria-label="Fechar o menu"
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border"
                    >
                      <X aria-hidden size={20} />
                    </Dialog.Close>
                  </div>
                  <Nav items={items} onNavigate={() => setDrawer(false)} />
                </Dialog.Popup>
              </Dialog.Portal>
            </Dialog.Root>
            <span className="text-lg font-semibold">NeuroCapacitar · Equipe</span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 px-4 py-8 md:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <Nav items={items} />
        </aside>
        <main id="conteudo" tabIndex={-1}>
          {children}
        </main>
      </div>
    </>
  );
}
