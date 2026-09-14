import { base44 } from '@/api/base44Client';
import { getLanguage } from '@/i18n/index.js';

// Mismo patrón que sendTripInvite en src/lib/invites.js: la vista previa
// (nombre/destino del viaje) viaja embebida en el propio link en base64, sin
// firmar -- no es sensible, es lo mismo que ya iría en texto plano en un
// email. La validación real de si el link sigue siendo válido para unirse
// (caducidad/revocado/usos) se hace siempre server-side contra el token,
// nunca contra este payload.
function buildPreviewBlob(trip) {
  const payload = {
    n: trip?.name || '',
    d: trip?.destination || '',
    c: trip?.country || '',
  };
  return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
}

function unwrap(result) {
  const data = result?.data ?? result;
  if (data?.error) {
    const err = new Error(data.error);
    if (data.code) err.code = data.code;
    throw err;
  }
  return data;
}

// Vista previa del viaje para alguien que todavía no es miembro (el
// equivalente de getTripPreview, pero sin ningún email que comprobar --
// la validez viene del propio token del link).
export async function getTripInviteLinkPreview(linkToken) {
  let result;
  try {
    result = await base44.functions.invoke('getTripInviteLinkPreview', { linkToken });
  } catch (e) {
    const serverError = e?.response?.data?.error || e?.data?.error;
    const err = new Error(serverError || e?.message || 'No se pudo cargar el viaje.');
    const code = e?.response?.data?.code || e?.data?.code;
    if (code) err.code = code;
    throw err;
  }
  return unwrap(result);
}


// Crea (o reutiliza, si ya hay uno activo) el link general del viaje. Un
// solo link activo a la vez -- compartir varias veces siempre reusa el
// mismo mientras siga vigente, ver createTripInviteLink/entry.ts.
export async function getOrCreateTripInviteLink(tripId) {
  let result;
  try {
    result = await base44.functions.invoke('createTripInviteLink', { tripId });
  } catch (e) {
    const serverError = e?.response?.data?.error || e?.data?.error;
    throw new Error(serverError || e?.message || 'No se pudo generar el enlace.');
  }
  return unwrap(result).link;
}

// Solo un admin -- invalida el actual y genera uno nuevo (otros 7 días,
// otros 20 usos).
export async function regenerateTripInviteLink(tripId) {
  let result;
  try {
    result = await base44.functions.invoke('regenerateTripInviteLink', { tripId });
  } catch (e) {
    const serverError = e?.response?.data?.error || e?.data?.error;
    throw new Error(serverError || e?.message || 'No se pudo regenerar el enlace.');
  }
  return unwrap(result).link;
}

// La unión en sí corre en el backend (redeemTripInviteLink), con permisos de
// servicio -- mismo motivo que acceptTripInvite: añadirse a Trip.members
// necesita saltarse el rls normal, y la sincronización de trip_members en el
// contenido ya existente del viaje necesita permisos de servicio para no
// depender de que el nuevo miembro ya figure ahí (que es justo lo que está
// arreglando).
export async function redeemTripInviteLink(linkToken) {
  let result;
  try {
    result = await base44.functions.invoke('redeemTripInviteLink', { token: linkToken });
  } catch (e) {
    const serverError = e?.response?.data?.error || e?.data?.error;
    const err = new Error(serverError || e?.message || 'No se pudo unir al viaje.');
    const code = e?.response?.data?.code || e?.data?.code;
    if (code) err.code = code;
    throw err;
  }
  return unwrap(result).trip;
}

export function buildTripInviteLinkUrl(link, trip) {
  const preview = buildPreviewBlob(trip);
  return `${window.location.origin}/Invites?linkToken=${link.token}&preview=${preview}`;
}

// Texto para compartir por WhatsApp/Telegram/etc. -- José (14 sep 2026):
// SOLO el link, nunca ningún email (no hay ninguno que mostrar, además: este
// es el link general, no está atado a nadie en concreto). Nunca debe decir
// "es solo para ti" -- a diferencia del link personal, este sí sirve para
// varias personas (hasta el tope de usos). Mismo patrón que el email de
// invitación: idioma activo de quien comparte, getLanguage() -- el
// destinatario normalmente no tiene cuenta todavía, no hay otro idioma que
// consultar.
export function buildTripInviteLinkShareText(trip, inviterName, url) {
  const lang = getLanguage();
  const destination = trip?.destination || trip?.name || '';
  if (lang === 'en') {
    return `${inviterName ? inviterName + ' invited' : "You're invited"} you to ${destination} on Kaikōdo \uD83E\uDDF3 join with this link: ${url}`;
  }
  return `${inviterName ? inviterName + ' te invita' : 'Te invitan'} a ${destination} en Kaikōdo \uD83E\uDDF3 únete con este enlace: ${url}`;
}
