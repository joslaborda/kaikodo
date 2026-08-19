import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * getTurnstileSiteKey — entrega la site key pública de Cloudflare Turnstile
 * al cliente SIN exigir sesión activa.
 *
 * Por qué: Base44 solo inyecta los Secretos en funciones de backend en
 * runtime, NUNCA en el bundle del frontend en build time. Así que
 * import.meta.env.VITE_TURNSTILE_SITE_KEY siempre llega vacío al cliente y
 * el widget de Turnstile nunca se montaba en las pantallas de registro y
 * "olvidé mi contraseña" — los botones quedaban deshabilitados para siempre
 * porque turnstileToken nunca se rellenaba.
 *
 * A diferencia de getGoogleMapsKey (que devuelve 401 si no hay sesión), esta
 * función NO comprueba auth: el widget de Turnstile se usa precisamente en
 * registro y "olvidé mi contraseña", donde el usuario todavía no tiene
 * sesión. La site key es pública por diseño (va embebida en el HTML del
 * cliente de todas formas), así que exponerla sin auth no es un riesgo.
 */
Deno.serve(async () => {
  try {
    const key = Deno.env.get("VITE_TURNSTILE_SITE_KEY") || "";
    return Response.json({ key });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});