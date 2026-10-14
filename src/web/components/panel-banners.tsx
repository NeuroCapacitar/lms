import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { PanelBannerDto } from '../../features/banner/banner';
import { fetchPanelBanners } from '../api/banner';
import { Button } from './ui/button';
import { PublicImage } from './public-image';

const isExternal = (url: string) => !url.startsWith('/');

/**
 * Faixa de banners do painel do aluno (M5-15). Um por vez, com "Anterior" e "Próximo" MANUAIS: nada gira sozinho
 * (WCAG 2.2.2, sem movimento automático). O texto alternativo é o que a Staff escreveu; o link só existe se a Staff
 * o definiu (o servidor já recusou qualquer destino fora de caminho interno ou host permitido). Sem banner ativo, ou
 * se a lista falhar, não mostra nada: o painel segue normal.
 */
export function PanelBanners() {
  const banners = useQuery({
    queryKey: ['panel-banners'],
    queryFn: fetchPanelBanners,
    retry: false,
    staleTime: 60_000,
  });
  if (!banners.data || banners.data.length === 0) return null;
  return <Strip banners={banners.data} />;
}

function Strip({ banners }: { banners: PanelBannerDto[] }) {
  const [requested, setRequested] = useState(0);
  // A lista pode encolher entre duas consultas: o índice nunca sai do intervalo.
  const index = Math.min(requested, banners.length - 1);
  const banner = banners[index]!;
  const image = (
    <PublicImage
      key={banner.id}
      image={banner.image}
      alt={banner.alt}
      eager
      className="h-auto w-full rounded-lg"
    />
  );
  return (
    <section
      aria-roledescription="carrossel"
      aria-label="Destaques"
      className="mb-8 grid max-w-5xl gap-2"
    >
      {banner.linkUrl ? (
        <a
          href={banner.linkUrl}
          {...(isExternal(banner.linkUrl) ? { rel: 'noopener noreferrer' } : {})}
          className="block rounded-lg"
        >
          {image}
        </a>
      ) : (
        image
      )}
      {banners.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRequested((index + banners.length - 1) % banners.length)}
          >
            Banner anterior
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRequested((index + 1) % banners.length)}
          >
            Próximo banner
          </Button>
          <p role="status" className="text-sm text-[var(--text-muted)]">
            Banner {index + 1} de {banners.length}
          </p>
        </div>
      ) : null}
    </section>
  );
}
