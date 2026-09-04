/**
 * decodeInvitePreview — lee el parámetro `preview` que sendTripInvite (ver
 * src/lib/invites.js) embebe en el propio enlace de invitación, para poder
 * mostrar "X te invita a un viaje a Y" en la pantalla de registro antes de
 * que esa persona tenga sesión.
 *
 * No verifica firma ni nada — el contenido no es sensible (es lo mismo que
 * ya va en texto plano en el email), así que no hace falta. Simplemente
 * nunca revienta: si el parámetro falta, está corrupto o alguien lo ha
 * manipulado a mano, devuelve null y la pantalla de registro sigue
 * funcionando igual, solo que sin el aviso.
 */
export function decodeInvitePreview(rawParam) {
  if (!rawParam) return null;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(rawParam))));
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object') return null;
    const destination = data.d || data.n || '';
    if (!destination) return null;
    return {
      name: data.n || '',
      destination: data.d || '',
      country: data.c || '',
      inviterName: data.i || '',
    };
  } catch {
    return null;
  }
}
