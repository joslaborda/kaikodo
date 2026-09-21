import { base44 } from '@/api/base44Client';

// José (21 sep 2026, probando MaletaTest): había DOS fuentes de verdad para las
// fechas. Al editar las paradas (Madrid 18–22, Barcelona 22–23) las fechas del
// propio viaje se quedaban en 18–20, y como el estado "activo / próximo /
// finalizado" se calcula con las del viaje, un viaje en curso salía como
// "Finalizado". Además, las paradas añadidas desde Ajustes no recibían `order`,
// así que la lista de viajes las ponía al revés que Home.
//
// Regla nueva (docs/ARQUITECTURA.md): cuando un viaje tiene paradas con
// fechas, las fechas del viaje SE CALCULAN a partir de ellas (la primera fecha
// de inicio y la última de fin) y el orden de las paradas sale de sus fechas.
// Las fechas propias del viaje solo se editan a mano si aún no hay paradas
// con fechas.
export function cityDateSpan(cities = []) {
  const dated = (cities || []).filter(c => c?.start_date && c?.end_date);
  if (!dated.length) return null;
  const start = dated.map(c => c.start_date).sort()[0];
  const end = dated.map(c => c.end_date).sort().slice(-1)[0];
  return { start, end };
}

// El viaje con las fechas efectivas (las de sus paradas si las tiene).
export function applyCityDates(trip, cities = []) {
  if (!trip) return trip;
  const span = cityDateSpan(cities);
  if (!span) return trip;
  if (trip.start_date === span.start && trip.end_date === span.end) return trip;
  return { ...trip, start_date: span.start, end_date: span.end };
}

// Paradas en el orden real del viaje: por fecha de inicio; las que no tienen
// fecha, al final respetando su orden anterior.
export function sortCitiesByDate(cities = []) {
  return [...(cities || [])].sort((a, b) =>
    (a.start_date || '9999-12-31').localeCompare(b.start_date || '9999-12-31')
    || ((a.order ?? 0) - (b.order ?? 0)));
}

// Escribe en el servidor lo que las paradas dicen: orden 0..N-1 por fecha y las
// fechas del viaje. Best-effort (un editor sin permiso sobre Trip no rompe nada:
// la lista de viajes y Home ya calculan las fechas efectivas al mostrarlas).
export async function syncTripFromCities(tripId, queryClient) {
  try {
    if (!tripId) return;
    const cities = await base44.entities.City.filter({ trip_id: tripId });
    const sorted = sortCitiesByDate(cities);
    await Promise.all(sorted.map((c, i) => (c.order === i ? null : base44.entities.City.update(c.id, { order: i }))).filter(Boolean));
    const span = cityDateSpan(cities);
    if (span) {
      const trip = await base44.entities.Trip.get(tripId);
      if (trip && (trip.start_date !== span.start || trip.end_date !== span.end)) {
        await base44.entities.Trip.update(tripId, { start_date: span.start, end_date: span.end });
      }
    }
  } catch (e) {
    console.warn('[tripDates] no se pudo sincronizar el viaje con sus paradas:', e);
  } finally {
    if (queryClient) {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['cities', tripId] });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['allCities'] });
    }
  }
}
