// José (23 sep 2026): a qué ciudad de un viaje pertenece un spot guardado.
//
// Antes, el panel de importar de Spots (Restaurants.jsx) ofrecía cualquier
// guardado del mismo PAÍS y, si su ciudad no estaba en el viaje, lo colgaba de
// la ciudad activa -- y le ponía también su nombre. Resultado real: Casa
// Macareno (Madrid) importada en un viaje a Barcelona salía como "Barcelona"
// con dirección de Madrid.
//
// Criterio único para las dos rutas de importación (Perfil y Spots), el mismo
// que ya usaba el banner del Perfil: coincide si el nombre de ciudad es el
// mismo o si está a <= 50 km de una ciudad del viaje. Si no coincide con
// ninguna, el guardado no se ofrece para ese viaje.

export const MATCH_RADIUS_KM = 50;

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const hasCoords = (o) => typeof o?.lat === 'number' && typeof o?.lng === 'number';

// Devuelve la ciudad del viaje a la que pertenece `spot`, o null.
export function matchTripCity(spot, tripCities, radiusKm = MATCH_RADIUS_KM) {
  if (!spot || !Array.isArray(tripCities) || !tripCities.length) return null;
  const byName = tripCities.find(c => norm(c.name) && norm(c.name) === norm(spot.city_name));
  if (byName) return byName;
  if (!hasCoords(spot)) return null;
  let best = null, bestKm = Infinity;
  for (const c of tripCities) {
    if (!hasCoords(c)) continue;
    const km = haversineKm(spot.lat, spot.lng, c.lat, c.lng);
    if (km <= radiusKm && km < bestKm) { best = c; bestKm = km; }
  }
  return best;
}
