import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * leaveTrip — quita a QUIEN LLAMA (nunca a otra persona) de members/roles/
 * admins de un viaje. Pensada para el flujo de "borrar mi cuenta"
 * (src/pages/Settings.jsx), que antes hacía esto con
 * base44.entities.Trip.update() directo desde el cliente.
 *
 * Por qué hace falta una función aparte de manageTripMember: esta auditoría
 * encontró que Trip.update estaba abierto a "cualquier miembro actual" (ver
 * el comentario largo en base44/entities/Trip.jsonc) precisamente porque
 * salir del viaje / borrar la cuenta necesitaba poder tocar members/roles
 * sin ser admin. Ahora que Trip.update exige ser admin (rls: data.admins),
 * salir del viaje YA NO puede hacerse desde el cliente en absoluto — tiene
 * que correr aquí, con permisos de servicio.
 *
 * A diferencia de manageTripMember (acción "remove", pensada para que un
 * admin expulse a OTRO y por tanto bloquea quitar al último admin), aquí
 * SIEMPRE se permite salir, sea cual sea tu rol — borrar la propia cuenta no
 * puede quedar bloqueado por "eres el último admin". Si quien se va era el
 * único admin y quedan más miembros, se asciende automáticamente a admin al
 * primero de los que queden (mismo criterio que "quién es el más antiguo" =
 * primera posición en members), para que el viaje nunca se quede sin nadie
 * que pueda gestionarlo. Si no queda nadie más, el viaje se queda sin
 * members/roles/admins — huérfano pero inofensivo (nadie puede ya ni leerlo
 * ni escribirlo salvo su dueño original vía "delete", que sigue abierto a
 * created_by).
 */

const SYNCED_ENTITIES = [
  "City", "Expense", "Ticket", "TripMessage", "DiaryEntry",
  "PackingItem", "Spot", "ItineraryDay", "TodoItem", "UsefulInfo",
];

// Ver el mismo comentario en manageTripMember/entry.ts y syncTripMembers.js.
const ROLE_AWARE_ENTITIES = ["City", "Expense"];

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function computeEditors(members: string[], createdBy: string, roles: Record<string, string>): string[] {
  const createdByNorm = norm(createdBy);
  const normRoles: Record<string, string> = {};
  for (const [rawEmail, r] of Object.entries(roles || {})) {
    const key = norm(rawEmail);
    if (key) normRoles[key] = r;
  }
  return members.filter((email) => {
    const key = norm(email);
    if (key === createdByNorm) return true;
    return (normRoles[key] || "viewer") !== "viewer";
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }
    const myEmail = user.email.trim().toLowerCase();

    const { tripId } = await req.json();
    if (!tripId || typeof tripId !== "string") {
      return Response.json({ error: "Falta el viaje" }, { status: 400 });
    }

    const service = base44.asServiceRole;

    let finalTrip: any = null;
    for (let intento = 0; intento < 4 && !finalTrip; intento++) {
      const trip = await service.entities.Trip.get(tripId);
      if (!trip) {
        // Ya no existe (p. ej. lo borró su dueño mientras tanto) — para
        // quien intenta salir, el resultado que quiere (no seguir siendo
        // miembro) ya se cumple igualmente.
        return Response.json({ ok: true, trip: null });
      }

      const members: string[] = trip.members || [];
      if (!members.some((m) => (m || "").trim().toLowerCase() === myEmail)) {
        // Ya no eres miembro (p. ej. doble clic, o ya se procesó antes) —
        // nada que hacer, no es un error para quien llama.
        return Response.json({ ok: true, trip });
      }

      const roles: Record<string, string> = trip.roles || {};
      const roleKey = Object.keys(roles).find((k) => (k || "").trim().toLowerCase() === myEmail);

      const newMembers = members.filter((m) => (m || "").trim().toLowerCase() !== myEmail);
      const newRoles = { ...roles };
      if (roleKey) delete newRoles[roleKey];

      let newAdmins = Object.keys(newRoles).filter((k) => newRoles[k] === "admin");
      if (newAdmins.length === 0 && newMembers.length > 0) {
        // Se fue el último admin y quedan más miembros: se asciende al
        // primero (mismo email, con su casing original) para que el viaje
        // no se quede sin nadie que lo pueda gestionar.
        const successor = newMembers[0];
        const successorKey = Object.keys(newRoles).find((k) => (k || "").trim().toLowerCase() === successor.trim().toLowerCase()) || successor;
        newRoles[successorKey] = "admin";
        newAdmins = [successor];
      }

      await service.entities.Trip.update(tripId, { members: newMembers, roles: newRoles, admins: newAdmins });

      const check = await service.entities.Trip.get(tripId);
      const stillThere = (check.members || []).some((m: string) => (m || "").trim().toLowerCase() === myEmail);
      if (!stillThere) {
        finalTrip = check;
        break;
      }

      await new Promise((r) => setTimeout(r, 120 * (intento + 1)));
    }

    if (!finalTrip) {
      return Response.json(
        { error: "No se pudo salir del viaje. Vuelve a intentarlo.", code: "conflict" },
        { status: 409 }
      );
    }

    // Sincronizar trip_members en el contenido YA EXISTENTE del viaje —
    // mismo bug de seguridad que manageTripMember (acción "remove") pero en
    // la ruta de auto-abandono: sin esto, quien se va conserva su email en el
    // trip_members de cada gasto/documento/mensaje/etc. creado antes de su
    // salida y sigue pudiendo leer/editar/borrar todo ese contenido para
    // siempre, pese a ya no ser miembro del viaje.
    for (const entityName of SYNCED_ENTITIES) {
      try {
        const records = await service.entities[entityName].filter({ trip_id: tripId });
        const editors = computeEditors(finalTrip.members || [], finalTrip.created_by, finalTrip.roles || {});
        const patch = ROLE_AWARE_ENTITIES.includes(entityName)
          ? { trip_members: finalTrip.members, trip_editors: editors }
          : { trip_members: finalTrip.members };
        for (const record of records) {
          await service.entities[entityName].update(record.id, patch);
        }
      } catch (e) { /* no bloquear la respuesta por un fallo puntual de una entidad */ }
    }

    return Response.json({ ok: true, trip: finalTrip });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});