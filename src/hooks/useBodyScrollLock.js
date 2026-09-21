import { useEffect } from 'react';

// Mientras una hoja/modal está abierta, la página de detrás no debe hacer scroll
// (en escritorio se podía subir y bajar toda la página con la hoja encima). Un
// solo sitio para todas las hojas de la app; se restaura el valor anterior al
// cerrar, también si hay varias abiertas a la vez.
let locks = 0;
let previous = '';

export function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    if (locks === 0) { previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    locks += 1;
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) document.body.style.overflow = previous;
    };
  }, [active]);
}
