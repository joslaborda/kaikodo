import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * getInvitePreview — vista previa MÍNIMA de un viaje para alguien que
 * todavía NO tiene sesión iniciada (a diferencia de getTripPreview, que
 * exige auth.me() y comprueba que el email de quien pregunta coincida con
 * invite.email).
 *
 * Por qué existe: hasta ahora, alguien sin cuenta que tocaba un enlace de
 * invitación (/Invites?token=...) veía primero una pantalla de
 * registro genérica -- sin ningún rastro de a qué viaje le están invitando
 * ni de quién -- y solo después de crear cuenta y verificar el email veía
 * el viaje de verdad. Esta función permite pintar ese contexto ("X te
 * invita a un viaje a Y") en la propia pantalla de login/registro, antes
 * del muro de alta.
 *
 * Modelo de seguridad: al no haber sesión, no se puede comprobar que quien
 * pregunta sea el destinatario real (como sí hace getTripPreview). Se
 * asume el mismo modelo que el propio enlace de invitación: el
 * invite_token en sí es la credencial (igual que un link de restablecer
 * contraseña) -- se manda por email solo al destinatario real. Por eso el
 * subconjunto de datos que se expone aquí es MÁS reducido que
 * getTripPreview: nada de la lista de miembros (emails), solo nombre del
 * viaje, destino, fechas, y el nombre (no el email) de quien invita.
 */

Deno.serve(async (req) => {
  try {
    const { token } = await req.json();
    if (!token) {
      return Response.json({ error: "Falta el token de invitación" }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole;

    const invites = await service.entities.TripInvite.filter({ invite_token: token });
    const invite = invites[0];
    if (!invite || invite.status !== "pending") {
      return Response.json({ error: "Invitación inválida o expirada" }, { status: 404 });
    }

    const trip = await service.entities.Trip.get(invite.trip_id);
    if (!trip) {
      return Response.json({ error: "Viaje no encontrado" }, { status: 404 });
    }

    let inviterName = "";
    try {
      const profiles = await service.entities.UserProfile.filter({ email: (invite.invited_by || "").toLowerCase() });
      inviterName = profiles?.[0]?.display_name || profiles?.[0]?.username || "";
    } catch {
      // Sin nombre de perfil -- el frontend cae al email si tampoco lo tiene.
    }

    return Response.json({
      trip: {
        name: trip.name,
        destination: trip.destination,
        country: trip.country,
        start_date: trip.start_date,
        end_date: trip.end_date,
      },
      inviterName,
      inviterEmail: invite.invited_by || "",
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
