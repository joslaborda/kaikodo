import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import i18n from '@/i18n';

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

async function scheduleAt({ id, title, body, at }) {
  if (!Capacitor.isNativePlatform()) return;
  if (!(at instanceof Date) || at.getTime() <= Date.now()) return;
  const ok = await ensurePermission();
  if (!ok) return;
  try {
    await LocalNotifications.schedule({ notifications: [{ id, title, body, schedule: { at } }] });
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
export async function scheduleTicketReminder(ticket) {
  if (!ticket?.id || !['flight', 'train', 'bus', 'event'].includes(ticket.category)) return;
  const dt = parseDateTime(ticket.date, ticket.time);
  if (!dt) return;
  const minutesBefore = MINUTES_BEFORE[ticket.category] ?? MINUTES_BEFORE.default;
  const at = new Date(dt.getTime() - minutesBefore * 60000);
  const label = i18n.t(`reminders.category.${ticket.category}`);
  const route = ticket.origin && ticket.destination ? `${ticket.origin} -> ${ticket.destination}` : (ticket.name || label);
  const hoursLabel = minutesBefore >= 60 ? i18n.t('reminders.hoursShort', { count: Math.round(minutesBefore / 60) }) : i18n.t('reminders.minutesShort', { count: minutesBefore });
  await scheduleAt({
    id: idFromString(`ticket-${ticket.id}`),
    title: i18n.t('reminders.ticketTitle', { label, time: hoursLabel }),
    body: `${route} - ${ticket.time}`,
    at,
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
  });
}

export async function cancelSpotReminder(spotId) {
  if (!spotId) return;
  await cancelId(idFromString(`spot-${spotId}`));
}