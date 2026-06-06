import { useState, useEffect } from 'react';

// Hook responsive basado en window.matchMedia. SSR-safe (lazy initializer que
// asume desktop si no hay window). Re-renderiza al cruzar el breakpoint.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    // addEventListener moderno con fallback a addListener (Safari viejo).
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);

  return matches;
}

// Atajo: ¿estamos en pantalla "no-desktop" (celular/tablet chica)? Corte 768px:
// es la línea para decisiones binarias en JS (drawer vs sidebar, 1 col vs N col).
export function useIsMobile() {
  return useMediaQuery('(max-width: 768px)');
}
