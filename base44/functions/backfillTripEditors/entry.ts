import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * backfillTripEditors — herramienta de reparación, de un solo uso manual (no
 * la llama la app sola desde ningún sitio). Mismo patrón que
 * repairTripMembers/entry.ts, pero para el campo trip_editors (ver
 * Expense.jsonc/City.jsonc y syncTripMembers.js para el porqué de ese
 * campo — hallazgo #6 de la auditoría: los roles admin/editor/viewer eran
 * decorativos).
 *
 * IMPRESCINDIBLE ejecutar esto (sin tripId, para todos los viajes) ANTES de
 * cambiar el rls de Expense/City a comprobar data.trip_editors en vez de
 * data.trip_members -- si no, todo registro creado antes de este cambio
 * tiene trip_editors vacío/inexistente y el rls nuevo bloquearía su
 * edición/borrado a TODO el mundo, no solo a los viewers. Es idempotente:
 * se puede volver a correr sin miedo si algo falla a mitad.
 */

const ROLE_AWARE_ENTITIES = ["City", "Expense"];

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
      const msg = String((e as any)?.message || e || "");
      const isRateLimit = /rate limit/i.test(msg);
      if (!isRateLimit || attempt === retries) throw e;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function computeEditors(members: string[], createdBy: string, roles: Record<string, string>): string[] {
  const createdByNorm = norm(createdBy);
  const normRoles: Record<string, string> = {};
  for (const [rawEmail, r] of Object.entries(roles || {})) {
    const key = norm(rawEmail);
    if (key) normRoles[key] = r as string;
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
    const actingEmail = user.email.trim().toLowerCase();

    let tripId: string | undefined;
    try {
      const body = await req.json();
      tripId = body?.tripId || undefined;
    } catch {
      // sin body — repara todos los viajes
    }

    const service = base44.asServiceRole;

    // Mismo modelo de permisos que repairTripMembers: reparar TODOS los
    // viajes exige rol de admin de la plataforma; reparar UNO concreto
    // exige ser miembro (o el creador) de ese viaje.
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
      const members = (targetTrip.members || []).map((e: string) => norm(e));
      const isMember = members.includes(actingEmail) || norm(targetTrip.created_by) === actingEmail;
      if (!isMember && user.role !== "admin") {
        return Response.json(
          { error: "No tienes permiso para reparar este viaje." },
          { status: 403 }
        );
      }
    }

    const trips = tripId
      ? [await service.entities.Trip.get(tripId)].filter(Boolean)
      : await service.entities.Trip.filter({});

    const report: any[] = [];

    for (const trip of trips) {
      const members: string[] = trip.members || [];
      const editors = computeEditors(members, trip.created_by, trip.roles || {});
      const tripReport: any = { tripId: trip.id, tripName: trip.name, members, editors, entities: {} };

      for (const entityName of ROLE_AWARE_ENTITIES) {
        try {
          const records = await withRetry(() => service.entities[entityName].filter({ trip_id: trip.id }));
          let fixed = 0;
          for (const record of records) {
            const current = JSON.stringify((record.trip_editors || []).slice().sort());
            const target = JSON.stringify(editors.slice().sort());
            if (current !== target) {
              await withRetry(() => service.entities[entityName].update(record.id, { trip_editors: editors }));
              fixed++;
            }
          }
          tripReport.entities[entityName] = { total: records.length, fixed };
        } catch (e) {
          tripReport.entities[entityName] = { error: (e as Error).message };
        }
        await sleep(150);
      }

      report.push(tripReport);
    }

    return Response.json({ ok: true, tripsProcessed: trips.length, report });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
