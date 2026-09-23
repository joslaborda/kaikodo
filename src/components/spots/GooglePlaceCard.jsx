import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// José (23 sep 2026): cumplimiento de los términos de Google Maps Platform
// (facturación en España -> términos EEA). Todo el contenido de Google Places
// (nombre, rating, fotos, horario, teléfono, web...) se enseña SOLO a través
// de Places UI Kit: lo pinta Google, con su atribución, y nunca se guarda en
// nuestra base de datos. UI Kit está exento de las restricciones EEA de "uso
// con cualquier mapa" y de la lista de usos permitidos.
//
// Lo único que guardamos de Google es el place id (permitido indefinidamente)
// -- en Spot va en `osm_id` (nombre heredado del campo), en SavedSpot en
// `google_place_id`.
//
// Coste: Google cobra cada carga del componente. Para no pagar de más:
//  · carga diferida -- el componente solo se crea cuando entra en pantalla;
//  · el elemento ya pintado se reutiliza en memoria durante la sesión (abrir
//    y cerrar la ficha del mismo sitio no vuelve a cobrar). Esto no es
//    "guardar" contenido de Places: vive en memoria y desaparece al cerrar
//    la app, nada se escribe en disco ni en el servidor.

const MAX_KEPT = 40;
const kept = new Map(); // `${variant}:${placeId}` -> HTMLElement ya cargado

export function isGooglePlaceId(id) {
  const s = (id ?? '').toString().trim();
  // Los ids legacy de OSM son numéricos; los de Google son alfanuméricos largos.
  return s.length > 10 && !/^\d+$/.test(s);
}

// Place id de Google de un Spot (osm_id) o de un SavedSpot (google_place_id).
export function googlePlaceIdOf(spot) {
  if (!spot) return null;
  if (isGooglePlaceId(spot.osm_id)) return String(spot.osm_id).trim();
  if (isGooglePlaceId(spot.google_place_id)) return String(spot.google_place_id).trim();
  return null;
}

// José (23 sep 2026): las fichas de Google van dentro de filas pulsables
// (abren nuestro detalle). Sus propios controles -- el botón azul de abrir en
// Google Maps y la foto -- tienen que hacer lo suyo SIN abrir además nuestro
// detalle. Devuelve true si el toque salió de uno de esos controles; las
// filas lo comprueban al principio de su onClick y, si es así, no hacen nada.
export function isGoogleCardControl(e) {
  const path = e?.nativeEvent?.composedPath?.() || e?.composedPath?.() || [];
  for (const n of path) {
    const tag = n?.tagName;
    if (!tag) continue;
    if (tag.startsWith('GMP-PLACE-DETAILS')) return false; // llegó a la ficha sin pasar por un control
    if (tag === 'A' || tag === 'BUTTON' || n.getAttribute?.('role') === 'button') return true;
  }
  return false;
}

function remember(key, el) {
  kept.delete(key);
  kept.set(key, el);
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
}

function buildElement(variant, placeId, interactive, orientation) {
  const el = document.createElement(variant === 'full' ? 'gmp-place-details' : 'gmp-place-details-compact');
  if (variant !== 'full') {
    el.setAttribute('orientation', orientation === 'vertical' ? 'vertical' : 'horizontal');
    el.setAttribute('truncation-preferred', '');
  }
  const req = document.createElement('gmp-place-details-place-request');
  req.setAttribute('place', placeId);
  el.appendChild(req);

  if (variant === 'full') {
    el.appendChild(document.createElement('gmp-place-all-content'));
  } else if (variant === 'lean') {
    // Filas densas (Ruta, Hoy/Mañana): solo nombre, estrellas y atribución.
    const cfg = document.createElement('gmp-place-content-config');
    cfg.appendChild(document.createElement('gmp-place-rating'));
    const attribution = document.createElement('gmp-place-attribution');
    attribution.setAttribute('light-scheme-color', 'gray');
    attribution.setAttribute('dark-scheme-color', 'white');
    cfg.appendChild(attribution);
    el.appendChild(cfg);
  } else {
    // Misma configuración que el ejemplo oficial de Google para la ficha
    // compacta: foto, rating, tipo, precio, abierto ahora y atribución.
    const cfg = document.createElement('gmp-place-content-config');
    const media = document.createElement('gmp-place-media');
    // En filas de lista (no interactivo) el toque es de la fila, no de la foto.
    if (interactive) media.setAttribute('lightbox-preferred', '');
    cfg.appendChild(media);
    ['gmp-place-rating', 'gmp-place-type', 'gmp-place-price', 'gmp-place-open-now-status']
      .forEach(tag => cfg.appendChild(document.createElement(tag)));
    const attribution = document.createElement('gmp-place-attribution');
    attribution.setAttribute('light-scheme-color', 'gray');
    attribution.setAttribute('dark-scheme-color', 'white');
    cfg.appendChild(attribution);
    el.appendChild(cfg);
  }

  // Sistema Ō, dentro de lo que UI Kit deja personalizar (colores,
  // tipografía, esquinas). La estructura de la ficha es la de Google.
  Object.assign(el.style, {
    width: '100%',
    display: 'block',
    colorScheme: 'light',
    border: 'none',
    backgroundColor: 'transparent',
    // No interactivo: la ficha es solo visual y el toque lo recibe la fila
    // que la contiene (p. ej. MySpotRow abre el detalle del spot).
    pointerEvents: interactive ? 'auto' : 'none',
  });
  el.style.setProperty('--gmp-mat-font-family', "'Nunito', system-ui, sans-serif");
  el.style.setProperty('--gmp-mat-color-primary', '#c2410c');
  el.style.setProperty('--gmp-mat-color-surface', 'transparent');
  // José (23 sep 2026): en móvil la ficha quedaba enorme. Todo lo de abajo son
  // propiedades CSS documentadas por Google para UI Kit (no se toca nada por
  // dentro): texto algo más pequeño (escala todo el componente), menos aire
  // interno, y el botón "Abrir en Maps" -- que no se puede quitar -- en tonos
  // de la app en vez del azul de Google. La atribución "Google Maps" es
  // obligatoria y su posición la fija Google (no admite reordenarse).
  el.style.fontSize = variant === 'full' ? '15px' : '14px';
  el.style.setProperty('--gmp-mat-spacing-two-extra-large', '16px');
  el.style.setProperty('--gmp-mat-spacing-extra-large', '12px');
  el.style.setProperty('--gmp-mat-spacing-large', '10px');
  el.style.setProperty('--gmp-mat-spacing-medium', '8px');
  el.style.setProperty('--gmp-mat-spacing-small', '4px');
  el.style.setProperty('--gmp-mat-spacing-extra-small', '2px');
  el.style.setProperty('--gmp-mat-color-secondary-container', '#f5f5f4');
  el.style.setProperty('--gmp-mat-color-on-secondary-container', '#57534e');
  el.style.setProperty('--gmp-star-rating-color', '#f59e0b');
  return el;
}

/**
 * Ficha de Google de un sitio, pintada por Places UI Kit.
 *  - placeId: place id de Google. Sin él no se pinta nada (o `fallback`).
 *  - variant: 'compact' (filas de listas) | 'lean' (filas densas: nombre +
 *    estrellas, sin foto) | 'full' (ficha de detalle).
 *  - fallback: lo que se ve sin conexión, sin place id, o si Google falla.
 *  - interactive: false dentro de filas pulsables (la ficha no captura toques).
 */
export default function GooglePlaceCard({ placeId, variant = 'compact', fallback = null, className = '', interactive = true, orientation = 'horizontal' }) {
  const containerRef = useRef(null);
  const online = useOnlineStatus();
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = `${variant}:${orientation}:${interactive ? 'i' : 'n'}:${placeId}`;

  // Carga diferida: solo cuando el hueco entra (o está a punto de entrar) en pantalla.
  useEffect(() => {
    if (!placeId || visible) return;
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(node);
    return () => io.disconnect();
  }, [placeId, visible]);

  useEffect(() => { setFailed(false); }, [placeId]);

  useEffect(() => {
    if (!placeId || !visible || !online || failed) return;
    let cancelled = false;
    const node = containerRef.current;

    const reused = kept.get(key);
    if (reused) {
      remember(key, reused);
      node?.replaceChildren(reused);
      return () => { if (node?.contains(reused)) node.removeChild(reused); };
    }

    let el = null;
    loadGoogleMaps()
      .then(g => g.maps.importLibrary('places'))
      .then(() => {
        if (cancelled || !node) return;
        el = buildElement(variant, placeId, interactive, orientation);
        el.addEventListener('gmp-error', () => { kept.delete(key); if (!cancelled) setFailed(true); });
        el.addEventListener('gmp-load', () => remember(key, el));
        node.replaceChildren(el);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (el && node?.contains(el)) node.removeChild(el);
    };
  }, [placeId, visible, online, failed, variant, interactive, orientation, key]);

  if (!placeId || !online || failed) return fallback;
  return <div ref={containerRef} className={className} style={{ minHeight: variant === 'full' ? 120 : variant === 'lean' ? 40 : 64 }} />;
}
