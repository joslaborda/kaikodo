import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * backfillSpotPlaces — DESACTIVADA (23 sep 2026).
 *
 * Guardaba rating, fotos, horario, teléfono, web y precio de Google Places en
 * cada Spot. Los términos de Google Maps Platform (EEA) no lo permiten: solo
 * se puede guardar el place id. Ese contenido ahora se pinta en vivo con
 * Places UI Kit (src/components/spots/GooglePlaceCard.jsx), y lo que ya se
 * había guardado lo borra purgeGooglePlacesContent.
 *
 * Se deja como no-op (en vez de borrar la carpeta) para que un despliegue sin
 * la carpeta no rompa nada ni reactive el comportamiento por error.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) return Response.json({ error: "No autenticado" }, { status: 401 });
  return Response.json({ error: "Función desactivada: ver purgeGooglePlacesContent" }, { status: 410 });
});
