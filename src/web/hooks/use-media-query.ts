import { useEffect, useState } from 'react';

/**
 * Segue uma media query (`matchMedia`). Começa em `false` (e em ambientes sem `matchMedia`): o que depende dela
 * só aparece, e só carrega, quando a tela de fato satisfaz a consulta.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
