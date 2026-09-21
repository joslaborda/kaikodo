// Encuadre seguro de mapas con pocos puntos.
//
// José (21 sep 2026, en vivo en León): con solo el alojamiento en el mapa de
// Hoy, el pin salía con el zoom al máximo y el mapa parecía un rectángulo
// gris vacío. Causa: el alojamiento contaba dos veces (como hotelSpot Y como
// parada numerada #1, al ser también un spot del día), así que fitBounds
// recibía dos puntos idénticos = un área de cero metros, y Google/Leaflet
// hacen zoom al máximo para encuadrar "nada". Los alojamientos ya no entran
// como parada (ver src/lib/cityStay.js), pero esta guarda cubre cualquier otro
// caso de puntos pegados (dos spots en la misma plaza, un doc y un spot en la
// misma estación...): si todo cabe en unos ~200 m se centra a un zoom de
// barrio en vez de encuadrar; y si no, fitBounds nunca pasa de zoom de calle.
export const TIGHT_SPAN_DEG = 0.002;
export const SINGLE_POINT_ZOOM = 15;
export const MAX_FIT_ZOOM = 17;

// points: [{ lat, lng }]
export function arePointsTight(points) {
  if (!points || points.length < 2) return true;
  const lats = points.map(p => p.lat), lngs = points.map(p => p.lng);
  return (Math.max(...lats) - Math.min(...lats)) < TIGHT_SPAN_DEG
      && (Math.max(...lngs) - Math.min(...lngs)) < TIGHT_SPAN_DEG;
}
