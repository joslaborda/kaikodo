import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * redeemTripInviteLink — une al usuario autenticado al viaje de un link
 * general (TripInviteLink), tras validar token/caducidad/revocado/usos.
 *
 * IMPORTANTE -- duplicación deliberada con acceptTripInvite/entry.ts:
 * la lógica de "añadir a Trip.members/roles/admins con reintentos, luego
 * sincronizar trip_members/trip_editors en el contenido existente del
 * viaje" es la MISMA en los dos archivos, copiada a propósito en vez de
 * compartida desde un módulo común. Este proyecto no tiene ningún caso hoy
 * de una función de Base44 important desde fuera de su propia carpeta, y no
 * hay forma de probar en vivo si el despliegue de Base44 soporta imports
 * cruzados entre carpetas de función -- arriesgar eso en una pieza de
 * seguridad no compensa el ahorro de líneas. Si se corrige un bug en esa
 * lógica en un archivo, HAY QUE APLICAR EL MISMO CAMBIO EN EL OTRO.
 *
 * Este endpoint NO comprueba ningún email (a diferencia de acceptTripInvite)
 * -- ese es precisamente el punto del link general. La seguridad viene
 * entera de que TripInviteLink tiene las 4 operaciones de rls cerradas
 * (nadie puede leer/crear/canjear un link salvo a través de estas
 * funciones) y de las comprobaciones de abajo (token exacto, no revocado,
 * no caducado, dentro del tope de usos).
 */

// Mismas dos listas que acceptTripInvite/entry.ts -- si se añade una entidad
// nueva con trip_id ahí, hay que añadirla aquí también.
const SYNCED_ENTITIES = [
  "City", "Expense", "Ticket", "TripMessage", "DiaryEntry",
  "PackingItem", "Spot", "ItineraryDay", "TodoItem", "UsefulInfo",
];
const ROLE_AWARE_ENTITIES = ["City", "Expense", "ItineraryDay"];

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

const ROLE_HIERARCHY: Record<string, number> = { admin: 3, editor: 2, viewer: 1 };

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }
    const normalizedUserEmail = user.email.toLowerCase();

    const { token } = await req.json();
    if (!token) {
      return Response.json({ error: "Falta el token del enlace" }, { status: 400 });
    }

    const service = base44.asServiceRole;

    const matches = await service.entities.TripInviteLink.filter({ token }, "-created_date", 2);
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

    const tripId = link.trip_id;
    const linkRole = link.role || "editor";

    // Mismo bucle de reintentos leer→modificar→escribir que
    // acceptTripInvite/entry.ts -- ver el comentario de cabecera de este
    // archivo sobre por qué está duplicado y no importado.
    let finalTrip: any = null;
    for (let intento = 0; intento < 4 && !finalTrip; intento++) {
      const trip = await service.entities.Trip.get(tripId);
      const members: string[] = trip.members || [];
      const roles: Record<string, string> = trip.roles || {};

      const existingRole = roles[normalizedUserEmail];
      const finalRole =
        existingRole && (ROLE_HIERARCHY[existingRole] || 0) >= (ROLE_HIERARCHY[linkRole] || 0)
          ? existingRole
          : linkRole;

      if (members.includes(normalizedUserEmail) && roles[normalizedUserEmail] === finalRole) {
        finalTrip = trip;
        break;
      }

      const newMembers = members.includes(normalizedUserEmail) ? members : [...members, normalizedUserEmail];
      const newRoles = { ...roles, [normalizedUserEmail]: finalRole };
      const newAdmins = Object.keys(newRoles).filter((k) => newRoles[k] === "admin");

      await service.entities.Trip.update(tripId, { members: newMembers, roles: newRoles, admins: newAdmins });

      const check = await service.entities.Trip.get(tripId);
      if ((check.members || []).includes(normalizedUserEmail)) {
        finalTrip = check;
        break;
      }

      await new Promise((r) => setTimeout(r, 120 * (intento + 1)));
    }

    if (!finalTrip) {
      return Response.json(
        { error: "No se pudo unir al viaje. Vuelve a intentarlo en unos segundos." },
        { status: 409 }
      );
    }

    // Incrementar use_count -- se hace DESPUÉS de confirmar que la persona
    // ya está en members, para no gastar un uso si el join hubiera fallado.
    // No lleva el mismo bucle de reintentos que Trip.update (el margen de
    // error de un contador que se quede corto por una carrera muy rara es
    // mucho más tolerable que dejar a alguien fuera del viaje).
    await service.entities.TripInviteLink.update(link.id, { use_count: (link.use_count || 0) + 1 });

    const syncFailed: { entity: string; error: string }[] = [];
    const editors = computeEditors(finalTrip.members || [], finalTrip.created_by, finalTrip.roles || {});
    for (const entityName of SYNCED_ENTITIES) {
      try {
        const records = await service.entities[entityName].filter({ trip_id: tripId }, "-created_date", 2000);
        const patch = ROLE_AWARE_ENTITIES.includes(entityName)
          ? { trip_members: finalTrip.members, trip_editors: editors }
          : { trip_members: finalTrip.members };
        for (const record of records) {
          await service.entities[entityName].update(record.id, patch);
        }
      } catch (e) {
        syncFailed.push({ entity: entityName, error: e.message });
      }
    }

    return Response.json({ ok: true, trip: finalTrip, syncFailed });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
