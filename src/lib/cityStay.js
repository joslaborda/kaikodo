// José (21 sep 2026, tras volver de León): el alojamiento NO es un plan de un
// día ni tiene hora — es donde te quedas durante toda la estancia en una
// ciudad (una City del viaje). Vive en Spots (type:'hotel', para que lo veas
// y lo abras junto al resto de tus sitios) pero queda FUERA del itinerario
// día a día: nunca entra en el timeline de Hoy/Mañana/Ruta, nunca se numera
// como parada en un mapa de ruta y nunca pide día ni hora.
//
// Un viaje Londres + Manchester tiene un alojamiento por ciudad — se enlaza
// por city_id, no por fecha. Si la misma ciudad se visita dos veces, cada
// estancia (City) tiene el suyo.
export const isStaySpot = (spot) => spot?.type === 'hotel';

// Todo lo que sí es un plan del día — igual que la lista de entrada pero sin
// alojamientos. Sirve aunque un alojamiento antiguo conserve un assigned_date
// de antes de este cambio: se ignora igualmente.
export const withoutStays = (spots = []) => spots.filter(s => !isStaySpot(s));

// Alojamiento de una estancia: UNO por parada. Si hay varios (te equivocaste
// y añadiste el correcto después, o probaste con uno), gana el ÚLTIMO que
// añadiste — lo intuitivo es que "el que acabo de poner" sustituye al
// anterior; antes ganaba el primero y el error se quedaba mostrándose.
export function getCityHotel(spots = [], cityId) {
  if (!cityId) return undefined;
  const hotels = spots.filter(s => s.city_id === cityId && isStaySpot(s));
  if (hotels.length < 2) return hotels[0];
  const stamp = (s) => Date.parse(s.created_date || s.created_at || '') || 0;
  return [...hotels].sort((a, b) => stamp(b) - stamp(a))[0];
}
