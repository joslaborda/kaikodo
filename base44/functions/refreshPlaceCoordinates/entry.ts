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
 * Se ejecuta a diario por la automatización de function.jsonc. También la
 * puede lanzar un admin a mano (Test Function). Sin sesión solo actúa si
 * la llama la automatización; no hay nada que abusar: si no hay nada
 * caducado, no hace ninguna llamada a Google.
 *
 * Coste: 1 Place Details por sitio y ~mes, solo con el campo `location`.
 */
const STALE_DAYS = 25;
const MAX_PER_RUN = 300;

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
    const fromAutomation = body?.args?.trigger === "daily";
    if (!fromAutomation) {
      if (!user?.email) return Response.json({ error: "No autenticado" }, { status: 401 });
      if (user.role !== "admin") return Response.json({ error: "No autorizado" }, { status: 403 });
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
