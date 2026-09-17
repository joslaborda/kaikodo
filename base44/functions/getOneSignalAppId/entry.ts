import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * getOneSignalAppId — entrega el App ID de OneSignal al cliente nativo.
 *
 * Por qué: Base44 solo inyecta los Secretos en funciones de backend en
 * runtime, NUNCA en el bundle del frontend en build time. Así que
 * import.meta.env.VITE_ONESIGNAL_APP_ID siempre llega vacío al cliente —
 * mismo patrón ya visto y corregido para Google Maps (getGoogleMapsKey) y
 * Turnstile antes de sustituirlo por el captcha propio. El escáner de
 * seguridad de Base44 lo marcó además como "Secretos expuestos" el 17 sep
 * 2026 por leerse vía import.meta.env directamente en el código cliente
 * (src/lib/pushNotifications.js).
 *
 * Sin sesión a propósito: initPushNotifications() se llama en main.jsx
 * antes de montar React, antes de que exista ninguna sesión — no se puede
 * exigir auth.me() aquí igual que no se pudo en getTurnstileSiteKey. El
 * OneSignal App ID en sí no es secreto de verdad (es el identificador
 * público que cualquier SDK de OneSignal necesita para inicializarse,
 * equivalente a un Site Key), así que servirlo sin sesión no es un riesgo
 * nuevo — el problema real que esto arregla es que antes ni siquiera
 * llegaba al cliente, dejando las notificaciones push nativas rotas en
 * silencio (sin logs, sin crash) desde que se instaló el plugin.
 */
Deno.serve(async (req) => {
  try {
    const key = Deno.env.get("VITE_ONESIGNAL_APP_ID") || "";
    return Response.json({ appId: key });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
