import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * scheduleTicketPush — programa EN EL SERVIDOR el aviso "sale tu tren/vuelo"
 * para quienes van a usar un documento (Ticket.used_by).
 *
 * Por qué (José, 21 sep 2026): el recordatorio local lo programa el móvil de
 * cada persona, y un móvil solo se entera de un billete nuevo cuando abre la
 * app. Si subes un billete para Carlos y Carlos no abre la app antes de que
 * salga el tren, no le sonaba nada. Aquí el servidor le deja el aviso ya
 * programado en OneSignal (send_after), a la hora exacta, sin depender de que
 * abra nada.
 *
 * Cómo:
 *  · Quien sube/edita el documento llama a esta función con el id del Ticket
 *    (desde el cliente, best-effort: un fallo aquí nunca debe impedir guardar).
 *  · Se cancelan los avisos anteriores de ese documento (ids guardados en
 *    Ticket.reminder_push_ids) y se programan de nuevo — así editar la hora o
 *    reasignar el billete no deja avisos huérfanos.
 *  · Destinatarios: los que usan el documento (used_by; sin used_by, quien lo
 *    subió), miembros del viaje, SIN quien llama (su propio móvil ya
 *    programa el aviso local, que funciona incluso sin conexión) y respetando
 *    el interruptor notif_enabled de su perfil.
 *  · La hora del billete es "hora local del lugar" sin zona: el cliente manda
 *    tzOffsetMinutes (Date.getTimezoneOffset() de su móvil para esa fecha) y el
 *    servidor la convierte a UTC — mismo criterio que el recordatorio local.
 *  · `cancel: true` retira los avisos (se llama antes de borrar un documento).
 *
 * El texto va en español, como el resto de pushes del servidor
 * (ver createNotification/entry.ts).
 */

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

// Mismos márgenes que src/lib/localReminders.js (MINUTES_BEFORE).
const MINUTES_BEFORE: Record<string, number> = { flight: 240, train: 240, bus: 240, event: 90 };
const LABEL: Record<string, string> = { flight: "Vuelo", train: "Tren", bus: "Bus", event: "Evento" };
// OneSignal no programa indefinidamente lejos: si el aviso cae más allá, no se
// programa aquí (el móvil de cada uno tiene su aviso local como red de seguridad).
const MAX_AHEAD_MS = 25 * 24 * 60 * 60 * 1000;

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

// Igual que src/lib/docHolders.js
function docHolders(ticket: any): string[] {
  const list = Array.isArray(ticket.used_by) ? ticket.used_by.filter(Boolean) : [];
  if (list.length) return list;
  return ticket.created_by ? [ticket.created_by] : [];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Formato que acepta send_after: "2026-09-19 05:57:00 GMT+0000"
function toSendAfter(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00 GMT+0000`;
}

function humanDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

async function cancelPush(notificationId: string): Promise<void> {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY || !notificationId) return;
  try {
    await fetch(`https://api.onesignal.com/notifications/${notificationId}?app_id=${ONESIGNAL_APP_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Key ${ONESIGNAL_REST_API_KEY}` },
    });
  } catch {
    // best-effort: si ya salió o no existe, no pasa nada.
  }
}

async function schedulePush(
  recipientUserId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  sendAt: Date | null,
): Promise<string | null> {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) return null;
  try {
    const res = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${ONESIGNAL_REST_API_KEY}` },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        target_channel: "push",
        include_aliases: { external_id: [recipientUserId] },
        headings: { es: title, en: title },
        contents: { es: body, en: body },
        data,
        ...(sendAt ? { send_after: toSendAfter(sendAt) } : {}),
      }),
    });
    const json = await res.json().catch(() => ({}));
    return json?.id ? String(json.id) : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: "No autenticado" }, { status: 401 });
    const callerEmail = norm(user.email);

    const { ticketId, tzOffsetMinutes, cancel } = await req.json();
    if (!ticketId || typeof ticketId !== "string") {
      return Response.json({ error: "Falta el documento" }, { status: 400 });
    }

    const service = base44.asServiceRole;
    const ticket: any = await service.entities.Ticket.get(ticketId).catch(() => null);
    if (!ticket) return Response.json({ error: "Documento no encontrado" }, { status: 404 });

    const trip: any = await service.entities.Trip.get(ticket.trip_id).catch(() => null);
    if (!trip) return Response.json({ error: "Viaje no encontrado" }, { status: 404 });
    const memberList: string[] = trip.members || [];
    const members = memberList.map(norm);
    if (!members.includes(callerEmail)) {
      return Response.json({ error: "No eres miembro de este viaje" }, { status: 403 });
    }

    // Quien llama tiene que tener acceso real al documento (mismo criterio que
    // el rls de Ticket.jsonc) — no basta con ser miembro del viaje.
    const canTouch =
      norm(ticket.created_by) === callerEmail ||
      (ticket.used_by || []).map(norm).includes(callerEmail) ||
      (ticket.visibility === "shared") ||
      (ticket.visibility === "selected_users" && (ticket.shared_with || []).map(norm).includes(callerEmail));
    if (!canTouch) return Response.json({ error: "Sin acceso a este documento" }, { status: 403 });

    // 1) Retirar los avisos anteriores de este documento.
    const previous: string[] = Array.isArray(ticket.reminder_push_ids) ? ticket.reminder_push_ids : [];
    for (const entry of previous) {
      const id = String(entry).split(":")[1];
      if (id) await cancelPush(id);
    }

    const save = async (ids: string[]) => {
      await service.entities.Ticket.update(ticket.id, { reminder_push_ids: ids }).catch(() => {});
    };

    if (cancel === true) {
      await save([]);
      return Response.json({ ok: true, cancelled: previous.length });
    }

    // 2) ¿Hay algo que programar?
    const category = String(ticket.category || "");
    const minutesBefore = MINUTES_BEFORE[category];
    if (!minutesBefore || !ticket.date || !ticket.time) {
      await save([]);
      return Response.json({ ok: true, scheduled: 0, reason: "sin hora o categoría sin aviso" });
    }
    const tz = Number(tzOffsetMinutes);
    if (!Number.isFinite(tz) || Math.abs(tz) > 14 * 60) {
      return Response.json({ error: "Zona horaria inválida" }, { status: 400 });
    }
    const [y, mo, d] = String(ticket.date).split("-").map(Number);
    const [h, mi] = String(ticket.time).split(":").map(Number);
    if (![y, mo, d, h, mi].every(Number.isFinite)) {
      await save([]);
      return Response.json({ ok: true, scheduled: 0, reason: "fecha u hora no válidas" });
    }
    const departure = Date.UTC(y, mo - 1, d, h, mi) + tz * 60000;
    const now = Date.now();
    if (departure <= now) {
      await save([]);
      return Response.json({ ok: true, scheduled: 0, reason: "ya ha pasado" });
    }
    const fireAt = departure - minutesBefore * 60000;
    if (fireAt - now > MAX_AHEAD_MS) {
      await save([]);
      return Response.json({ ok: true, scheduled: 0, reason: "demasiado lejos" });
    }
    const immediate = fireAt <= now;
    const minutesLeft = immediate ? Math.max(1, Math.round((departure - now) / 60000)) : minutesBefore;

    // 3) Destinatarios: quienes lo usan, miembros, menos quien llama.
    const byNorm = new Map<string, string>(memberList.map((m) => [norm(m), m]));
    const recipients = docHolders(ticket)
      .map(norm)
      .filter((e) => byNorm.has(e) && e !== callerEmail);

    const title = category === "event"
      ? `Evento · empieza en ${humanDuration(minutesLeft)}`
      : `${LABEL[category]} · sale en ${humanDuration(minutesLeft)}`;
    const body = `${ticket.name || LABEL[category]} · ${ticket.time}`;
    const payload = { tripId: ticket.trip_id, type: "doc_time", refId: ticket.id };

    const ids: string[] = [];
    for (const email of recipients) {
      try {
        const found: any[] = await service.entities.User.filter({ email: byNorm.get(email) });
        const recipient = found[0];
        if (!recipient?.id) continue;
        // Respeta el interruptor único de notificaciones de Settings.jsx.
        let profile: any = null;
        try { profile = (await service.entities.UserProfile.filter({ user_id: recipient.id }))[0] || null; } catch { profile = null; }
        if (profile?.notif_enabled === false) continue;
        const nid = await schedulePush(recipient.id, trip.name || "Kaikōdo", `${title} — ${body}`, payload, immediate ? null : new Date(fireAt));
        if (nid) ids.push(`${recipient.id}:${nid}`);
      } catch {
        // un destinatario que falla no debe impedir los demás
      }
    }
    await save(ids);
    return Response.json({ ok: true, scheduled: ids.length, immediate });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
