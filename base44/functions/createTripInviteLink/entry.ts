import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * createTripInviteLink — genera (o reutiliza) el link general de un viaje.
 *
 * Modelo acordado con José (14 sep 2026):
 * - Un solo link ACTIVO por viaje a la vez. Compartirlo varias veces, o que
 *   lo compartan distintos miembros, siempre reutiliza el mismo mientras
 *   siga vigente -- nunca se crea uno nuevo como efecto secundario de
 *   pedirlo otra vez. Solo "regenerar" (regenerateTripInviteLink, acción
 *   explícita desde Ajustes) invalida el actual y crea uno nuevo.
 * - Rol tope "editor", nunca "admin" -- un link que se filtre no debería
 *   poder dar control total del viaje. Si hace falta subir a alguien a
 *   admin después, se hace a mano desde Ajustes (ya existe ese flujo).
 * - Caduca a los 7 días y tiene un tope de 20 usos -- limita el daño de un
 *   link que se filtre fuera del grupo al que iba dirigido.
 * - Solo puede generarlo un EDITOR del viaje (no un viewer) -- un viewer no
 *   debería poder ampliar quién tiene acceso de escritura.
 *
 * Por qué existe como función aparte y no una regla de rls declarativa:
 * TripInviteLink tiene las 4 operaciones cerradas (ver el propio .jsonc) --
 * "reusar si hay uno activo, si no crear" es lógica, no una condición
 * estática que rls pueda expresar.
 */

const ROLE_HIERARCHY: Record<string, number> = { admin: 3, editor: 2, viewer: 1 };
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const LINK_MAX_USES = 20;

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function pickOldestActive(list: any[], now: number): any | null {
  const active = list.filter((l: any) =>
    !l.revoked &&
    l.use_count < l.max_uses &&
    new Date(l.expires_at).getTime() > now
  );
  if (active.length === 0) return null;
  // La más antigua gana -- created_date lo pone Base44 automáticamente en
  // toda entidad. Da igual cuál de las dos peticiones "ganó" la carrera de
  // creación (ver más abajo): las dos convergen siempre en la misma.
  active.sort((a: any, b: any) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());
  return active[0];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }
    const normalizedUserEmail = user.email.toLowerCase();

    const { tripId } = await req.json();
    if (!tripId) {
      return Response.json({ error: "Falta tripId" }, { status: 400 });
    }

    const service = base44.asServiceRole;
    const trip = await service.entities.Trip.get(tripId);
    if (!trip) {
      return Response.json({ error: "Viaje no encontrado" }, { status: 404 });
    }

    const members: string[] = (trip.members || []).map(norm);
    if (!members.includes(normalizedUserEmail)) {
      return Response.json({ error: "No eres miembro de este viaje" }, { status: 403 });
    }

    // Editor o admin (no viewer) -- mismo criterio que computeEditors() en
    // acceptTripInvite/manageTripMember: el creador del viaje siempre
    // cuenta como editor aunque roles no lo tenga explícito.
    const roles: Record<string, string> = trip.roles || {};
    const normRoles: Record<string, string> = {};
    for (const [rawEmail, r] of Object.entries(roles)) {
      const key = norm(rawEmail);
      if (key) normRoles[key] = r as string;
    }
    const isCreator = norm(trip.created_by) === normalizedUserEmail;
    const callerRole = normRoles[normalizedUserEmail] || (isCreator ? "admin" : "viewer");
    if (!isCreator && callerRole === "viewer") {
      return Response.json({ error: "Solo un editor o admin puede generar el link de invitación" }, { status: 403 });
    }

    const now = Date.now();

    // Reutilizar el activo si existe -- ver comentario de cabecera. "Activo"
    // = no revocado, no caducado, con usos disponibles.
    const existingBefore = await service.entities.TripInviteLink.filter(
      { trip_id: tripId, revoked: false },
      "-created_date",
      10
    );
    const activeBefore = pickOldestActive(existingBefore, now);
    if (activeBefore) {
      return Response.json({ ok: true, link: activeBefore, reused: true });
    }

    const token = crypto.randomUUID().replace(/-/g, "");
    const newLink = await service.entities.TripInviteLink.create({
      trip_id: tripId,
      token,
      role: "editor",
      created_by: normalizedUserEmail,
      expires_at: new Date(now + LINK_TTL_MS).toISOString(),
      max_uses: LINK_MAX_USES,
      use_count: 0,
      revoked: false,
    });

    // Condición de carrera: si dos peticiones llegan aquí casi a la vez, las
    // dos pueden haber leído "no hay ninguno activo" y las dos haber creado
    // el suyo -- se relee justo después de crear y, si de verdad hay más de
    // un activo ahora, todas las peticiones convergen en quedarse con el
    // MÁS ANTIGUO (pickOldestActive es determinista, da igual desde qué
    // petición se mire) y revocan la suya propia si no era esa. Así nunca
    // queda más de un link activo de verdad, pase lo que pase con el orden
    // de llegada.
    const existingAfter = await service.entities.TripInviteLink.filter(
      { trip_id: tripId, revoked: false },
      "-created_date",
      10
    );
    const winner = pickOldestActive(existingAfter, now) || newLink;

    if (winner.id !== newLink.id) {
      await service.entities.TripInviteLink.update(newLink.id, { revoked: true });
      return Response.json({ ok: true, link: winner, reused: true });
    }

    return Response.json({ ok: true, link: newLink, reused: false });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
