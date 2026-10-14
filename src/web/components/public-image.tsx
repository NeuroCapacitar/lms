import { useState } from 'react';

import type { PublicImageDto } from '../../features/media/delivery';

/**
 * Imagem pública de capa ou banner (M5-07). Tenta a variante do Images; se falhar (cota esgotada, erro 9422, rede),
 * troca UMA vez para o master estático; se o master também falhar, some sem deixar o ícone de imagem quebrada. A
 * imagem é decorativa por padrão (o título do curso já está no texto), então `alt` vazio; o banner do painel (M5-15)
 * passa o texto alternativo da Staff. As dimensões do master evitam salto de layout.
 */
export function PublicImage({
  image,
  className,
  alt = '',
  eager = false,
}: {
  image: PublicImageDto;
  className?: string;
  alt?: string;
  /** Acima da dobra (o primeiro banner): sem carregamento preguiçoso. */
  eager?: boolean;
}) {
  const [src, setSrc] = useState(image.src);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      width={image.width}
      height={image.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => {
        if (src !== image.fallbackSrc) setSrc(image.fallbackSrc);
        else setFailed(true);
      }}
    />
  );
}
