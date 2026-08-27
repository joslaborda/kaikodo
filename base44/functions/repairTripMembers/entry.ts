import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * repairTripMembers — herramienta de reparación, de un solo uso manual (no
 * la llama la app sola desde ningún sitio).
 *
 * Por qué existe: durante un tiempo, crear un gasto/día de itinerario/spot/
 * etc. justo cuando la pantalla todavía no había terminado de cargar los
 * datos del viaje (típico con mala conexión, viajando) guardaba ese registro
 * con trip_members: [] — el rls lo compara contra ese campo, así que el
 * registro quedaba invisible para siempre, incluso para quien lo creó.
 * Parecía "borrado" sin estarlo: seguía en la base de datos, solo que nadie
 * podía volver a leerlo. Esto ya está arreglado en el código de creación,
 * pero no arregla lo que ya se guardó mal antes del arreglo.
 *
 * Qué hace: para cada viaje (o solo uno, si se pasa tripId), relee su lista
 * de miembros actual y reescribe trip_members en TODOS sus registros de las
 * entidades protegidas por ese campo, tengan o no ya el valor correcto — es
 * idempotente, así que se puede volver a correr sin miedo si algo falla a
 * mitad y hay que reintentar.
 *
 * Con permisos de servicio (asServiceRole), así no depende de que quien lo
 * ejecute ya tuviera acceso a los registros rotos (por definición, no lo
 * tenía — ese es justo el problema que arregla).
 *
 * Rate limiting: al recorrer muchos viajes con muchos registros seguidos,
 * base44 puede devolver "Rate limit exceeded" a mitad de la pasada (visto en
 * pruebas reales, siempre cerca del final de una ejecución larga). Por eso
 * cada llamada pasa por withRetry (reintenta con espera creciente) y además
 * se deja una pequeña pausa entre entidades para no ir a ráfaga.
 */

// 'Restaurant' se quitó: la entidad no tiene ninguna pantalla que cree
// registros (Restaurants.jsx trabaja sobre Spot), así que sincronizarla aquí
// era una llamada que siempre iba a 0 resultados sobre una entidad eliminada.
const SYNCED_ENTITIES = [
  "City", "Expense", "Ticket", "TripMessage", "DiaryEntry",
  "PackingItem", "Spot", "ItineraryDay", "TodoItem", "UsefulInfo",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || e || "");
      const isRateLimit = /rate limit/i.test(msg);
      if (!isRateLimit || attempt === retries) throw e;
      await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s, 8s
    }
  }
  throw lastError;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }
    // .trim() además de .toLowerCase() — migrateTripMembers.ts ya normaliza
    // así (fix de ronda 2/3); aquí solo se quitaban mayúsculas, no espacios.
    // Un email con espacios accidentales podía pasar el check de membresía
    // en una función pero fallar en la otra, con un 403 inconsistente según
    // cuál se llamara.
    const actingEmail = user.email.trim().toLowerCase();

    let tripId: string | undefined;
    try {
      const body = await req.json();
      tripId = body?.tripId || undefined;
    } catch {
      // sin body — repara todos los viajes
    }

    const service = base44.asServiceRole;

    // Antes, esta función solo exigía tener sesión iniciada en Kōdo — nada
    // más. Sin tripId recorría con asServiceRole TODOS los viajes de la
    // plataforma y devolvía en la respuesta el nombre y la lista completa de
    // miembros de cada uno: cualquier usuario recién registrado podía
    // enumerar todos los viajes ajenos con una sola llamada, además de forzar
    // una reescritura masiva de trip_members sin ser dueño de nada. Se cierra
    // en dos niveles: reparar TODOS los viajes exige rol de admin de la
    // plataforma (user.role, igual que ya usa PageNotFound.jsx); reparar UN
    // viaje concreto exige ser miembro (o el creador) de ese viaje.
    if (!tripId) {
      if (user.role !== "admin") {
        return Response.json(
          { error: "Reparar todos los viajes requiere permisos de administrador." },
          { status: 403 }
        );
      }
    } else {
      const targetTrip = await service.entities.Trip.get(tripId).catch(() => null);
      if (!targetTrip) {
        return Response.json({ error: "Viaje no encontrado" }, { status: 404 });
      }
      const members = (targetTrip.members || []).map((e: string) => (e || "").trim().toLowerCase());
      const isMember = members.includes(actingEmail) || (targetTrip.created_by || "").trim().toLowerCase() === actingEmail;
      if (!isMember && user.role !== "admin") {
        return Response.json(
          { error: "No tienes permiso para reparar este viaje." },
          { status: 403 }
        );
      }
    }

    // Mismo límite alto que en acceptTripInvite/entry.ts -- aquí es aún más
    // importante: sin esto, ejecutar la reparación sobre TODOS los viajes
    // (sin tripId) solo tocaría los primeros 50 de toda la app.
    const trips = tripId
      ? [await service.entities.Trip.get(tripId)].filter(Boolean)
      : await service.entities.Trip.filter({}, "-created_date", 2000);

    const report: any[] = [];

    for (const trip of trips) {
      const members: string[] = trip.members || [];
      const tripReport: any = { tripId: trip.id, tripName: trip.name, members, entities: {} };

      // Repara también trip.admins — campo nuevo de esta auditoría (ver
      // Trip.jsonc) del que depende el rls de Trip.update. Cualquier viaje
      // creado/migrado ANTES de que este campo existiera en el esquema
      // publicado se quedó con admins vacío, lo que bloquea a su propio
      // admin real de volver a tocar el viaje (probado en vivo: 403 al
      // intentar renombrar "test peru" tras publicar, con roles ya
      // correcto pero admins todavía vacío). Se recalcula aquí a partir de
      // roles y se escribe con permisos de servicio, que sí puede aunque el
      // rls de Trip.update ya esté cerrado.
      const roles: Record<string, string> = trip.roles || {};
      const correctAdmins = Object.keys(roles).filter((k) => roles[k] === "admin");
      const currentAdmins = Array.isArray(trip.admins) ? trip.admins.slice().sort() : [];
      if (JSON.stringify(correctAdmins.slice().sort()) !== JSON.stringify(currentAdmins)) {
        try {
          await withRetry(() => service.entities.Trip.update(trip.id, { admins: correctAdmins }));
          tripReport.adminsFixed = correctAdmins;
        } catch (e) {
          tripReport.adminsFixError = (e as Error).message;
        }
      }

      for (const entityName of SYNCED_ENTITIES) {
        try {
          // Mismo límite alto que en acceptTripInvite/entry.ts -- ver ahí el porqué.
          const records = await withRetry(() => service.entities[entityName].filter({ trip_id: trip.id }, "-created_date", 2000));
          let fixed = 0;
          for (const record of records) {
            const current = JSON.stringify((record.trip_members || []).slice().sort());
            const target = JSON.stringify(members.slice().sort());
            if (current !== target) {
              await withRetry(() => service.entities[entityName].update(record.id, { trip_members: members }));
              fixed++;
            }
          }
          tripReport.entities[entityName] = { total: records.length, fixed };
        } catch (e) {
          tripReport.entities[entityName] = { error: e.message };
        }
        await sleep(150); // pequeña pausa entre entidades para no ir a ráfaga
      }

      report.push(tripReport);
    }

    return Response.json({ ok: true, tripsProcessed: trips.length, report });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
