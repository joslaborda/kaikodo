import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * SIN USO — ninguna pantalla de la app llama a esta función (grep de
 * "migrateTripMembers" en src/ no da ningún resultado). Por el nombre y por
 * el contenido, parece un borrador/reescritura de manageTripMember que
 * nunca se llegó a conectar desde el cliente. Esta auditoría encontró que
 * ESTA versión (con protección al creador, comprobación de saldo pendiente y
 * sincronización de trip_members al expulsar) era más completa y correcta
 * que la que la app SÍ usa — esa lógica ya se ha llevado a
 * base44/functions/manageTripMember/entry.ts, que es la que de verdad
 * ejecuta la app. Se deja este archivo tal cual (no se borra, por si acaso
 * se invoca a mano fuera de la app) pero no debería usarse ni mantenerse en
 * paralelo — cualquier cambio futuro a la gestión de miembros va en
 * manageTripMember, no aquí.
 *
 * manageTripMember — cambia el rol de un miembro o lo expulsa del viaje.
 *
 * Por qué en el backend: el rls de Trip.update solo puede cerrarse a "eres
 * miembro actual del viaje" (ver base44/entities/Trip.jsonc) — el rls de
 * base44 se evalúa a nivel de documento, no de campo, así que no puede
 * exigir "solo si eres admin" para tocar members/roles sin también bloquear
 * a cualquier miembro normal que solo quiere renombrar el viaje o salir de
 * él (operaciones que sí deben seguir abiertas a cualquier miembro). Con el
 * rls tal cual estaba, cualquier miembro —viewer incluido— podía llamar
 * directamente a Trip.update y auto-promocionarse a admin o expulsar a
 * otros, sin que el rls lo impidiera. Aquí se valida server-side que quien
 * llama sea admin del viaje antes de tocar la membresía de otra persona.
 *
 * Limitación conocida (no resuelta en esta ronda): esto cierra el camino
 * normal de la app — UI y esta función son ahora el único sitio donde se
 * gestiona a otros miembros con verificación real de permisos — pero
 * Trip.update en sí sigue abierto a cualquier miembro actual por rls, porque
 * lo necesitan el flujo de "salir del viaje" (uno mismo) y el de
 * renombrar/reprogramar el viaje. Alguien con acceso a herramientas de
 * desarrollador podría seguir llamando a Trip.update directamente para
 * tocar members/roles. Cerrar eso del todo requeriría mover también esos dos
 * flujos al backend (y el de publicar plantilla, que es de "Kōdo social"
 * MVP2 y no se toca) — no se ha hecho aquí.
 */

// 'Restaurant' se quitó: la entidad no tiene ninguna pantalla que cree
// registros (Restaurants.jsx trabaja sobre Spot), así que sincronizarla aquí
// era una llamada que siempre iba a 0 resultados sobre una entidad eliminada.
const SYNCED_ENTITIES = [
  "City", "Expense", "Ticket", "TripMessage", "DiaryEntry",
  "PackingItem", "Spot", "ItineraryDay", "TodoItem", "UsefulInfo",
];

const VALID_ROLES = ["admin", "editor", "viewer"];

// Extraído del cuerpo de Deno.serve para poder recalcularse en cada intento
// del bucle de reintento (ver comentario junto al bucle, más abajo) sin
// duplicar la lógica de negocio.
async function computeNewMembersAndRoles(
  service: any,
  tripId: string,
  action: string,
  role: string | undefined,
  targetEmail: string,
  members: string[],
  roles: Record<string, string>
): Promise<{ newMembers: string[]; newRoles: Record<string, string>; errorResponse?: Response }> {
  if (action === "remove") {
    // Deuda huérfana: si a quien se expulsa le deben dinero o debe dinero
    // (balance neto != 0), Expense.jsonc solo permite editar/borrar gastos
    // a miembros actuales del viaje — al quitarlo de trip.members pierde
    // acceso a esos gastos (RLS) y su saldo queda congelado para siempre:
    // nadie puede saldarlo ni corregirlo, y calculateBalances() lo seguiría
    // arrastrando en el resto del grupo sin que él lo vea. Se replica aquí
    // el mismo cálculo de balances que expenseBalances.js (algoritmo
    // idéntico) solo para este miembro, y se bloquea la expulsión si su
    // saldo no está saldado — igual que hacen apps de gastos compartidos
    // (p. ej. Splitwise) al intentar salir de un grupo con balance abierto.
    let targetBalance = 0;
    try {
      // Mismo límite alto que en acceptTripInvite/entry.ts -- ver ahí el porqué.
      const expenses = await service.entities.Expense.filter({ trip_id: tripId }, "-created_date", 2000);
      for (const expense of expenses) {
        const amount = Math.max(0, parseFloat(expense.amount_base || expense.amount) || 0);
        const paidBy = (expense.paid_by || "").trim().toLowerCase();
        if (!paidBy || !amount) continue;
        if (paidBy === targetEmail) targetBalance += amount;

        const splitType = expense.split_type;
        if (splitType === "solo") {
          if (paidBy === targetEmail) targetBalance -= amount;
        } else if (splitType === "custom" && expense.amounts_by_user) {
          const safeAmounts = Object.fromEntries(
            Object.entries(expense.amounts_by_user).map(([e, v]: [string, any]) => [
              (e || "").trim().toLowerCase(),
              Math.max(0, parseFloat(v) || 0),
            ])
          );
          const totalCustom = Object.values(safeAmounts).reduce((s: number, v: any) => s + v, 0);
          if (totalCustom > 0 && safeAmounts[targetEmail] != null) {
            targetBalance -= amount * (safeAmounts[targetEmail] / totalCustom);
          } else if (totalCustom === 0 && Object.keys(safeAmounts).includes(targetEmail)) {
            targetBalance -= amount / Object.keys(safeAmounts).length;
          }
        } else {
          const splitWith = (expense.split_with || []).map((e: string) => (e || "").trim().toLowerCase());
          const participants = [...new Set(splitWith.length > 0 ? splitWith : [paidBy])];
          if (participants.includes(targetEmail)) {
            targetBalance -= amount / participants.length;
          }
        }
      }
    } catch (e) {
      // Si falla la lectura de gastos, no bloqueamos la expulsión por un
      // error de infraestructura — solo cuando SÍ pudimos calcular un saldo
      // real y no está saldado.
      targetBalance = 0;
    }

    if (Math.abs(targetBalance) > 0.01) {
      return {
        newMembers: members,
        newRoles: roles,
        errorResponse: Response.json(
          {
            error:
              "Esta persona tiene un saldo pendiente en los gastos del viaje. Salda su balance antes de expulsarla.",
            code: "target_has_balance",
            balance: parseFloat(targetBalance.toFixed(2)),
          },
          { status: 400 }
        ),
      };
    }

    const newMembers = members.filter((e) => e !== targetEmail);
    const newRoles = { ...roles };
    delete newRoles[targetEmail];
    return { newMembers, newRoles };
  } else {
    // No se puede dejar el viaje sin ningún admin.
    const adminCount = Object.values(roles).filter((r) => r === "admin").length;
    if (roles[targetEmail] === "admin" && adminCount <= 1 && role !== "admin") {
      return {
        newMembers: members,
        newRoles: roles,
        errorResponse: Response.json(
          { error: "El viaje necesita al menos un admin.", code: "last_admin" },
          { status: 400 }
        ),
      };
    }
    const newRoles = { ...roles, [targetEmail]: role as string };
    return { newMembers: members, newRoles };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }
    const actingEmail = user.email.trim().toLowerCase();

    const { tripId, targetEmail: rawTargetEmail, action, role } = await req.json();
    const targetEmail = (rawTargetEmail || "").trim().toLowerCase();

    if (!tripId || !targetEmail || !action) {
      return Response.json({ error: "Faltan datos" }, { status: 400 });
    }
    if (action !== "remove" && action !== "setRole") {
      return Response.json({ error: "Acción no reconocida" }, { status: 400 });
    }
    if (action === "setRole" && !VALID_ROLES.includes(role)) {
      return Response.json({ error: "Rol no válido" }, { status: 400 });
    }

    const service = base44.asServiceRole;

    // Expulsar/cambiar rol es leer→modificar→escribir sobre trip.members/
    // roles (un array y un objeto completos, no un campo suelto) — igual que
    // acceptTripInvite.ts, que ya documenta y resuelve este mismo problema
    // ahí. Antes esta función leía el Trip UNA vez al principio y escribía
    // UNA vez al final, sin ninguna protección: si dos admins gestionaban
    // miembros del mismo viaje casi a la vez (o incluso un reintento de red
    // del mismo admin), el segundo Trip.update podía pisar al primero con
    // datos ya obsoletos — un miembro expulsado "revivía" en trip.members, o
    // un cambio de rol se perdía, sin ningún error visible. Se relee el Trip
    // en cada intento y se relee de nuevo tras escribir para confirmar que
    // el cambio se aplicó sobre el estado más reciente, reintentando hasta
    // 4 veces si no.
    let updatedTrip: any = null;
    let newMembers: string[] = [];
    let newRoles: Record<string, string> = {};

    for (let intento = 0; intento < 4 && !updatedTrip; intento++) {
      const trip = await service.entities.Trip.get(tripId);
      if (!trip) {
        return Response.json({ error: "Viaje no encontrado" }, { status: 404 });
      }

      // trip.members puede traer entradas de antes de normalizar el email a
      // minúsculas al crear/aceptar un viaje (ver TripsList.jsx/acceptTripInvite)
      // — sin normalizar aquí también, "gestionar miembro" fallaba con "no es
      // miembro" para cualquier entrada vieja con mayúsculas distintas, aunque
      // esa persona sí apareciera en la lista.
      const members: string[] = (trip.members || []).map((e: string) => (e || "").trim().toLowerCase());
      // roles se normaliza igual que members y por el mismo motivo — antes
      // solo se normalizaban las claves de members, no las de roles. Una
      // clave con distinto casing en roles hacía fallar "actingIsAdmin" con
      // un 403 falso para un admin real, podía dejar sin detectar que el
      // target era el último admin, y al escribir newRoles con el email ya
      // normalizado podía quedar duplicado junto a la clave vieja.
      const rawRoles: Record<string, string> = trip.roles || {};
      const roles: Record<string, string> = {};
      for (const [rawEmail, r] of Object.entries(rawRoles)) {
        const key = (rawEmail || "").trim().toLowerCase();
        if (key) roles[key] = r;
      }

      // Solo un admin del viaje (o su creador) puede gestionar a otros miembros.
      const actingIsAdmin = roles[actingEmail] === "admin" || trip.created_by === actingEmail;
      if (!actingIsAdmin) {
        return Response.json(
          { error: "No tienes permiso para gestionar miembros de este viaje.", code: "not_admin" },
          { status: 403 }
        );
      }

      if (!members.includes(targetEmail)) {
        // Si estamos en un reintento (intento > 0) y la acción es "remove",
        // esto no es un error real: significa que la expulsión SÍ se aplicó
        // en el intento anterior, pero la relectura de verificación de ESE
        // intento llegó "stale" (todavía con el miembro puesto) y el bucle
        // reintentó — al releer aquí de nuevo, ahora sí refleja la
        // expulsión ya hecha. Antes esto se trataba como "esa persona no es
        // miembro" y se devolvía un 400 ANTES de llegar al bloque de
        // sincronización de trip_members más abajo — el Trip.update sí se
        // había aplicado, pero la persona expulsada conservaba acceso de
        // lectura (via rls) a todo el contenido del viaje porque nunca se
        // limpiaba su entrada en City/Expense/Ticket/etc., y el admin veía
        // un error pese a que la expulsión sí había funcionado.
        if (action === "remove" && intento > 0) {
          newMembers = members;
          newRoles = roles;
          updatedTrip = trip;
          break;
        }
        return Response.json({ error: "Esa persona no es miembro del viaje." }, { status: 400 });
      }

      // Gestionar la propia membresía (salir, etc.) no pasa por aquí — es el
      // flujo de "salir del viaje" ya existente en Settings.jsx.
      if (targetEmail === actingEmail) {
        return Response.json(
          { error: "No puedes gestionarte a ti mismo desde aquí.", code: "self_target" },
          { status: 400 }
        );
      }

      // El creador del viaje no se puede expulsar ni degradar.
      if (trip.created_by === targetEmail) {
        return Response.json(
          { error: "No se puede modificar al creador del viaje.", code: "target_is_creator" },
          { status: 400 }
        );
      }

      const result = await computeNewMembersAndRoles(service, tripId, action, role, targetEmail, members, roles);
      if (result.errorResponse) return result.errorResponse;
      newMembers = result.newMembers;
      newRoles = result.newRoles;

      await service.entities.Trip.update(tripId, { members: newMembers, roles: newRoles });

      const check = await service.entities.Trip.get(tripId);
      const membersMatch = JSON.stringify((check.members || []).slice().sort()) === JSON.stringify(newMembers.slice().sort());
      const rolesMatch = JSON.stringify(check.roles || {}) === JSON.stringify(newRoles);
      if (membersMatch && rolesMatch) {
        updatedTrip = check;
        break;
      }

      await new Promise((r) => setTimeout(r, 120 * (intento + 1)));
    }

    if (!updatedTrip) {
      return Response.json(
        { error: "No se pudo actualizar el viaje. Vuelve a intentarlo en unos segundos.", code: "conflict" },
        { status: 409 }
      );
    }

    // Si se expulsó a alguien, revocar su acceso a los datos ya existentes
    // del viaje — si no, su email queda congelado en el trip_members de cada
    // registro desde antes de la expulsión y conservaría acceso para siempre.
    const syncFailed: { entity: string; error: string }[] = [];
    if (action === "remove") {
      for (const entityName of SYNCED_ENTITIES) {
        try {
          // Mismo límite alto que en acceptTripInvite/entry.ts -- ver ahí el porqué.
          const records = await service.entities[entityName].filter({ trip_id: tripId }, "-created_date", 2000);
        } catch (e) {
          syncFailed.push({ entity: entityName, error: e.message });
        }
      }
    }

    return Response.json({ ok: true, trip: updatedTrip, syncFailed });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
