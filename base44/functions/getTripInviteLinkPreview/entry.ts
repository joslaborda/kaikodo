import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * getTripInviteLinkPreview — igual que getTripPreview, pero para el link
 * general (TripInviteLink) en vez de una invitación personal (TripInvite).
 * No hay ningún email que comprobar -- la validez viene entera del token:
 * que exista, no esté revocado, no haya caducado y no supere el tope de usos.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const { linkToken } = await req.json();
    if (!linkToken) {
      return Response.json({ error: "Falta el token del enlace" }, { status: 400 });
    }

    const service = base44.asServiceRole;

    const matches = await service.entities.TripInviteLink.filter({ token: linkToken }, "-created_date", 2);
    const link = matches[0];

    if (!link) {
      return Response.json({ error: "Este enlace no es válido.", code: "not_found" }, { status: 404 });
    }
    if (link.revoked) {
      return Response.json({ error: "Este enlace ya no está activo. Pide uno nuevo a quien organiza el viaje.", code: "revoked" }, { status: 410 });
    }
    if (new Date(link.expires_at).getTime() <= Date.now()) {
      return Response.json({ error: "Este enlace ha caducado. Pide uno nuevo a quien organiza el viaje.", code: "expired" }, { status: 410 });
    }
    if (link.use_count >= link.max_uses) {
      return Response.json({ error: "Este enlace ya ha alcanzado su límite de usos. Pide uno nuevo a quien organiza el viaje.", code: "maxed_out" }, { status: 410 });
    }

    const trip = await service.entities.Trip.get(link.trip_id);
    if (!trip) {
      return Response.json({ error: "Viaje no encontrado" }, { status: 404 });
    }

    // Mismo subconjunto mínimo que getTripPreview -- nada de roles,
    // ai_preferences, etc.
    return Response.json({
      trip: {
        id: trip.id,
        name: trip.name,
        destination: trip.destination,
        country: trip.country,
        start_date: trip.start_date,
        end_date: trip.end_date,
        members: trip.members || [],
      },
      link: {
        role: link.role,
        usesLeft: link.max_uses - link.use_count,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
