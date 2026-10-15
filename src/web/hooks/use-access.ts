import { useQuery } from '@tanstack/react-query';

import type { Capability } from '../../features/identity/capabilities';
import { fetchAccess } from '../api/http';

/**
 * O que a pessoa pode FAZER, para a interface decidir o que MOSTRAR. Nunca autoriza nada: cada rota
 * da API confere a capability no servidor (campo escondido na tela não é barreira).
 */
export function useAccess() {
  const query = useQuery({ queryKey: ['access'], queryFn: fetchAccess, retry: false });
  const capabilities = new Set<string>(query.data?.capabilities ?? []);
  return {
    isPending: query.isPending,
    has: (capability: Capability) => capabilities.has(capability),
  };
}
