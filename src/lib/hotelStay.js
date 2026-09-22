import { base44 } from '@/api/base44Client';
import { isStaySpot } from '@/lib/cityStay';

import { invalidateTripDocs } from '@/hooks/useTripDocs';
// José (21 sep 2026): el alojamiento y su reserva son UNA sola cosa vista
// desde dos puertas —
//   · subes la reserva (documento de tipo Hotel) → queda puesto el
//     alojamiento de esa ciudad (Spot type:'hotel');
//   · añades el alojamiento desde Spots/Home/Ruta → se ofrece subir la
//     reserva (opcional).
// Se enlazan con Ticket.spot_id (no por adivinar el nombre). Esta función es
// la única que crea/actualiza el alojamiento a partir de una reserva.
//
// Devuelve el Spot enlazado (o null si no aplica). Nunca lanza: una reserva
// no debe fallar al guardarse porque falle la sincronización del alojamiento.
const norm = (s) => (s || '').toString().trim().toLowerCase();
const near = (a, b) => Math.abs(a - b) < 0.0008;

export async function linkHotelDocToStay({ doc, tripId, trip, cities = [], userEmail, userId, queryClient }) {
  try {
    if (!doc?.id || doc.category !== 'hotel' || !doc.name?.trim() || !tripId) return null;
    // Ciudad de la reserva: la elegida en el desplegable de fecha; si no hay
    // (fecha escrita a mano), la estancia que contiene esa fecha, o la única
    // ciudad del viaje.
    const cityId = doc.city_id
      || cities.find(c => c.start_date && c.end_date && doc.date >= c.start_date && doc.date <= c.end_date)?.id
      || (cities.length === 1 ? cities[0].id : null);
    if (!cityId) return null;
    const title = (doc.location_name || doc.name).trim();
    const hasCoords = typeof doc.location_lat === 'number' && typeof doc.location_lng === 'number';
    const city = cities.find(c => c.id === cityId);

    const spots = await base44.entities.Spot.filter({ trip_id: tripId });
    const stays = spots.filter(s => s.city_id === cityId && isStaySpot(s));

    // 1) el ya enlazado; 2) el mismo sitio (mismas coordenadas o mismo nombre)
    let stay = stays.find(s => s.id === doc.spot_id)
      || stays.find(s => hasCoords && s.lat && s.lng && near(s.lat, doc.location_lat) && near(s.lng, doc.location_lng))
      || stays.find(s => norm(s.title) === norm(title));

    if (stay) {
      const patch = {};
      if (hasCoords && (!stay.lat || !stay.lng)) { patch.lat = doc.location_lat; patch.lng = doc.location_lng; }
      if (Object.keys(patch).length) await base44.entities.Spot.update(stay.id, patch);
    } else {
      // Sin coordenadas también se crea (nombre a mano): sale en "Te alojas en X"
      // aunque no haya pin.
      //
      // José (22 sep 2026): "los hoteles se quedan como spots creados por mí,
      // y eso no es correcto, ya existen en Google -- si fuesen Airbnb sí te
      // lo compraba". `hasCoords` es la señal fiable: DocumentForm.jsx SOLO
      // rellena location_lat/location_lng cuando el usuario elige un
      // resultado real de Google Places (autocomplete + place details) --
      // no hay ningún input numérico a mano para esto. Así que un hotel con
      // coords es, por definición, un sitio que ya existe en Google: se
      // guarda como "guardado" (saved_by), igual que cualquier spot que
      // viene de una búsqueda de Google en Restaurants.jsx. Un hotel sin
      // coords (nombre escrito a mano, sin match en Google -- el caso
      // Airbnb) sigue siendo, con razón, creado por el usuario.
      const fromGoogle = hasCoords;
      stay = await base44.entities.Spot.create({
        trip_id: tripId, city_id: cityId,
        city_name: city?.name || doc.city || '', country: city?.country || undefined,
        title, type: 'hotel',
        ...(hasCoords ? { lat: doc.location_lat, lng: doc.location_lng } : {}),
        visibility: 'trip_members', visited: false,
        source: fromGoogle ? 'google_places' : 'hotel_doc',
        ...(fromGoogle
          ? { created_by: null, created_by_user_id: null, saved_by: [userEmail].filter(Boolean) }
          : { created_by: userEmail || undefined, created_by_user_id: userId || undefined }),
        trip_members: trip?.members || [],
      });
    }

    if (stay?.id && doc.spot_id !== stay.id) await base44.entities.Ticket.update(doc.id, { spot_id: stay.id });
    if (queryClient) {
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      invalidateTripDocs(queryClient, tripId);
    }
    return stay || null;
  } catch (e) {
    console.warn('[hotelStay] no se pudo sincronizar el alojamiento:', e);
    return null;
  }
}
