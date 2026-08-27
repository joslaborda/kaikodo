import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import i18n from '@/i18n';
import { createPageUrl } from '@/utils';

// Recordatorios locales en el propio dispositivo para vuelos, trenes, bus y
// actividades con hora asignada. A diferencia de las notificaciones push
// (ver pushNotifications.js), no dependen de conexion ni de que el backend
// dispare nada -- se programan en el propio SO al guardar el vuelo/tren/
// actividad, asi que siguen funcionando aunque el movil este en modo avion
// durante el propio viaje. No-op fuera de la app nativa (Capacitor).

const MINUTES_BEFORE = {
  flight: 240,
  train: 240,
  bus: 240,
  event: 90,
  default: 120,
};

let permissionChecked = false;

// Capacitor exige un id numerico por notificacion. Se deriva un entero
// estable a partir del id de string de la entidad (hash simple) en vez de
// un contador, para poder cancelar/reprogramar el mismo aviso mas tarde
// (tras cerrar y reabrir la app, o desde otra pantalla) sin tener que
// guardar el id numerico en ningun sitio.
function idFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647;
}

async function ensurePermission() {
  if (!Capacitor.isNativePlatform()) return false;
  if (permissionChecked) return true;
  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display !== 'granted') {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== 'granted') return false;
    }
    permissionChecked = true;
    return true;
  } catch {
    return false;
  }
}

function parseDateTime(date, time) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const [h, m] = (time || '00:00').split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

async function scheduleAt({ id, title, body, at, eventAt, extra }) {
  if (!Capacitor.isNativePlatform()) return;
  if (!(at instanceof Date)) return;
  const now = Date.now();
  let fireAt = at;
  if (fireAt.getTime() <= now) {
    // El margen de aviso (90min para evento, 4h para transporte...) ya ha
    // pasado en el momento de guardar/editar el documento -- p.ej. una
    // actividad añadida con menos antelación de la que pide su categoría
    // (probado en vivo: evento a 7 min, margen de 90 min -> la hora de
    // aviso calculada ya estaba en el pasado y no saltaba nada). Mientras
    // el propio evento no haya pasado TODAVÍA, mejor avisar ya (con margen
    // reducido a unos segundos) que no avisar nunca. Si el evento en sí ya
    // pasó también, ahí sí no tiene sentido notificar nada.
    if (!(eventAt instanceof Date) || eventAt.getTime() <= now) return;
    fireAt = new Date(now + 5000);
  }
  const ok = await ensurePermission();
  if (!ok) return;
  try {
    await LocalNotifications.schedule({ notifications: [{ id, title, body, schedule: { at: fireAt }, extra }] });
  } catch {}
}

async function cancelId(id) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch {}
}

// Vuelos / trenes / bus / eventos con hora (entidad Ticket, category
// flight|train|bus|event). No incluye 'hotel' (el aviso "4h antes del
// check-in" no aporta nada) ni 'personal'/'other' (no siempre llevan hora).
// `ticket.trip_id` es obligatorio para poder abrir el documento exacto al
// tocar la notificacion (ver handleNotificationTap en main.jsx) -- mismo
// destino que ya usa NotificationBell.jsx: Documents?trip_id=...&doc_id=...
export async function scheduleTicketReminder(ticket) {
  if (!ticket?.id || !ticket?.trip_id || !['flight', 'train', 'bus', 'event'].includes(ticket.category)) return;
  const dt = parseDateTime(ticket.date, ticket.time);
  if (!dt) return;
  const minutesBefore = MINUTES_BEFORE[ticket.category] ?? MINUTES_BEFORE.default;
  const at = new Date(dt.getTime() - minutesBefore * 60000);
  const label = i18n.t(`reminders.category.${ticket.category}`);
  const route = ticket.origin && ticket.destination ? `${ticket.origin} -> ${ticket.destination}` : (ticket.name || label);
  const hoursLabel = minutesBefore >= 60 ? i18n.t('reminders.hoursShort', { count: Math.round(minutesBefore / 60) }) : i18n.t('reminders.minutesShort', { count: minutesBefore });
  // Cuánto tiempo se deja la notificación entregada en la bandeja después de
  // la hora del propio vuelo/tren/evento antes de retirarla sola (estilo
  // Wallet: la tarjeta desaparece cuando ya no aplica, no hace falta que el
  // usuario la descarte a mano). 2h para transporte (cubre el trayecto en
  // sí), 1h para eventos (cubre que la actividad siga en marcha un rato).
  const graceMs = (ticket.category === 'event' ? 1 : 2) * 60 * 60000;
  const expiresAt = new Date(dt.getTime() + graceMs).toISOString();
  await scheduleAt({
    id: idFromString(`ticket-${ticket.id}`),
    title: i18n.t('reminders.ticketTitle', { label, time: hoursLabel }),
    body: `${route} - ${ticket.time}`,
    at,
    eventAt: dt,
    extra: { kind: 'doc', tripId: ticket.trip_id, docId: ticket.id, expiresAt },
  });
}

export async function cancelTicketReminder(ticketId) {
  if (!ticketId) return;
  await cancelId(idFromString(`ticket-${ticketId}`));
}

// Actividades / lugares con hora asignada (entidad Spot)
export async function scheduleSpotReminder(spot) {
  if (!spot?.id) return;
  const dt = parseDateTime(spot.assigned_date, spot.assigned_time);
  if (!dt) return;
  const minutesBefore = MINUTES_BEFORE.default;
  const at = new Date(dt.getTime() - minutesBefore * 60000);
  await scheduleAt({
    id: idFromString(`spot-${spot.id}`),
    title: i18n.t('reminders.spotTitle', { title: spot.title, minutes: minutesBefore }),
    body: spot.assigned_time || '',
    at,
    eventAt: dt,
  });
}

export async function cancelSpotReminder(spotId) {
  if (!spotId) return;
  await cancelId(idFromString(`spot-${spotId}`));
}

// Al tocar un recordatorio local de vuelo/tren/evento, abrir directamente el
// documento en vez de dejar caer al usuario en la pantalla de inicio. Mismo
// destino y misma convencion de query params que ya usa NotificationBell.jsx
// para las notificaciones in-app (?trip_id=...&doc_id=...) -- un solo
// esquema de deep-link en toda la app, no dos. Cubre tanto el toque con la
// app en segundo plano como con la app completamente cerrada (Capacitor
// entrega la accion pendiente en cuanto este listener queda registrado, que
// es justo lo que hace initPushNotifications/clearDeliveredNotifications ya
// en el arranque de main.jsx).
export function initNotificationTapHandler() {
  if (!Capacitor.isNativePlatform()) return;
  LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const extra = notification?.extra;
    if (extra?.kind === 'doc' && extra?.tripId && extra?.docId) {
      window.location.href = `${createPageUrl('Documents')}?trip_id=${encodeURIComponent(extra.tripId)}&doc_id=${encodeURIComponent(extra.docId)}`;
    }
  }).catch(() => {});
}

// Estilo Wallet: una vez pasada la hora del vuelo/tren/evento (+ el margen
// de expiresAt calculado en scheduleTicketReminder), la notificación ya
// entregada se retira sola de la bandeja/pantalla de bloqueo -- no hace
// falta que el usuario la descarte a mano, igual que una tarjeta de embarque
// desaparece de Wallet sola cuando ya no aplica. Tocarla ya la descarta por
// sí sola (comportamiento nativo del SO al tocar cualquier notificación),
// así que esto solo cubre el caso de que nunca se toque: se llama en cada
// arranque/vuelta a primer plano (ver main.jsx), igual que
// clearDeliveredNotifications ya hace para las push.
export async function clearStaleDeliveredNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { notifications } = await LocalNotifications.getDeliveredNotifications();
    const now = Date.now();
    const staleIds = (notifications || [])
      .filter(n => n?.extra?.kind === 'doc' && n?.extra?.expiresAt && new Date(n.extra.expiresAt).getTime() <= now)
      .map(n => n.id);
    if (staleIds.length) {
      await LocalNotifications.removeDeliveredNotificationsById({ ids: staleIds });
    }
  } catch {}
}