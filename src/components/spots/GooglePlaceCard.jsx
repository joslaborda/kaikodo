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

function remember(key, el) {
  kept.delete(key);
  kept.set(key, el);
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
}

function buildElement(variant, placeId) {
  const el = document.createElement(variant === 'full' ? 'gmp-place-details' : 'gmp-place-details-compact');
  if (variant !== 'full') {
    el.setAttribute('orientation', 'horizontal');
    el.setAttribute('truncation-preferred', '');
  }
  const req = document.createElement('gmp-place-details-place-request');
  req.setAttribute('place', placeId);
  el.appendChild(req);

  if (variant === 'full') {
    el.appendChild(document.createElement('gmp-place-all-content'));
  } else {
    // Misma configuración que el ejemplo oficial de Google para la ficha
    // compacta: foto, rating, tipo, precio, abierto ahora y atribución.
    const cfg = document.createElement('gmp-place-content-config');
    const media = document.createElement('gmp-place-media');
    media.setAttribute('lightbox-preferred', '');
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
  });
  el.style.setProperty('--gmp-mat-font-family', "'Nunito', system-ui, sans-serif");
  el.style.setProperty('--gmp-mat-color-primary', '#c2410c');
  el.style.setProperty('--gmp-mat-color-surface', 'transparent');
  return el;
}

/**
 * Ficha de Google de un sitio, pintada por Places UI Kit.
 *  - placeId: place id de Google. Sin él no se pinta nada (o `fallback`).
 *  - variant: 'compact' (filas de listas) | 'full' (ficha de detalle).
 *  - fallback: lo que se ve sin conexión, sin place id, o si Google falla.
 */
export default function GooglePlaceCard({ placeId, variant = 'compact', fallback = null, className = '' }) {
  const containerRef = useRef(null);
  const online = useOnlineStatus();
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = `${variant}:${placeId}`;

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
        el = buildElement(variant, placeId);
        el.addEventListener('gmp-error', () => { kept.delete(key); if (!cancelled) setFailed(true); });
        el.addEventListener('gmp-load', () => remember(key, el));
        node.replaceChildren(el);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (el && node?.contains(el)) node.removeChild(el);
    };
  }, [placeId, visible, online, failed, variant, key]);

  if (!placeId || !online || failed) return fallback;
  return <div ref={containerRef} className={className} style={{ minHeight: variant === 'full' ? 120 : 64 }} />;
}
