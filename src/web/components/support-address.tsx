import { useQuery } from '@tanstack/react-query';

import { fetchSupportEmail } from '../api/help';

/**
 * O endereço de suporte da equipe (M5-14), para quem não consegue entrar ou prefere escrever. Vem do ambiente;
 * sem configuração, não mostra nada (nunca um endereço inventado).
 */
export function SupportAddress({ prefix }: { prefix: string }) {
  const support = useQuery({
    queryKey: ['support-email'],
    queryFn: fetchSupportEmail,
    staleTime: 300_000,
    retry: false,
  });
  if (!support.data) return null;
  return (
    <p className="text-sm">
      {prefix}{' '}
      <a href={`mailto:${support.data}`} className="underline">
        {support.data}
      </a>
      .
    </p>
  );
}
