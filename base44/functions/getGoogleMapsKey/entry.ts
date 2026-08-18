import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * getGoogleMapsKey — entrega la clave de Google Maps al cliente solo tras
 * validar que el usuario tiene una sesión activa en Kaikōdo.
 *
 * Por qué: Base44 solo inyecta los Secretos en funciones de backend en
 * runtime, NUNCA en el bundle del frontend en build time. Así que
 * import.meta.env.VITE_GOOGLE_MAPS_API_KEY siempre llega vacío al cliente
 * y la búsqueda de sitios, fotos/estrellas, geocoding inverso, el mapa
 * interactivo y el buscador de aeropuerto/estación se rompían en silencio.
 * Esta función expone la clave solo a usuarios autenticados, igual que
 * cacheFxRate/getCachedFxRate exigen sesión antes de tocar datos.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const key = Deno.env.get("VITE_GOOGLE_MAPS_API_KEY") || "";
    return Response.json({ key });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});