import { base44 } from '@/api/base44Client';

// José (21 sep 2026): el aviso "sale tu tren/vuelo" de las personas que USAN un
// documento (used_by) lo programa el SERVIDOR (base44/functions/scheduleTicketPush)
// en cuanto se sube o edita, a la hora exacta y sin que esa persona tenga que
// abrir la app. El recordatorio local (localReminders.js) sigue existiendo para
// el móvil de quien sube el documento y como red de seguridad sin conexión.
//
// Todo aquí es best-effort: un fallo NUNCA debe impedir guardar o borrar un
// documento.
const PUSH_CATEGORIES = ['flight', 'train', 'bus', 'event'];

// Llamar después de guardar (crear o editar) un documento.
export async function requestTicketPush(ticket) {
  try {
    if (!ticket?.id) return;
    // Si ya no lleva hora/categoría con aviso, se llama igualmente si tenía
    // avisos programados: el servidor los retira.
    const hadPush = Array.isArray(ticket.reminder_push_ids) && ticket.reminder_push_ids.length > 0;
    if (!PUSH_CATEGORIES.includes(ticket.category) && !hadPush) return;
    // Desfase de ESTE móvil para esa fecha y hora (respeta el horario de
    // verano) — la hora de un billete es "hora local del lugar" sin zona, y el
    // servidor la necesita en UTC. Mismo criterio que el recordatorio local.
    const dt = new Date(`${ticket.date}T${ticket.time || '00:00'}:00`);
    const tzOffsetMinutes = Number.isNaN(dt.getTime()) ? new Date().getTimezoneOffset() : dt.getTimezoneOffset();
    await base44.functions.invoke('scheduleTicketPush', { ticketId: ticket.id, tzOffsetMinutes });
  } catch {
    // best-effort
  }
}

// Llamar ANTES de borrar un documento (después ya no se puede leer).
export async function cancelTicketPush(ticketId) {
  try {
    if (!ticketId) return;
    await base44.functions.invoke('scheduleTicketPush', { ticketId, cancel: true });
  } catch {
    // best-effort
  }
}

// ¿El servidor ya tiene programado un aviso para este usuario en este documento?
// Si es así, su móvil no programa el aviso local (saldrían dos iguales).
export function hasServerPushFor(ticket, userId) {
  if (!userId) return false;
  return (ticket?.reminder_push_ids || []).some(s => String(s).startsWith(userId + ':'));
}
