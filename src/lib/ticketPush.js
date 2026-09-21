import { base44 } from '@/api/base44Client';
import { cancelTicketReminder } from '@/lib/localReminders';

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
    const res = await base44.functions.invoke('scheduleTicketPush', { ticketId: ticket.id, tzOffsetMinutes });
    // El servidor ya avisa a quien guarda el documento → se retira su aviso local
    // (el que se programó al guardar) para que no salgan dos.
    const body = res?.data ?? res;
    if (body?.callerScheduled) await cancelTicketReminder(ticket.id);
  } catch {
    // best-effort
  }
}

// Llamar ANTES de borrar un documento (después ya no se puede leer). El borrado
// espera a esto, así que nunca se le deja colgado más de 4 s: si la función está
// fría o tarda, se borra igualmente (un aviso huérfano solo se ignora al sonar).
export async function cancelTicketPush(ticketId) {
  try {
    if (!ticketId) return;
    await Promise.race([
      base44.functions.invoke('scheduleTicketPush', { ticketId, cancel: true }),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  } catch {
    // best-effort
  }
}

export { hasServerPushFor } from '@/lib/docHolders';
