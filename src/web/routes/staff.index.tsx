import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';

import { fetchAccess } from '../api/http';

export const Route = createFileRoute('/staff/')({ component: StaffHome });

/** Início da área da Staff: por enquanto só aponta para o que a pessoa pode usar (telas por marco). */
function StaffHome() {
  const access = useQuery({ queryKey: ['access'], queryFn: fetchAccess, retry: false });
  const canManage = access.data?.capabilities.includes('staff.manage') ?? false;
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Área da equipe</h1>
      <p className="mb-6 max-w-prose text-[var(--text-muted)]">
        As ferramentas da equipe aparecem aqui conforme as permissões que você recebeu. Novas telas
        chegam nos próximos marcos.
      </p>
      {canManage ? (
        <p>
          <Link to="/staff/equipe">Gerir a equipe</Link>
        </p>
      ) : (
        <p role="status" className="max-w-prose">
          Você tem acesso de leitura à área da equipe. A gestão de pessoas é só do administrador.
        </p>
      )}
    </>
  );
}
