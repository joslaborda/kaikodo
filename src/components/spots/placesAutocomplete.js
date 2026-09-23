import { getGoogleMapsApiKey } from '@/lib/googleMaps';
import { canUseGoogleToday, markGoogleUsed } from '@/lib/googleMaps';
import { getLanguage } from '@/i18n/index.js';
import { countryNameFromIso } from '@/lib/countryConfig';

// Mismo patrón que searchPlacesGoogle() en Restaurants.jsx (Autocomplete New,
// tope diario canUseGoogleToday('autocomplete'), mismo mapeo de tipos). Se
// duplica aquí en vez de importar desde Restaurants.jsx porque ese archivo
// está marcado como "no decomponer" — cualquier cambio ahí (incluido export)
// se evita a propósito. Si se cambia el comportamiento de búsqueda en un
// sitio, hay que replicarlo también en el otro.
const GOOGLE_TYPE_MAP = {
  restaurant: 'food', cafe: 'food', bar: 'food', bakery: 'food', meal_takeaway: 'food',
  meal_delivery: 'food', night_club: 'food',
  museum: 'sight', art_gallery: 'sight', tourist_attraction: 'sight', church: 'sight',
  hindu_temple: 'sight', mosque: 'sight', synagogue: 'sight', park: 'sight',
  monument: 'sight', historical_landmark: 'sight', place_of_worship: 'sight',
  shopping_mall: 'shopping', clothing_store: 'shopping', department_store: 'shopping',
  supermarket: 'shopping', book_store: 'shopping', market: 'shopping',
  movie_theater: 'activity', bowling_alley: 'activity', amusement_park: 'activity',
  stadium: 'activity', zoo: 'activity', spa: 'activity',
  lodging: 'hotel', hotel: 'hotel', motel: 'hotel', resort_hotel: 'hotel', hostel: 'hotel',
  airport: 'airport', international_airport: 'airport',
  train_station: 'train', subway_station: 'train', light_rail_station: 'train', transit_station: 'train',
  bus_station: 'bus', bus_stop: 'bus',
};
function googleTypeToKodoType(types) {
  for (const t of (types || [])) { if (GOOGLE_TYPE_MAP[t]) return GOOGLE_TYPE_MAP[t]; }
  return 'sight';
}

async function autocompleteGoogle(query, signal, apiKey) {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({ input: query, languageCode: getLanguage() === 'en' ? 'en' : 'es' }),
    signal,
  });
  if (!res.ok) return [];
  markGoogleUsed('autocomplete');
  const data = await res.json();
  return (data.suggestions || []).map(s => s.placePrediction).filter(Boolean).slice(0, 6).map(p => ({
    id: p.placeId,
    _placeId: p.placeId,
    title: p.structuredFormat?.mainText?.text || p.text?.text || query,
    subtitle: p.structuredFormat?.secondaryText?.text || '',
    type: googleTypeToKodoType(p.types),
  }));
}

export async function fetchPlaceDetails(placeId, signal) {
  const apiKey = await getGoogleMapsApiKey();
  if (!apiKey) return null;
  if (!canUseGoogleToday('placeDetails')) return null;
  const res = await fetch('https://places.googleapis.com/v1/places/' + placeId, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      // José (23 sep 2026): sin displayName/formattedAddress (no se pueden
      // guardar, términos EEA) -- solo campos Essentials, los más baratos.
      'X-Goog-FieldMask': 'id,location,types,addressComponents',
    },
    signal,
  });
  if (!res.ok) return null;
  markGoogleUsed('placeDetails');
  const p = await res.json();
  const countryComp = (p.addressComponents || []).find(c => (c.types || []).includes('country'));
  // José (15 sep 2026): "no sabes dónde está cada uno, la organización de
  // los spots es pésima" -- el nombre de ciudad que se guardaba salía de
  // trocear el subtítulo del autocompletado a lo bruto (poco fiable, a
  // veces vacío), en vez de usar el componente de dirección real que
  // Google ya devuelve aquí. `locality` es el habitual (una ciudad), con
  // `postal_town` y `administrative_area_level_2` como respaldo para
  // países/zonas donde Google no usa locality (p.ej. Reino Unido).
  const cityComp = (p.addressComponents || []).find(c => (c.types || []).includes('locality'))
    || (p.addressComponents || []).find(c => (c.types || []).includes('postal_town'))
    || (p.addressComponents || []).find(c => (c.types || []).includes('administrative_area_level_2'));
  // País: nuestra propia etiqueta (countryConfig) a partir del código ISO,
  // no el texto de Google.
  const ownCountry = countryNameFromIso(countryComp?.shortText);
  return {
    lat: p.location?.latitude, lng: p.location?.longitude,
    type: googleTypeToKodoType(p.types),
    country: ownCountry,
    city_name: cityComp?.longText || '',
  };
}

// Búsqueda de sitios nuevos (cualquier lugar del mundo) para el buscador
// unificado del Perfil. No pide rating/reseñas (tier Enterprise+, más caro) —
// solo nombre y ubicación (tier Pro/Essentials), igual que el autocompletado
// que ya usa Restaurants.jsx al crear un spot.
export async function searchNewPlaces(query, signal) {
  if (!query || query.trim().length < 3) return [];
  if (!canUseGoogleToday('autocomplete')) return [];
  const apiKey = await getGoogleMapsApiKey();
  if (!apiKey) return [];
  try {
    return await autocompleteGoogle(query.trim(), signal, apiKey);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return [];
  }
}
