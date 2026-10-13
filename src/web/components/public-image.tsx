import { useState } from 'react';

import type { PublicImageDto } from '../../features/media/delivery';

/**
 * Imagem pública de capa ou banner (M5-07). Tenta a variante do Images; se falhar (cota esgotada, erro 9422, rede),
 * troca UMA vez para o master estático; se o master também falhar, some sem deixar o ícone de imagem quebrada. A
 * imagem é decorativa (o título do curso já está no texto), então `alt` vazio. As dimensões do master evitam salto
 * de layout.
 */
export function PublicImage({ image, className }: { image: PublicImageDto; className?: string }) {
  const [src, setSrc] = useState(image.src);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      width={image.width}
      height={image.height}
      alt=""
      loading="lazy"
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
