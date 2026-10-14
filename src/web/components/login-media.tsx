import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { fetchLoginMedia } from '../api/banner';
import { useMediaQuery } from '../hooks/use-media-query';
import { PublicImage } from './public-image';

/**
 * Tela de login com imagem decorativa ao lado (M5-15). A imagem só é PEDIDA e mostrada em telas a partir de 768 px
 * (no celular nem a lista é consultada); é decorativa (`aria-hidden`, sem texto alternativo) e nada na tela depende
 * dela. Sem imagem publicada, sem R2 ou com qualquer falha, a tela fica exatamente como era (o fundo estático).
 */
export function LoginMediaLayout({ children }: { children: ReactNode }) {
  const wide = useMediaQuery('(min-width: 768px)');
  const media = useQuery({
    queryKey: ['login-media'],
    queryFn: fetchLoginMedia,
    enabled: wide,
    retry: false,
    staleTime: 300_000,
  });
  const image = wide ? media.data?.[0]?.image : undefined;
  if (!image) return <>{children}</>;
  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div>{children}</div>
      <div aria-hidden="true" className="self-start">
        <PublicImage image={image} className="h-auto w-full rounded-lg" />
      </div>
    </div>
  );
}
