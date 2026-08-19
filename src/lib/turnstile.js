import { base44 } from '@/api/base44Client';

// Memoizada a nivel de módulo: llama a getTurnstileSiteKey una sola vez por
// sesión y cachea el resultado. Base44 solo inyecta Secretos en funciones de
// backend en runtime, nunca en el bundle del frontend, así que
// import.meta.env.VITE_TURNSTILE_SITE_KEY siempre llega vacío al cliente.
// Esta función pide la site key al backend que sí tiene acceso al secreto.
// Mismo patrón que getGoogleMapsApiKey() en src/lib/googleMaps.js.
//
// No cacheamos fallos: si la clave vino vacía (backend en frío, secreto aún
// no inyectado), descartamos la promesa para que la próxima llamada vuelva a
// pedirla en vez de quedar sellada con '' para toda la sesión.
let siteKeyPromise = null;

export function getTurnstileSiteKey() {
    if (siteKeyPromise) return siteKeyPromise;
    siteKeyPromise = base44.functions.invoke('getTurnstileSiteKey', {})
        .then(res => {
            const key = res?.data?.key || res?.key || '';
            if (!key) siteKeyPromise = null;
            return key;
        })
        .catch(() => { siteKeyPromise = null; return ''; });
    return siteKeyPromise;
}