import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * backfillSpotPlaces — rellena los spots existentes con datos enriquecidos de
 * Google Places (photo_url, rating, user_rating_count, opening_hours_json,
 * phone, website, price_level).
 *
 * Lote de 20 por llamada; se invoca manualmente varias veces hasta que
 * remaining=0. Contrato: { processed, updated, remaining }.
 *
 * Resolución del placeId:
 *  - Si osm_id ya es un Google Place ID válido (alfanumérico, no puramente
 *    numérico — p. ej. empieza por 'ChIJ'), se usa directamente.
 *  - Si no (spots legacy con osm_id numérico de OSM), se resuelve con Google
 *    Text Search (places:searchText) usando title + city_name + country como
 *    textQuery y lat/lng como locationBias si existen; se toma el primer
 *    resultado y su placeId real. Si Text Search no devuelve nada, se salta
 *    el spot (cuenta en processed, no en updated) y se sigue con el siguiente.
 *
 * Auth: createClientFromRequest + base44.auth.me() exige sesión (patrón
 * getGoogleMapsKey). Usa asServiceRole para leer/actualizar spots de
 * cualquier usuario (mantenimiento global; el RLS de Spot no dejaría tocar
 * spots ajenos con el token del usuario).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: "No autorizado: esta función es solo para administradores" }, { status: 403 });
    }

    const apiKey = Deno.env.get("VITE_GOOGLE_MAPS_API_KEY") || "";
    if (!apiKey) {
      return Response.json({ error: "Falta VITE_GOOGLE_MAPS_API_KEY" }, { status: 500 });
    }

    const DETAILS_MASK =
      "id,displayName,formattedAddress,location,primaryType,types,rating,userRatingCount,photos,regularOpeningHours,currentOpeningHours,internationalPhoneNumber,nationalPhoneNumber,websiteUri,priceLevel";
    const SEARCH_MASK = "places.id,places.displayName";
    const BATCH = 20;

    const isGooglePlaceId = (v) => {
      const s = String(v ?? "").trim();
      if (!s) return false;
      return /[A-Za-z]/.test(s) && !/^\d+$/.test(s);
    };

    const headers = (mask) => ({
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": mask,
    });

    // Text Search: resuelve un placeId real a partir de title + city + country.
    const resolveBySearch = async (spot) => {
      const query = [spot.title, spot.city_name, spot.country]
        .filter((x) => x && String(x).trim())
        .join(", ");
      if (!query) return null;
      const body = { textQuery: query, languageCode: "es" };
      if (typeof spot.lat === "number" && typeof spot.lng === "number") {
        body.locationBias = {
          circle: {
            center: { latitude: spot.lat, longitude: spot.lng },
            radius: 2000,
          },
        };
      }
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { ...headers(SEARCH_MASK), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.places?.[0]?.id || null;
    };

    // Place Details: rellena los campos enriquecidos.
    const fetchDetails = async (placeId) => {
      const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
        headers: headers(DETAILS_MASK),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      return await res.json();
    };

    const spots = await base44.asServiceRole.entities.Spot.filter(
      { source: "osm" },
      "-created_date",
      2000
    );
    const pending = (spots || []).filter(
      (s) => !!s.osm_id && String(s.osm_id).trim() !== "" && s.rating == null
    );
    const batch = pending.slice(0, BATCH);

    let updated = 0;
    for (const spot of batch) {
      try {
        let placeId = isGooglePlaceId(spot.osm_id)
          ? String(spot.osm_id).trim()
          : await resolveBySearch(spot);
        if (!placeId) continue; // Text Search sin resultados → saltar

        const p = await fetchDetails(placeId);
        if (!p) continue;

        const photoName = p.photos?.[0]?.name;
        const photoUrl = photoName
          ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=400&key=${apiKey}`
          : undefined;
        const hours = p.regularOpeningHours || p.currentOpeningHours || null;

        const data = {
          photo_url: photoUrl,
          rating: p.rating ?? undefined,
          user_rating_count: p.userRatingCount ?? undefined,
          opening_hours_json: hours ? JSON.stringify(hours) : undefined,
          phone: p.nationalPhoneNumber || p.internationalPhoneNumber || undefined,
          website: p.websiteUri || undefined,
          price_level: p.priceLevel || undefined,
        };
        Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

        await base44.asServiceRole.entities.Spot.update(spot.id, data);
        updated++;
      } catch {
        // Fallo en un spot concreto → siguiente sin romper el lote.
      }
    }

    const remaining = Math.max(0, pending.length - updated);
    return Response.json({ processed: batch.length, updated, remaining });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});