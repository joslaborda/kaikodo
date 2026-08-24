import { base44 } from '@/api/base44Client';
import { normalizeEmail } from '@/lib/utils';

/**
 * Entidades cuyo acceso está protegido comparando data.trip_members contra el
 * email del usuario (ver rls en base44/entities/*.jsonc). base44 no permite
 * condiciones cross-entity en rls declarativo — no se puede escribir "solo si
 * estás en Trip.members" directamente — así que cada registro lleva su propia
 * copia de esa lista, y hay que mantenerla al día a mano cada vez que cambia
 * quién está en el viaje. Si no se sincroniza: un miembro nuevo no puede leer
 * el historial del viaje (gastos, chat, documentos, itinerario anteriores a su
 * entrada), o alguien expulsado conserva acceso a esos datos para siempre.
 */
// 'Restaurant' se quitó de esta lista: la entidad Restaurant.jsonc no tenía
// ninguna pantalla que creara registros (Restaurants.jsx trabaja sobre Spot),
// así que sincronizar trip_members ahí era una llamada que siempre iba a 0
// resultados — ver kodo_changelog.md, sección "entidades huérfanas".
const SYNCED_ENTITIES = [
  'City', 'Expense', 'Ticket', 'TripMessage', 'DiaryEntry',
  'PackingItem', 'Spot', 'ItineraryDay', 'TodoItem', 'UsefulInfo',
];

// Entidades donde además de "quién puede leer" (trip_members) hace falta
// "quién puede escribir" (trip_editors) — hallazgo #6 de la auditoría: los
// roles admin/editor/viewer se mostraban en la UI pero Expense.rls y
// City.rls solo comprobaban trip_members, así que un "viewer" (pensado para
// solo consultar) podía igualmente crear, editar o borrar gastos y ciudades
// de otra gente. Mismo motivo que trip_members: el motor de rls de base44 no
// puede comparar contra Trip.roles directamente, así que cada registro
// lleva su propia copia de "quién NO es viewer en este viaje ahora mismo".
const ROLE_AWARE_ENTITIES = ['City', 'Expense'];

/**
 * A partir de trip.roles (y trip.created_by, que cuenta como admin aunque no
 * tenga entrada explícita en roles — mismo criterio que manageTripMember),
 * devuelve la lista de miembros que NO son viewer, es decir, los que pueden
 * escribir. Sin rol asignado explícitamente el default es viewer (mismo
 * criterio que ya usa MembersPanel.jsx: `roles[email] || 'viewer'`) — así que
 * ante la duda esta función nunca concede de más.
 */
export function computeEditors(members, trip) {
  const createdBy = normalizeEmail(trip?.created_by);
  const rawRoles = trip?.roles || {};
  const roles = {};
  for (const [rawEmail, r] of Object.entries(rawRoles)) {
    const key = normalizeEmail(rawEmail);
    if (key) roles[key] = r;
  }
  return members.filter((email) => {
    const key = normalizeEmail(email);
    if (key === createdBy) return true; // el creador del viaje siempre puede escribir
    return (roles[key] || 'viewer') !== 'viewer';
  });
}

/**
 * Reescribe trip_members (y, en las entidades que lo necesitan, trip_editors)
 * en TODOS los registros existentes de un viaje. Llamar SIEMPRE justo
 * después de cualquier cambio en Trip.members O en Trip.roles: aceptar
 * invitación, expulsar a alguien, salir del viaje, o cambiar el rol de
 * alguien sin tocar su membresía.
 *
 * No lanza si falla una entidad concreta — sigue con el resto y devuelve qué
 * falló, para no dejar el cambio de membresía a medias por un fallo de red
 * puntual en una sola entidad. El caller decide si reintentar o solo avisar.
 */
export async function syncTripMembers(tripId, newMembers) {
  if (!tripId || !Array.isArray(newMembers)) return { ok: true, failed: [] };

  // Fallback deliberadamente permisivo: si por lo que sea no se puede leer
  // el Trip (red, timing), se trata a todo el mundo como editor en vez de
  // bloquear la escritura a todos por un fallo ajeno a los roles — un rol
  // decorativo un rato más es preferible a dejar el viaje entero sin poder
  // editar nada por un error transitorio.
  let editors = newMembers;
  try {
    const trip = await base44.entities.Trip.get(tripId);
    if (trip) editors = computeEditors(newMembers, trip);
  } catch {
    // Se sigue con editors = newMembers (ver comentario de arriba).
  }

  const failed = [];
  await Promise.all(SYNCED_ENTITIES.map(async (entityName) => {
    try {
      const records = await base44.entities[entityName].filter({ trip_id: tripId });
      const patch = ROLE_AWARE_ENTITIES.includes(entityName)
        ? { trip_members: newMembers, trip_editors: editors }
        : { trip_members: newMembers };
      await Promise.all(records.map(r => base44.entities[entityName].update(r.id, patch)));
    } catch (e) {
      failed.push({ entity: entityName, error: e?.message || String(e) });
    }
  }));
  return { ok: failed.length === 0, failed };
}
