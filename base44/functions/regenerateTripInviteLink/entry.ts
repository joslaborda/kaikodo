import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * regenerateTripInviteLink — invalida el link general activo de un viaje y
 * crea uno nuevo (otros 7 días, otros 20 usos frescos).
 *
 * Solo un ADMIN puede regenerar (más restrictivo que crear uno por primera
 * vez, que puede hacerlo cualquier editor vía createTripInviteLink) -- matar
 * un link que otros ya están usando/compartiendo es una acción con más
 * impacto que simplemente pedir uno si no existe todavía.
 */

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_MAX_USES = 20;

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
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

    const isCreator = norm(trip.created_by) === normalizedUserEmail;
    const admins: string[] = (trip.admins || []).map(norm);
    if (!isCreator && !admins.includes(normalizedUserEmail)) {
      return Response.json({ error: "Solo un admin puede regenerar el link de invitación" }, { status: 403 });
    }

    // Revocar cualquier link no revocado que quedara para este viaje --
    // normalmente será uno solo (el modelo es "un activo a la vez"), pero
    // se revocan todos los que encuentre por si acaso, no solo el primero.
    const existing = await service.entities.TripInviteLink.filter({ trip_id: tripId, revoked: false }, "-created_date", 10);
    for (const link of existing) {
      await service.entities.TripInviteLink.update(link.id, { revoked: true });
    }

    const now = Date.now();
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

    return Response.json({ ok: true, link: newLink });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
