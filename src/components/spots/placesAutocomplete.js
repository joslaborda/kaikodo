import { getGoogleMapsApiKey } from '@/lib/googleMaps';
import { canUseGoogleToday, markGoogleUsed } from '@/lib/googleMaps';
import { getLanguage } from '@/i18n/index.js';

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
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,primaryType,types,photos,addressComponents',
    },
    signal,
  });
  if (!res.ok) return null;
  markGoogleUsed('placeDetails');
  const p = await res.json();
  const photoName = p.photos?.[0]?.name;
  const countryComp = (p.addressComponents || []).find(c => (c.types || []).includes('country'));
  return {
    title: p.displayName?.text,
    address: p.formattedAddress,
    lat: p.location?.latitude, lng: p.location?.longitude,
    type: googleTypeToKodoType(p.primaryType ? [p.primaryType, ...(p.types || [])] : p.types),
    country: countryComp?.longText || '',
    image_url: photoName ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=200&key=${apiKey}` : null,
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
