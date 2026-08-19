import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * createTripInvite — único sitio permitido para crear/renovar una invitación
 * a un viaje. Sustituye a las llamadas directas que hacía el cliente contra
 * TripInvite.create/update (ver base44/entities/TripInvite.jsonc, ahora con
 * "create": false).
 *
 * BRECHA QUE CIERRA (encontrada en esta auditoría): TripInvite.create tenía
 * "create": true — cualquier usuario autenticado de Kōdo podía crear una
 * TripInvite a mano vía el SDK, con CUALQUIER trip_id (aunque no fuera
 * miembro de ese viaje), cualquier role (incluido "admin") y un invite_token
 * elegido por él mismo. Como acceptTripInvite/getTripPreview solo comparaban
 * invite.email contra el email del usuario cuando invite.email era "truthy"
 * (`if (invite.email && ...)`), bastaba con crear la invitación con
 * email: "" para saltarse esa comprobación — y con eso, unirse como admin a
 * CUALQUIER viaje ajeno solo sabiendo su id, sin haber sido invitado nunca.
 * Esto deshacía por completo el cierre de Trip.read/Trip.update a "solo
 * miembros" hecho en la ronda anterior.
 *
 * Cierre en dos capas:
 *   1. TripInvite.create ahora es false — nadie puede crear una invitación
 *      directamente, solo esta función (con permisos de servicio).
 *   2. Aquí se exige que quien pide la invitación YA sea miembro actual del
 *      viaje, y que el email de invitado y el invited_by salgan siempre de
 *      datos server-side controlados — nunca los manda el cliente.
 * Además (defensa en profundidad, no depende de esto para estar cerrado):
 * acceptTripInvite y getTripPreview ya no saltan la comprobación de email
 * cuando viene vacío.
 */

const VALID_ROLES = ["admin", "editor", "viewer"];

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
    const requesterEmail = user.email.toLowerCase();

    const { tripId, email: rawEmail, role: rawRole, targetUserId } = await req.json();
    const service = base44.asServiceRole;

    // Si no viene email pero sí targetUserId (invitar a alguien encontrado
    // por username, cuyo email no se conoce en el cliente — ver cierre de
    // la fuga de emails en searchUserProfiles), se resuelve el email aquí
    // con permisos de servicio. Mismo patrón que createNotification/entry.ts.
    let targetEmail = (rawEmail || "").trim().toLowerCase();
    if (!targetEmail && targetUserId) {
      const targetUsers = await service.entities.User.filter({ id: targetUserId });
      targetEmail = (targetUsers[0]?.email || "").trim().toLowerCase();
    }

    if (!tripId || !targetEmail) {
      return Response.json({ error: "Faltan datos" }, { status: 400 });
    }

    const trip = await service.entities.Trip.get(tripId);
    if (!trip) {
      return Response.json({ error: "Viaje no encontrado" }, { status: 404 });
    }

    const members: string[] = (trip.members || []).map((e: string) => norm(e));
    const rawRoles: Record<string, string> = trip.roles || {};
    const roles: Record<string, string> = {};
    for (const [rawEmail, r] of Object.entries(rawRoles)) {
      const key = norm(rawEmail);
      if (key) roles[key] = r as string;
    }

    // La comprobación central: solo alguien que YA es miembro del viaje
    // puede invitar a más gente a él. Esto es lo que antes NO se verificaba
    // en ningún sitio (TripInvite.create era de acceso libre).
    if (!members.includes(requesterEmail)) {
      return Response.json(
        { error: "No eres miembro de este viaje.", code: "not_member" },
        { status: 403 }
      );
    }

    if (members.includes(targetEmail)) {
      return Response.json({ error: "Ese usuario ya es miembro del viaje." }, { status: 400 });
    }

    const requesterIsAdmin = roles[requesterEmail] === "admin" || norm(trip.created_by) === requesterEmail;

    // Solo un admin puede invitar con rol "admin" o "viewer" — cualquier
    // miembro normal puede invitar, pero siempre como "editor" (mismo
    // comportamiento que ya tenía InviteModal.jsx en el cliente; aquí queda
    // garantizado también si alguien se salta la UI).
    let role = VALID_ROLES.includes(rawRole) ? rawRole : "editor";
    if (!requesterIsAdmin) role = "editor";

    const existing = await service.entities.TripInvite.filter({
      trip_id: tripId,
      email: targetEmail,
      status: "pending",
    });

    // Math.random() no es un PRNG criptográficamente seguro (su estado es
    // recuperable a partir de suficientes salidas observadas) — débil para un
    // valor que se trata como secreto (viaja en la URL del email y es lo que
    // demuestra que la invitación es legítima junto al email). El impacto ya
    // estaba mitigado porque además hace falta que el email de sesión
    // coincida, pero crypto.randomUUID() cierra esta debilidad de defensa en
    // profundidad sin coste.
    const inviteToken = crypto.randomUUID().replace(/-/g, '');

    let invite;
    if (existing.length > 0) {
      invite = await service.entities.TripInvite.update(existing[0].id, {
        invite_token: inviteToken,
        invited_by: requesterEmail,
        role,
      });
    } else {
      invite = await service.entities.TripInvite.create({
        trip_id: tripId,
        email: targetEmail,
        role,
        status: "pending",
        invite_token: inviteToken,
        invited_by: requesterEmail,
      });
    }

    return Response.json({ ok: true, invite });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});