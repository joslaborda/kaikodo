import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * purgeGooglePlacesContent — migración de cumplimiento (23 sep 2026).
 *
 * Los términos de Google Maps Platform (EEA, facturación en España) no
 * permiten guardar contenido de Places API salvo el place id. Esta función
 * borra de la base de datos lo que se guardó antes de ese cambio:
 *
 *  - Spot: rating, user_rating_count, photo_url, opening_hours_json, phone,
 *    website, price_level. (osm_id = place id se CONSERVA: es lo que usa la
 *    ficha de Places UI Kit para enseñar todo eso en vivo.)
 *  - Spot y SavedSpot: image_url solo si es una foto de Google
 *    (places.googleapis.com, que además llevaba la API key dentro).
 *    Las imágenes subidas por el usuario no se tocan.
 *
 * Además RECUPERA el place id de los spots importados desde Guardados antes
 * del 23 sep (esa importación no lo copiaba): busca el SavedSpot del mismo
 * usuario con el mismo nombre y copia su google_place_id a Spot.osm_id. Sin
 * esto esos spots no podrían enseñar nunca la ficha de Google (ni estrellas).
 *
 * Solo admin. Lote de 100 por llamada: invocar repetidamente hasta que
 * `remaining` sea 0. Idempotente (lo ya limpio no vuelve a contar).
 */
const BATCH = 100;
const SPOT_FIELDS = [
  "rating", "user_rating_count", "photo_url", "opening_hours_json",
  "phone", "website", "price_level",
];
const isGooglePlaceId = (id: unknown) => {
  const s = (id ?? "").toString().trim();
  return s.length > 10 && !/^\d+$/.test(s);
};
const normTitle = (s: unknown) =>
  (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const isGooglePhoto = (url: unknown) =>
  typeof url === "string" && url.includes("places.googleapis.com");

function spotPatch(s: Record<string, unknown>, placeIdFor: (s: Record<string, unknown>) => string | null) {
  const patch: Record<string, string | null> = {};
  if (!isGooglePlaceId(s.osm_id) && s.source === "saved_import") {
    const pid = placeIdFor(s);
    if (pid) patch.osm_id = pid;
  }
  for (const f of SPOT_FIELDS) {
    if (s[f] !== undefined && s[f] !== null && s[f] !== "") patch[f] = null;
  }
  if (isGooglePhoto(s.image_url)) patch.image_url = null;
  return patch;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: "No autenticado" }, { status: 401 });
    if (user.role !== "admin") {
      return Response.json({ error: "No autorizado: esta función es solo para administradores" }, { status: 403 });
    }

    const spots = await base44.asServiceRole.entities.Spot.filter({}, "-created_date", 10000);
    const savedSpots = await base44.asServiceRole.entities.SavedSpot.filter({}, "-created_date", 10000);

    // user_id -> (nombre normalizado -> google_place_id) de sus Guardados
    const savedIndex = new Map<string, Map<string, string>>();
    for (const ss of (savedSpots || []) as Record<string, unknown>[]) {
      if (!isGooglePlaceId(ss.google_place_id) || !ss.user_id) continue;
      const uid = String(ss.user_id);
      if (!savedIndex.has(uid)) savedIndex.set(uid, new Map());
      savedIndex.get(uid)!.set(normTitle(ss.title), String(ss.google_place_id).trim());
    }
    const placeIdFor = (s: Record<string, unknown>) =>
      savedIndex.get(String(s.created_by_user_id ?? ""))?.get(normTitle(s.title)) ?? null;

    const spotWork = (spots || [])
      .map((s: Record<string, unknown>) => ({ id: s.id as string, patch: spotPatch(s, placeIdFor) }))
      .filter((w) => Object.keys(w.patch).length > 0);
    const savedWork = (savedSpots || [])
      .filter((s: Record<string, unknown>) => isGooglePhoto(s.image_url))
      .map((s: Record<string, unknown>) => ({ id: s.id as string, patch: { image_url: null } }));

    let cleanedSpots = 0, cleanedSaved = 0, budget = BATCH;
    for (const w of spotWork.slice(0, budget)) {
      try { await base44.asServiceRole.entities.Spot.update(w.id, w.patch); cleanedSpots++; } catch { /* sigue */ }
    }
    budget -= Math.min(budget, spotWork.length);
    for (const w of savedWork.slice(0, budget)) {
      try { await base44.asServiceRole.entities.SavedSpot.update(w.id, w.patch); cleanedSaved++; } catch { /* sigue */ }
    }

    const remaining = Math.max(0, spotWork.length - cleanedSpots) + Math.max(0, savedWork.length - cleanedSaved);
    return Response.json({ cleanedSpots, cleanedSaved, remaining });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
