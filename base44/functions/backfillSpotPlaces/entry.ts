import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * backfillSpotPlaces — rellena los spots existentes que vinieron de una
 * búsqueda de Google (source='osm', osm_id guarda en realidad el Google
 * Place ID — confusión de nombres heredada) con los datos enriquecidos de
 * Google Places que ahora persiste Restaurants.jsx (photo_url, rating,
 * user_rating_count, opening_hours_json, phone, website, price_level).
 *
 * Solo procesa los que aún NO tienen rating (rating == null), para no
 * repetir trabajo ni gastar cuota de Google innecesariamente. Lote de 20
 * por llamada; se invoca manualmente varias veces hasta que remaining=0.
 *
 * Patrón de auth idéntico a getGoogleMapsKey: createClientFromRequest +
 * base44.auth.me() exige sesión. Usa asServiceRole para leer/actualizar
 * spots de cualquier usuario (es una operación de mantenimiento global;
 * el RLS de Spot no dejaría tocar spots ajenos con el token del usuario).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const apiKey = Deno.env.get("VITE_GOOGLE_MAPS_API_KEY") || "";
    if (!apiKey) {
      return Response.json({ error: "Falta VITE_GOOGLE_MAPS_API_KEY" }, { status: 500 });
    }

    const FIELD_MASK =
      "id,displayName,formattedAddress,location,primaryType,types,rating,userRatingCount,photos,regularOpeningHours,currentOpeningHours,internationalPhoneNumber,nationalPhoneNumber,websiteUri,priceLevel";
    const BATCH = 20;

    // Trae todos los spots de fuente Google (source='osm') y filtra en
    // memoria los que aún no tienen rating y tienen un placeId válido en
    // osm_id. El límite alto cubre la base actual; si algún día supera
    // 2000 spots osm, remaining será un mínimo y bastará con llamar otra vez.
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
        const placeId = String(spot.osm_id).trim();
        const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const p = await res.json();

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
        // Limpia undefined para no pisar con null campos que Google no devolvió.
        Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

        await base44.asServiceRole.entities.Spot.update(spot.id, data);
        updated++;
      } catch {
        // Si la llamada a Google falla para un spot concreto, sigue con el
        // siguiente sin romper el lote entero.
      }
    }

    const remaining = Math.max(0, pending.length - updated);
    return Response.json({
      processed: batch.length,
      updated,
      remaining,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});