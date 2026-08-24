import { createClientFromRequest } from "npm:@base44/sdk";

const ROLE_AWARE_ENTITIES = ["City", "Expense"];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function withRetry(fn, retries = 4) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastError = e;
      const msg = String(e?.message || e || "");
      const isRateLimit = /rate limit/i.test(msg);
      if (!isRateLimit || attempt === retries) throw e;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

function norm(s) { return typeof s === "string" ? s.trim().toLowerCase() : ""; }

function computeEditors(members, createdBy, roles) {
  const createdByNorm = norm(createdBy);
  const normRoles = {};
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
    if (!user?.email) return Response.json({ error: "No autenticado" }, { status: 401 });
    const actingEmail = user.email.trim().toLowerCase();

    let tripId;
    try { const body = await req.json(); tripId = body?.tripId || undefined; } catch {}

    const service = base44.asServiceRole;

    if (!tripId) {
      if (user.role !== "admin") {
        return Response.json({ error: "Reparar todos los viajes requiere permisos de administrador." }, { status: 403 });
      }
    } else {
      const targetTrip = await service.entities.Trip.get(tripId).catch(() => null);
      if (!targetTrip) return Response.json({ error: "Viaje no encontrado" }, { status: 404 });
      const members = (targetTrip.members || []).map((e) => norm(e));
      const isMember = members.includes(actingEmail) || norm(targetTrip.created_by) === actingEmail;
      if (!isMember && user.role !== "admin") {
        return Response.json({ error: "No tienes permiso para reparar este viaje." }, { status: 403 });
      }
    }

    const trips = tripId ? [await service.entities.Trip.get(tripId)].filter(Boolean) : await service.entities.Trip.filter({});
    const report = [];

    for (const trip of trips) {
      const members = trip.members || [];
      const editors = computeEditors(members, trip.created_by, trip.roles || {});
      const tripReport = { tripId: trip.id, tripName: trip.name, members, editors, entities: {} };

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
          tripReport.entities[entityName] = { error: e.message };
        }
        await sleep(150);
      }
      report.push(tripReport);
    }

    return Response.json({ ok: true, tripsProcessed: trips.length, report });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});