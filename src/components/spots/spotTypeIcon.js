// spotTypeIcon.js — icono en bruto (paths SVG) por tipo de spot, para usar en
// contextos que necesitan un <svg> como STRING (pines de Leaflet/Google Maps),
// no como componente React.
//
// Por qué existe: el código anterior usaba `renderToStaticMarkup` de
// 'react-dom/server' para convertir el icono de Lucide de cada spot en un
// string sobre la marcha. `react-dom/server` está pensado para renderizado en
// servidor (Node) — usarlo en el bundle de cliente es un patrón atípico y,
// tras varias sesiones sin poder reproducir en vivo por qué el mapa de Google
// de Spots caía en silencio a Leaflet pese a cargar el SDK entero sin
// errores, es el sospechoso principal (nada más en el flujo de creación del
// mapa de Google — estilos, marcadores numerados, polylines, fitBounds —
// falla al probarlo aislado). Quitar la dependencia es, como mínimo, una
// mejora real y de bajo riesgo aunque no sea la causa exacta.
//
// Paths copiados literalmente de lucide-react@0.475.0 (mismo paquete que usa
// el proyecto) — verificado contra el código fuente instalado del paquete,
// no reescritos a mano.

const ICONS = {
  food: {
    // Utensils
    viewBox: '0 0 24 24',
    paths: [
      'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2',
      'M7 2v20',
      'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7',
    ],
  },
  sight: {
    // Landmark
    viewBox: '0 0 24 24',
    lines: [
      [3, 22, 21, 22],
      [6, 18, 6, 11],
      [10, 18, 10, 11],
      [14, 18, 14, 11],
      [18, 18, 18, 11],
    ],
    polygons: ['12 2 20 7 4 7'],
  },
  activity: {
    // Ticket
    viewBox: '0 0 24 24',
    paths: [
      'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z',
      'M13 5v2',
      'M13 17v2',
      'M13 11v2',
    ],
  },
  shopping: {
    // ShoppingBag
    viewBox: '0 0 24 24',
    paths: [
      'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z',
      'M3 6h18',
      'M16 10a4 4 0 0 1-8 0',
    ],
  },
  transport: {
    // Compass
    viewBox: '0 0 24 24',
    paths: ['m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z'],
    circles: [[12, 12, 10]],
  },
  hotel: {
    // Hotel
    viewBox: '0 0 24 24',
    paths: [
      'M10 22v-6.57', 'M12 11h.01', 'M12 7h.01', 'M14 15.43V22', 'M15 16a5 5 0 0 0-6 0',
      'M16 11h.01', 'M16 7h.01', 'M8 11h.01', 'M8 7h.01',
    ],
    rects: [[4, 2, 16, 20, 2]],
  },
  train: {
    // TrainFront
    viewBox: '0 0 24 24',
    paths: [
      'M8 3.1V7a4 4 0 0 0 8 0V3.1', 'm9 15-1-1', 'm15 15 1-1',
      'M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z', 'm8 19-2 3', 'm16 19 2 3',
    ],
  },
  bus: {
    // BusFront
    viewBox: '0 0 24 24',
    paths: [
      'M4 6 2 7', 'M10 6h4', 'm22 7-2-1', 'M4 11h16', 'M8 15h.01', 'M16 15h.01', 'M6 19v2', 'M18 21v-2',
    ],
    rects: [[4, 3, 16, 16, 2]],
  },
  airport: {
    // PlaneIcon (icono propio de @/lib/icons, no de lucide)
    viewBox: '0 0 24 24',
    paths: [
      'M12 3 C13 3 14 4 14 6 L14 18 C14 20 13 21 12 21 C11 21 10 20 10 18 L10 6 C10 4 11 3 12 3Z',
      'M10 9 L3 13 L3 15 L10 13',
      'M14 9 L21 13 L21 15 L14 13',
      'M10 17 L7 19 L7 20 L10 19',
      'M14 17 L17 19 L17 20 L14 19',
    ],
  },
  custom: {
    // CirclePlus
    viewBox: '0 0 24 24',
    paths: ['M8 12h8', 'M12 8v8'],
    circles: [[12, 12, 10]],
  },
};

/**
 * Devuelve el <svg>...</svg> (como string) del icono de un tipo de spot.
 * size/color/strokeWidth con los mismos defaults que se usaban al pasar por
 * el componente de Lucide (size=13, color="#fff", strokeWidth=2.5).
 */
export function spotTypeIconSvg(type, { size = 13, color = '#fff', strokeWidth = 2.5 } = {}) {
  const def = ICONS[type] || ICONS.custom;
  const attrs = `fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
  let inner = '';
  (def.paths || []).forEach((d) => { inner += `<path d="${d}"/>`; });
  (def.lines || []).forEach(([x1, y1, x2, y2]) => { inner += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; });
  (def.circles || []).forEach(([cx, cy, r]) => { inner += `<circle cx="${cx}" cy="${cy}" r="${r}"/>`; });
  (def.rects || []).forEach(([x, y, w, h, rx]) => { inner += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`; });
  (def.polygons || []).forEach((points) => { inner += `<polygon points="${points}"/>`; });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${def.viewBox}" ${attrs}>${inner}</svg>`;
}
