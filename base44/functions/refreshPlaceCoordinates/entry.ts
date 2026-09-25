import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * refreshPlaceCoordinates — cumplimiento de Google Maps Platform (23 sep 2026).
 *
 * Las coordenadas (lat/lng) que vienen de Places API solo se pueden guardar
 * 30 días seguidos. Esta función vuelve a pedirlas a Google para cada Spot,
 * SavedSpot, Ticket (ubicación de reservas) y City con place id cuyo `place_refreshed_at` falta o tiene más de 25
 * días, y guarda las nuevas con la fecha de hoy. Si Google ya no conoce el
 * sitio (404), se borran las coordenadas: no se pueden seguir guardando.
 *
 * Se ejecuta a diario por el workflow de Base44 (base44/workflows/, sin
 * sesión). También la puede lanzar un admin con sesión (Test Function).
 *
 * Seguridad (escáner, 24 sep 2026): antes bastaba con mandar
 * `{"args":{"trigger":"daily"}}` para ejecutarla sin sesión, en bucle, y
 * gastar cuota de Google. Un secreto compartido no sirve aquí: el workflow
 * vive en el repo público y sus argumentos serían visibles, y Base44 no
 * documenta ninguna forma de reconocer que la llama el workflow. Así que se
 * quita el INCENTIVO: sin sesión de admin, la función hace su trabajo como
 * mucho UNA vez cada 20 horas (se apunta en la entidad MaintenanceRun, que
 * solo el backend puede leer/escribir). Cualquier otra llamada anónima
 * dentro de esa ventana sale al instante sin llamar a Google ni escribir
 * nada. El peor caso de abuso es, por tanto, la misma única ejecución diaria
 * que ya hace el workflow.
 *
 * Refuerzo (escáner, 25 sep 2026): además, sin sesión de admin solo se
 * acepta dentro de la VENTANA del workflow (02:55-04:00 UTC; el workflow
 * corre a las 03:00). Fuera de esa ventana, una llamada anónima sale sin
 * hacer nada. Resultado: un anónimo ya no puede provocar la ejecución en
 * otro momento, solo "adelantarse" unos minutos a la misma y única
 * ejecución diaria que el workflow iba a hacer de todos modos. Un secreto
 * compartido seguiría siendo lo ideal, pero hoy no hay forma de pasarlo
 * sin dejarlo en el repo público (los argumentos del workflow viven en
 * base44/workflows/ y Base44 no documenta leer Secretos desde ahí).
 *
 * Coste: 1 Place Details por sitio y ~mes, solo con el campo `location`.
 */
const STALE_DAYS = 25;
const JOB_NAME = "refreshPlaceCoordinates";
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
const MAX_PER_RUN = 300;
// Ventana del workflow diario (03:00 UTC), en minutos desde medianoche UTC.
const WINDOW_START_MIN = 2 * 60 + 55; // 02:55
const WINDOW_END_MIN = 4 * 60;        // 04:00
const inWorkflowWindow = (d = new Date()) => {
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m >= WINDOW_START_MIN && m < WINDOW_END_MIN;
};

const isGooglePlaceId = (id: unknown) => {
  const s = (id ?? "").toString().trim();
  return s.length > 10 && !/^\d+$/.test(s);
};
const isStale = (iso: unknown) => {
  if (!iso) return true;
  const t = Date.parse(String(iso));
  return !Number.isFinite(t) || Date.now() - t > STALE_DAYS * 86400000;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const user = await base44.auth.me().catch(() => null);
    void body;
    const isAdmin = !!user?.email && user.role === "admin";
    if (user?.email && !isAdmin) return Response.json({ error: "No autorizado" }, { status: 403 });
    if (!isAdmin && !inWorkflowWindow()) {
      return Response.json({ skipped: true, reason: "fuera de la ventana del workflow diario" });
    }
    if (!isAdmin) {
      // Anónimo (el workflow diario, o cualquiera): como mucho una vez cada 20 h.
      const service = base44.asServiceRole;
      const runs = await service.entities.MaintenanceRun.filter({ job: JOB_NAME });
      const last = runs?.[0];
      const lastMs = last?.last_run_at ? Date.parse(String(last.last_run_at)) : NaN;
      if (Number.isFinite(lastMs) && Date.now() - lastMs < MIN_INTERVAL_MS) {
        return Response.json({ skipped: true, reason: "ya se ejecutó en las últimas 20 horas" });
      }
      // Se apunta ANTES de trabajar: llamadas seguidas ya salen por arriba.
      const stamp = { job: JOB_NAME, last_run_at: new Date().toISOString() };
      if (last?.id) await service.entities.MaintenanceRun.update(last.id, stamp);
      else await service.entities.MaintenanceRun.create(stamp);
    }

    const apiKey = Deno.env.get("VITE_GOOGLE_MAPS_API_KEY") || "";
    if (!apiKey) return Response.json({ error: "Falta VITE_GOOGLE_MAPS_API_KEY" }, { status: 500 });

    const fetchLocation = async (placeId: string) => {
      const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "location" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) return { gone: true as const };
      if (!res.ok) return null;
      const p = await res.json();
      const lat = p?.location?.latitude, lng = p?.location?.longitude;
      return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
    };

    const spots = await base44.asServiceRole.entities.Spot.filter({}, "-created_date", 10000);
    const saved = await base44.asServiceRole.entities.SavedSpot.filter({}, "-created_date", 10000);
    type Row = Record<string, unknown>;
    const resolveCityPlaceId = async (name: string, country: string) => {
      const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
        body: JSON.stringify({ input: [name, country].filter(Boolean).join(", "), includedPrimaryTypes: ["locality"] }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const d = await res.json();
      return d?.suggestions?.[0]?.placePrediction?.placeId || null;
    };

    // Ciudades antiguas con coordenadas de Google pero sin place id: se busca
    // su place id (una vez) para poder refrescarlas; si no aparece, las
    // coordenadas no se pueden conservar y se borran.
    const cities = await base44.asServiceRole.entities.City.filter({}, "-created_date", 10000);
    let citiesLinked = 0;
    for (const c of (cities || []) as Record<string, unknown>[]) {
      if (isGooglePlaceId(c.place_id) || c.lat == null || !c.name) continue;
      try {
        const pid = await resolveCityPlaceId(String(c.name), String(c.country || ""));
        if (pid) { c.place_id = pid; c.place_refreshed_at = null; citiesLinked++; }
        else await base44.asServiceRole.entities.City.update(c.id as string, { lat: null, lng: null });
      } catch { /* siguiente */ }
    }

    const tickets = await base44.asServiceRole.entities.Ticket.filter({}, "-created_date", 10000);
    const work: { entity: "Spot" | "SavedSpot" | "Ticket" | "City"; row: Row; placeId: string }[] = [];
    for (const c of (cities || []) as Row[]) {
      if (isGooglePlaceId(c.place_id) && isStale(c.place_refreshed_at)) work.push({ entity: "City", row: c, placeId: String(c.place_id).trim() });
    }
    for (const s of (tickets || []) as Row[]) {
      if (isGooglePlaceId(s.location_place_id) && isStale(s.place_refreshed_at)) work.push({ entity: "Ticket", row: s, placeId: String(s.location_place_id).trim() });
    }
    for (const s of (spots || []) as Row[]) {
      if (isGooglePlaceId(s.osm_id) && isStale(s.place_refreshed_at)) work.push({ entity: "Spot", row: s, placeId: String(s.osm_id).trim() });
    }
    for (const s of (saved || []) as Row[]) {
      if (isGooglePlaceId(s.google_place_id) && isStale(s.place_refreshed_at)) work.push({ entity: "SavedSpot", row: s, placeId: String(s.google_place_id).trim() });
    }

    // Un mismo sitio puede estar en varios viajes: una sola llamada por place id.
    const cache = new Map<string, Awaited<ReturnType<typeof fetchLocation>>>();
    let refreshed = 0, cleared = 0, failed = 0;
    const now = new Date().toISOString();
    for (const w of work.slice(0, MAX_PER_RUN)) {
      try {
        if (!cache.has(w.placeId)) cache.set(w.placeId, await fetchLocation(w.placeId));
        const r = cache.get(w.placeId);
        if (!r) { failed++; continue; }
        const latKey = w.entity === "Ticket" ? "location_lat" : "lat";
        const lngKey = w.entity === "Ticket" ? "location_lng" : "lng";
        const patch = "gone" in r
          ? { [latKey]: null, [lngKey]: null, place_refreshed_at: now }
          : { [latKey]: r.lat, [lngKey]: r.lng, place_refreshed_at: now };
        // Ciudad recién enlazada arriba: guardar también su place id.
        if (w.entity === "City") (patch as Record<string, unknown>).place_id = w.placeId;
        await base44.asServiceRole.entities[w.entity].update(w.row.id as string, patch);
        if ("gone" in r) cleared++; else refreshed++;
      } catch { failed++; }
    }
    const remaining = Math.max(0, work.length - Math.min(work.length, MAX_PER_RUN));
    return Response.json({ refreshed, cleared, failed, citiesLinked, remaining });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
