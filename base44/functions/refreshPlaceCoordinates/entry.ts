import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * refreshPlaceCoordinates — cumplimiento de Google Maps Platform (23 sep 2026).
 *
 * Las coordenadas (lat/lng) que vienen de Places API solo se pueden guardar
 * 30 días seguidos. Esta función vuelve a pedirlas a Google para cada Spot y
 * SavedSpot con place id cuyo `place_refreshed_at` falta o tiene más de 25
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
    const work: { entity: "Spot" | "SavedSpot"; row: Row; placeId: string }[] = [];
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
        const patch = "gone" in r
          ? { lat: null, lng: null, place_refreshed_at: now }
          : { lat: r.lat, lng: r.lng, place_refreshed_at: now };
        await base44.asServiceRole.entities[w.entity].update(w.row.id as string, patch);
        if ("gone" in r) cleared++; else refreshed++;
      } catch { failed++; }
    }
    const remaining = Math.max(0, work.length - Math.min(work.length, MAX_PER_RUN));
    return Response.json({ refreshed, cleared, failed, remaining });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
