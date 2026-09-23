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
 * Y (23 sep, 2ª tanda) borra el NOMBRE y la DIRECCIÓN de Google de los
 * spots/guardados con place id cuyo título no es del usuario (sin
 * `title_is_own`): el título pasa a una etiqueta propia según el tipo
 * ("Restaurante", "Museo"...). Con conexión no se nota: la ficha de Places
 * UI Kit enseña el nombre oficial. Sin conexión se ve esa etiqueta.
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
const OWN_LABEL: Record<string, string> = {
  food: "Restaurante", sight: "Sitio cultural", activity: "Actividad",
  shopping: "Tienda", transport: "Transporte", hotel: "Alojamiento",
  nightlife: "Bar", airport: "Aeropuerto", train: "Estación de tren",
  bus: "Estación de autobús", custom: "Sitio",
};
const ownLabel = (type: unknown) => OWN_LABEL[String(type ?? "")] || "Sitio";

// Nombre y dirección de Google fuera, en registros con place id de Google.
function namePatch(s: Record<string, unknown>, placeId: unknown) {
  const patch: Record<string, unknown> = {};
  // Hoteles de reservas antiguos: vinieron de Google (source google_places)
  // pero sin place id guardado -- no se pueden refrescar, así que ni sus
  // coordenadas ni su nombre de Google se pueden conservar.
  if (!isGooglePlaceId(placeId) && s.source === "google_places") {
    if (s.lat != null || s.lng != null) { patch.lat = null; patch.lng = null; }
    if (!s.title_is_own) { patch.title = ownLabel(s.type); patch.title_is_own = true; }
    if (s.address) patch.address = "";
    return patch;
  }
  if (!isGooglePlaceId(placeId)) return patch;
  if (s.address) patch.address = "";
  if (!s.title_is_own) { patch.title = ownLabel(s.type); patch.title_is_own = true; }
  return patch;
}
const isGooglePhoto = (url: unknown) =>
  typeof url === "string" && url.includes("places.googleapis.com");

function spotPatch(s: Record<string, unknown>, placeIdFor: (s: Record<string, unknown>) => string | null) {
  const patch: Record<string, unknown> = {};
  if (!isGooglePlaceId(s.osm_id) && s.source === "saved_import") {
    const pid = placeIdFor(s);
    if (pid) patch.osm_id = pid;
  }
  for (const f of SPOT_FIELDS) {
    if (s[f] !== undefined && s[f] !== null && s[f] !== "") patch[f] = null;
  }
  if (isGooglePhoto(s.image_url)) patch.image_url = null;
  Object.assign(patch, namePatch(s, patch.osm_id ?? s.osm_id));
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
      .map((s: Record<string, unknown>) => ({
        id: s.id as string,
        patch: { ...(isGooglePhoto(s.image_url) ? { image_url: null } : {}), ...namePatch(s, s.google_place_id) },
      }))
      .filter((w) => Object.keys(w.patch).length > 0);

    // Reservas antiguas con ubicación de Google sin place id: fuera nombre y
    // coordenadas de Google (no se pueden refrescar). Las nuevas guardan
    // location_place_id y nombre propio (DocumentForm.jsx).
    const tickets = await base44.asServiceRole.entities.Ticket.filter({}, "-created_date", 10000);
    const ticketWork = (tickets || [])
      .filter((t: Record<string, unknown>) => !isGooglePlaceId(t.location_place_id) && (t.location_lat != null || t.location_lng != null))
      .map((t: Record<string, unknown>) => ({ id: t.id as string, patch: { location_lat: null, location_lng: null, location_name: "" } }));

    // Ciudades: la referencia de foto de Google (photo_ref) no se puede guardar.
    const cityRows = await base44.asServiceRole.entities.City.filter({}, "-created_date", 10000);
    let cleanedCities = 0;
    for (const c of (cityRows || []) as Record<string, unknown>[]) {
      if (!c.photo_ref) continue;
      try { await base44.asServiceRole.entities.City.update(c.id as string, { photo_ref: null }); cleanedCities++; } catch { /* sigue */ }
    }

    // Notificaciones de spots ya enviadas: llevaban el nombre de Google en
    // ref_title. Pasan al nombre propio actual del spot (o vacío si ya no existe).
    const spotTitleById = new Map<string, string>();
    for (const s of (spots || []) as Record<string, unknown>[]) {
      const p = spotWork.find(w => w.id === s.id)?.patch as Record<string, unknown> | undefined;
      spotTitleById.set(String(s.id), String((p && p.title) ?? s.title ?? ""));
    }
    const notifs = await base44.asServiceRole.entities.Notification.filter({}, "-created_date", 10000);
    let cleanedNotifications = 0;
    for (const n of (notifs || []) as Record<string, unknown>[]) {
      if (!String(n.type || "").startsWith("spot_") || !n.ref_title) continue;
      const own = n.ref_id ? (spotTitleById.get(String(n.ref_id)) ?? "") : "";
      if (own === n.ref_title) continue;
      try { await base44.asServiceRole.entities.Notification.update(n.id as string, { ref_title: own }); cleanedNotifications++; } catch { /* sigue */ }
    }

    let cleanedSpots = 0, cleanedSaved = 0, cleanedTickets = 0, budget = BATCH;
    for (const w of spotWork.slice(0, budget)) {
      try { await base44.asServiceRole.entities.Spot.update(w.id, w.patch); cleanedSpots++; } catch { /* sigue */ }
    }
    budget -= Math.min(budget, spotWork.length);
    for (const w of savedWork.slice(0, budget)) {
      try { await base44.asServiceRole.entities.SavedSpot.update(w.id, w.patch); cleanedSaved++; } catch { /* sigue */ }
    }

    budget -= Math.min(budget, savedWork.length);
    for (const w of ticketWork.slice(0, Math.max(0, budget))) {
      try { await base44.asServiceRole.entities.Ticket.update(w.id, w.patch); cleanedTickets++; } catch { /* sigue */ }
    }

    const remaining = Math.max(0, spotWork.length - cleanedSpots) + Math.max(0, savedWork.length - cleanedSaved)
      + Math.max(0, ticketWork.length - cleanedTickets);
    return Response.json({ cleanedSpots, cleanedSaved, cleanedTickets, cleanedCities, cleanedNotifications, remaining });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
