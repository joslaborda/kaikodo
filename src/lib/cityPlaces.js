import { getGoogleMapsApiKey, canUseGoogleToday, markGoogleUsed } from '@/lib/googleMaps';
import { getLanguage } from '@/i18n/index.js';

/**
 * cityPlaces.js — José (14 sep 2026): antes, añadir una ciudad al viaje
 * (CityInput.jsx, y su copia duplicada `CityField` dentro de
 * NewTripModal.jsx) era puro texto libre sobre una lista fija de "ciudades
 * top por país" — sin geocodificar nada, así que un nombre escrito mal (o
 * transliterado de forma distinta: un topónimo finlandés, chino, etc.) se
 * guardaba tal cual, sin ninguna corrección ni coordenadas.
 *
 * Esto añade una búsqueda real contra Google Places (New), restringida a
 * "locality" (ciudades), que sí entiende variantes/errores de escritura y
 * devuelve el nombre canónico + coordenadas reales. Mismo patrón exacto ya
 * usado en Restaurants.jsx (searchPlacesGoogle/fetchPlaceDetailsGoogle) —
 * key servida desde backend, nunca en el bundle del cliente, mismo tope
 * diario compartido (canUseGoogleToday/markGoogleUsed).
 *
 * FALLBACK DELIBERADO: si esto falla por cualquier motivo (sin red, sin
 * key, tope diario alcanzado, sin resultados), quien llama debe seguir
 * dejando escribir el nombre a mano y guardarlo sin coordenadas — nunca
 * bloquear la creación de una ciudad porque Google no responda. Por eso
 * estas funciones devuelven [] / null en vez de lanzar en los casos
 * esperables de fallo, y solo lanzan en errores de programación real.
 */

export async function searchCitiesGoogle(query, signal) {
  if (!query || query.trim().length < 2) return [];
  const apiKey = await getGoogleMapsApiKey();
  if (!apiKey) { console.warn('[cityPlaces] getGoogleMapsApiKey devolvió clave vacía'); return []; }
  if (!canUseGoogleToday('autocomplete')) return [];
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({
        input: query.trim(),
        includedPrimaryTypes: ['locality'],
        languageCode: getLanguage() === 'en' ? 'en' : 'es',
      }),
      signal,
    });
    if (!res.ok) return [];
    markGoogleUsed('autocomplete');
    const data = await res.json();
    return (data.suggestions || [])
      .map(s => s.placePrediction)
      .filter(Boolean)
      .slice(0, 6)
      .map(p => ({
        placeId: p.placeId,
        name: p.structuredFormat?.mainText?.text || p.text?.text || query,
        secondaryText: p.structuredFormat?.secondaryText?.text || '',
      }));
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return [];
  }
}

export async function fetchCityLocation(placeId, signal) {
  const apiKey = await getGoogleMapsApiKey();
  if (!apiKey || !placeId) return null;
  if (!canUseGoogleToday('placeDetails')) return null;
  try {
    const res = await fetch('https://places.googleapis.com/v1/places/' + placeId, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'location,displayName',
      },
      signal,
    });
    if (!res.ok) return null;
    markGoogleUsed('placeDetails');
    const data = await res.json();
    if (data?.location?.latitude == null || data?.location?.longitude == null) return null;
    return {
      name: data.displayName?.text || null,
      lat: data.location.latitude,
      lng: data.location.longitude,
    };
  } catch {
    return null;
  }
}
