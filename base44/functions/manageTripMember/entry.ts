import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * manageTripMember — expulsa a un miembro del viaje o le cambia el rol,
 * validando en el backend que quien llama sea admin. Es la función que
 * realmente invoca la app (src/lib/tripMembers.js → callManageTripMember).
 *
 * HALLAZGO DE ESTA AUDITORÍA (grave, ya en producción): esta función NUNCA
 * sincronizaba trip_members en los registros de contenido del viaje
 * (Expense, Ticket, TripMessage, DiaryEntry, PackingItem, Spot,
 * ItineraryDay, TodoItem, UsefulInfo) al expulsar a alguien. Cada uno de
 * esos registros lleva su PROPIA copia de trip_members (rls no permite
 * comparar contra otra entidad — ver syncTripMembers.js), así que expulsar a
 * alguien solo lo quitaba de Trip.members, pero su email seguía en el
 * trip_members de cada gasto/documento/mensaje/etc. ya existente — seguía
 * pudiendo LEER, EDITAR e INCLUSO BORRAR todo el contenido compartido del
 * viaje para siempre, aunque la app ya no se lo mostrara. Probado en vivo:
 * expulsé una cuenta de prueba y, con una llamada directa a la API (no la
 * app), esa cuenta siguió leyendo un gasto del viaje sin ningún problema.
 *
 * Existía además, sin usar por la app (huérfana, cero referencias en src/),
 * una función hermana `migrateTripMembers` con una versión más completa de
 * esta misma lógica (con este mismo problema ya resuelto, más protección al
 * creador del viaje, comprobación de saldo pendiente antes de expulsar, y
 * reintento seguro ante condiciones de carrera) — parece un borrador que
 * nunca se llegó a conectar. Esta función adopta esa misma lógica más
 * completa, en el sitio que la app SÍ llama.
 *
 * Invariantes que se validan aquí (no en el cliente, que solo las repite
 * como ayuda visual):
 * - Quien llama debe ser miembro del viaje con rol 'admin'.
 * - No se puede expulsar ni cambiar el rol de uno mismo por aquí (para eso
 *   hace falta el flujo de "salir del viaje", ver base44/functions/leaveTrip).
 * - No se puede expulsar ni degradar al creador del viaje.
 * - El viaje debe conservar al menos un admin tras la operación.
 * - Si a quien se expulsa le deben dinero o debe dinero (balance neto != 0)
 *   en los gastos del viaje, se bloquea la expulsión hasta que se salde.
 */

const SYNCED_ENTITIES = [
  "City", "Expense", "Ticket", "TripMessage", "DiaryEntry",
  "PackingItem", "Spot", "ItineraryDay", "TodoItem", "UsefulInfo",
];

// Entidades que además de trip_members necesitan trip_editors (quién NO es
// viewer) porque su propio rls lo comprueba — ver comentario largo en
// syncTripMembers.js (mismo criterio, duplicado aquí porque backend y
// frontend son runtimes distintos). Hallazgo de esta ronda: esta función
// sincronizaba trip_members al expulsar a alguien, pero NUNCA sincronizaba
// nada al cambiar el rol de alguien (action === "setRole") — así que
// degradar a un miembro a "viewer" no le quitaba permisos de escritura
// hasta que además lo expulsaran del viaje.
const ROLE_AWARE_ENTITIES = ["City", "Expense"];

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

type Action = "remove" | "setRole";
const VALID_ROLES = new Set(["admin", "editor", "viewer"]);

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

async function computeTargetBalance(service: any, tripId: string, targetEmail: string): Promise<number> {
  // Réplica del algoritmo de expenseBalances.js, solo para este miembro —
  // ver el comentario largo en migrateTripMembers/entry.ts para el porqué
  // (dejar a alguien expulsado con saldo abierto lo congela para siempre,
  // ya que Expense.jsonc exige ser miembro actual para tocar sus gastos).
  let targetBalance = 0;
  try {
    const expenses = await service.entities.Expense.filter({ trip_id: tripId });
    for (const expense of expenses) {
      const amount = Math.max(0, parseFloat(expense.amount_base || expense.amount) || 0);
      const paidBy = norm(expense.paid_by);
      if (!paidBy || !amount) continue;
      if (paidBy === targetEmail) targetBalance += amount;

      const splitType = expense.split_type;
      if (splitType === "solo") {
        if (paidBy === targetEmail) targetBalance -= amount;
      } else if (splitType === "custom" && expense.amounts_by_user) {
        const safeAmounts = Object.fromEntries(
          Object.entries(expense.amounts_by_user).map(([e, v]: [string, any]) => [norm(e), Math.max(0, parseFloat(v) || 0)])
        );
        const totalCustom = Object.values(safeAmounts).reduce((s: number, v: any) => s + v, 0);
        if (totalCustom > 0 && safeAmounts[targetEmail] != null) {
          targetBalance -= amount * (safeAmounts[targetEmail] / totalCustom);
        } else if (totalCustom === 0 && Object.keys(safeAmounts).includes(targetEmail)) {
          targetBalance -= amount / Object.keys(safeAmounts).length;
        }
      } else {
        const splitWith = (expense.split_with || []).map((e: string) => norm(e));
        const participants = [...new Set(splitWith.length > 0 ? splitWith : [paidBy])];
        if (participants.includes(targetEmail)) {
          targetBalance -= amount / participants.length;
        }
      }
    }
  } catch {
    // Si falla la lectura de gastos, no bloqueamos la expulsión por un
    // error de infraestructura — solo cuando SÍ pudimos calcular un saldo
    // real y no está saldado.
    return 0;
  }
  return targetBalance;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }
    const callerEmail = norm(user.email);

    const { tripId, targetEmail: rawTargetEmail, action, role } = await req.json();
    const targetNorm = norm(rawTargetEmail);

    if (!tripId || typeof tripId !== "string") {
      return Response.json({ error: "Falta el viaje" }, { status: 400 });
    }
    if (!targetNorm) {
      return Response.json({ error: "Falta el miembro a modificar" }, { status: 400 });
    }
    if (action !== "remove" && action !== "setRole") {
      return Response.json({ error: "Acción inválida" }, { status: 400 });
    }
    if (action === "setRole" && !VALID_ROLES.has(role)) {
      return Response.json({ error: "Rol inválido" }, { status: 400 });
    }
    if (targetNorm === callerEmail) {
      return Response.json(
        { error: "No puedes gestionarte a ti mismo desde aquí.", code: "self_target" },
        { status: 400 }
      );
    }

    const service = base44.asServiceRole;

    // Leer→modificar→escribir sobre members/roles (arrays/objetos completos,
    // no un campo suelto) — mismo motivo y mismo patrón que acceptTripInvite:
    // dos gestiones del mismo viaje casi a la vez podían pisarse sin esto.
    let updatedTrip: any = null;
    let newMembers: string[] = [];

    for (let intento = 0; intento < 4 && !updatedTrip; intento++) {
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

      const callerRole = roles[callerEmail];
      const callerIsAdmin = callerRole === "admin" || norm(trip.created_by) === callerEmail;
      if (!callerIsAdmin) {
        return Response.json({ error: "Solo un admin puede gestionar a los miembros del viaje" }, { status: 403 });
      }

      if (!members.includes(targetNorm)) {
        if (action === "remove" && intento > 0) {
          // Reintento tras una expulsión que sí se aplicó, pero cuya
          // relectura de verificación llegó "stale" — no es un error real.
          newMembers = members;
          updatedTrip = trip;
          break;
        }
        return Response.json({ error: "Esa persona no es miembro de este viaje" }, { status: 404 });
      }

      // El creador del viaje no se puede expulsar ni degradar — a
      // diferencia de un admin normal (que otro admin sí puede degradar),
      // el creador no tiene otra forma de "recuperar" el viaje si alguien
      // se lo quita.
      if (norm(trip.created_by) === targetNorm) {
        return Response.json(
          { error: "No se puede modificar al creador del viaje.", code: "target_is_creator" },
          { status: 400 }
        );
      }

      const targetKey = Object.keys(roles).find((k) => k === targetNorm) || targetNorm;
      const adminCount = Object.values(roles).filter((r) => r === "admin").length;
      const targetIsAdmin = roles[targetKey] === "admin";

      if (action === "remove") {
        if (targetIsAdmin && adminCount <= 1) {
          return Response.json(
            { error: "El viaje debe tener al menos un admin", code: "last_admin" },
            { status: 409 }
          );
        }
        const targetBalance = await computeTargetBalance(service, tripId, targetNorm);
        if (Math.abs(targetBalance) > 0.01) {
          return Response.json(
            {
              error: "Esta persona tiene un saldo pendiente en los gastos del viaje. Salda su balance antes de expulsarla.",
              code: "target_has_balance",
              balance: parseFloat(targetBalance.toFixed(2)),
            },
            { status: 400 }
          );
        }

        const computedMembers = members.filter((m) => m !== targetNorm);
        const newRoles = { ...roles };
        delete newRoles[targetKey];
        const newAdmins = Object.keys(newRoles).filter((k) => newRoles[k] === "admin");

        await service.entities.Trip.update(tripId, { members: computedMembers, roles: newRoles, admins: newAdmins });

        const check = await service.entities.Trip.get(tripId);
        const checkMembers = (check.members || []).map((e: string) => norm(e));
        if (!checkMembers.includes(targetNorm)) {
          updatedTrip = check;
          newMembers = computedMembers;
          break;
        }
      } else {
        // action === 'setRole'
        if (targetIsAdmin && role !== "admin" && adminCount <= 1) {
          return Response.json(
            { error: "El viaje debe tener al menos un admin", code: "last_admin" },
            { status: 409 }
          );
        }
        const newRoles = { ...roles, [targetKey]: role as string };
        const newAdmins = Object.keys(newRoles).filter((k) => newRoles[k] === "admin");

        await service.entities.Trip.update(tripId, { roles: newRoles, admins: newAdmins });

        const check = await service.entities.Trip.get(tripId);
        if (check.roles?.[targetKey] === role) {
          updatedTrip = check;
          newMembers = members;
          break;
        }
      }

      await new Promise((r) => setTimeout(r, 120 * (intento + 1)));
    }

    if (!updatedTrip) {
      return Response.json(
        { error: "No se pudo actualizar el viaje. Vuelve a intentarlo en unos segundos.", code: "conflict" },
        { status: 409 }
      );
    }

    // Si se expulsó a alguien, revocar su acceso al contenido YA EXISTENTE
    // del viaje. Si se cambió un rol, actualizar quién puede escribir. En
    // ambos casos trip_editors puede haber cambiado; trip_members solo
    // cambia al expulsar.
    const syncFailed: { entity: string; error: string }[] = [];
    const editors = computeEditors(
      action === "remove" ? newMembers : (updatedTrip.members || []),
      updatedTrip.created_by,
      updatedTrip.roles || {}
    );
    if (action === "remove") {
      for (const entityName of SYNCED_ENTITIES) {
        try {
          const records = await service.entities[entityName].filter({ trip_id: tripId });
          const patch = ROLE_AWARE_ENTITIES.includes(entityName)
            ? { trip_members: newMembers, trip_editors: editors }
            : { trip_members: newMembers };
          for (const record of records) {
            await service.entities[entityName].update(record.id, patch);
          }
        } catch (e) {
          syncFailed.push({ entity: entityName, error: (e as Error).message });
        }
      }
    } else {
      // action === "setRole" -- trip_members no cambia, solo trip_editors.
      for (const entityName of ROLE_AWARE_ENTITIES) {
        try {
          const records = await service.entities[entityName].filter({ trip_id: tripId });
          for (const record of records) {
            await service.entities[entityName].update(record.id, { trip_editors: editors });
          }
        } catch (e) {
          syncFailed.push({ entity: entityName, error: (e as Error).message });
        }
      }
    }

    return Response.json({ trip: updatedTrip, syncFailed });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
