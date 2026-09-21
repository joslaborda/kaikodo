/**
* pushNotifications — puente entre la sesión de Kōdo y OneSignal.
*
* Por qué NO se importa el paquete "@capacitor/core": Base44 sirve esta
* misma base de código como PWA en su propio editor/hosting, y su entorno
* de build no tiene instalado ese paquete (no lo gestiona él) — un
* `import { Capacitor } from '@capacitor/core'` aquí rompía la carga de
* TODA la app dentro de Base44 con "Failed to resolve import", no solo el
* push. Capacitor, cuando la app corre de verdad dentro del shell nativo,
* inyecta él solo un objeto global `window.Capacitor` — se puede detectar
* la plataforma nativa leyendo esa variable global sin importar el paquete
* en absoluto. Fuera del shell nativo (web/PWA en Base44, o el propio
* navegador de escritorio), `window.Capacitor` no existe y todo esto queda
* en no-op, que es justo el comportamiento que queremos.
*
* Por qué External ID en vez de guardar el player_id en UserProfile:
* OneSignal permite asociar cada instalación de la app a un "external_id"
* propio (aquí, el user.id de base44) con OneSignal.login(). Para enviar un
* push desde el backend basta con apuntar a ese external_id — no hace falta
* guardar ni sincronizar ningún token de dispositivo en nuestras propias
* entidades, ni preocuparse de qué pasa si el usuario reinstala la app o
* tiene varios dispositivos (OneSignal reparte a todos los que tenga
* asociados a ese external_id). Ver base44/functions/createNotification/entry.ts,
* que es quien realmente dispara el envío.
*
* Fix (ago 2026) — deviceready puede llegar tarde o "perderse":
* onesignal-cordova-plugin expone window.plugins.OneSignal a través del
* puente de compatibilidad Cordova de Capacitor, que dispara el evento DOM
* 'deviceready' cuando ese puente está listo. El problema: si ese evento
* se dispara ANTES de que este módulo llegue a registrar el listener
* (`document.addEventListener('deviceready', ...)`), el listener se queda
* esperando un evento que ya ocurrió y nunca se entera — 'deviceready' es
* un evento de una sola vez, no hay forma de "consultar" si ya pasó. La
* velocidad con la que cada plataforma monta el bridge nativo no es la
* misma (Android/Chromium WebView vs iOS/WKWebView), así que este condición
* de carrera puede darse en una plataforma y no en otra sin que cambie nada
* en el código JS. Antes de este fix, esto dejaba el push completamente
* silencioso: sin logs, sin crash, sin registro en OneSignal — imposible de
* distinguir de un problema de configuración real.
*
* La solución: en lugar de depender solo del evento, se comprueba primero
* si `window.plugins.OneSignal` ya existe de forma síncrona (si el bridge
* ya montó, no hace falta esperar nada) y, si no, además del listener de
* 'deviceready' se hace un polling corto (cada 250ms, hasta 8s) por si el
* evento ya se disparó antes de que este módulo se cargara. Se añaden logs
* con el prefijo [push] para poder diagnosticar esto en el futuro sin
* depender de conectar el dispositivo por USB.
*
* Fix (ago 2026) — badge del icono "pegado" en Android:
* Android (y algunos launchers vía ShortcutBadger, que es lo que usa el SDK
* de OneSignal por debajo) calculan el número del badge del icono a partir
* de las notificaciones del sistema que siguen entregadas en la bandeja —
* NO a partir de nada de lo que pase dentro de la app. Marcar un mensaje
* como leído en el chat, o simplemente ver que ya no hay nada pendiente en
* la propia app, no cancela esas notificaciones del sistema: si llegaron 3
* pushes y el usuario abrió la app tocando el icono (no una notificación
* concreta), las 3 siguen "vivas" en la bandeja y el badge se queda clavado
* en 3 para siempre, aunque dentro de la app no quede rastro de ellas.
* clearDeliveredNotifications() cancela todas las notificaciones de
* OneSignal ya entregadas (y con ello el badge) — se llama una vez al
* arrancar la app y cada vez que vuelve a primer plano (ver main.jsx),
* imitando el comportamiento habitual de apps como WhatsApp o Gmail.
*/

import { base44 } from '@/api/base44Client';

let oneSignalAppIdPromise = null;

// José (17 sep 2026) — hallazgo del escáner de seguridad de Base44
// ("Secretos expuestos"): leer import.meta.env.VITE_ONESIGNAL_APP_ID aquí
// nunca funcionaba en producción (Base44 no inyecta Secretos en el bundle
// del cliente en build time, solo en funciones de backend en runtime —
// mismo patrón ya arreglado antes para Google Maps, ver
// getGoogleMapsApiKey() en src/lib/googleMaps.js, cuyo patrón se replica
// aquí tal cual). Se pide ahora al backend (sin exigir sesión, igual que
// getTurnstileSiteKey antes de él, ya que esto corre en main.jsx antes de
// que exista ninguna sesión). No se cachea el fallo (si la primera llamada
// falla por red, la siguiente vuelve a intentarlo).
function getOneSignalAppId() {
    if (oneSignalAppIdPromise) return oneSignalAppIdPromise;
    oneSignalAppIdPromise = base44.functions.invoke('getOneSignalAppId', {})
        .then(res => res?.data?.appId || res?.appId || null)
        .catch(() => null)
        .then(appId => {
            if (!appId) oneSignalAppIdPromise = null; // no cachear fallo
            return appId;
        });
    return oneSignalAppIdPromise;
}

const READY_POLL_INTERVAL_MS = 250;
const READY_POLL_TIMEOUT_MS = 8000;

let nativeReadyPromise = null;

function isNativePlatform() {
    return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}

function getOneSignal() {
    return typeof window !== 'undefined' ? window.plugins?.OneSignal : null;
}

/**
* Devuelve una promesa que se resuelve en cuanto el plugin de OneSignal
* está disponible, usando lo que llegue antes de estas tres señales:
*   1. window.plugins.OneSignal ya existe (comprobación síncrona inmediata).
*   2. El evento 'deviceready' se dispara.
*   3. Polling de respaldo cada 250ms (cubre el caso de que 'deviceready'
*      ya se haya disparado antes de llegar aquí).
* Si pasan 8s sin que aparezca, se resuelve igualmente (sin plugin) para no
* dejar callbacks colgados para siempre; initPushNotifications registrará
* un aviso en consola cuando esto pase.
*/
function whenNativeReady() {
    if (!isNativePlatform()) return Promise.resolve(false);
    if (nativeReadyPromise) return nativeReadyPromise;

  nativeReadyPromise = new Promise((resolve) => {
        if (getOneSignal()) {
                console.log('[push] OneSignal ya disponible de forma síncrona');
                resolve(true);
                return;
        }

                                       let settled = false;
        const finish = (ok, reason) => {
                if (settled) return;
                settled = true;
                clearInterval(pollId);
                clearTimeout(timeoutId);
                console.log(`[push] whenNativeReady resuelto vía "${reason}" (plugin ${ok ? 'sí' : 'no'} disponible)`);
                resolve(ok);
        };

                                       document.addEventListener(
                                               'deviceready',
                                               () => finish(!!getOneSignal(), 'deviceready'),
                                         { once: true }
                                             );

                                       // Respaldo: por si 'deviceready' ya se disparó antes de que este
                                       // módulo llegara a registrar el listener de arriba.
                                       const pollId = setInterval(() => {
                                               if (getOneSignal()) finish(true, 'polling');
                                       }, READY_POLL_INTERVAL_MS);

                                       const timeoutId = setTimeout(() => {
                                               finish(!!getOneSignal(), 'timeout');
                                       }, READY_POLL_TIMEOUT_MS);
  });

  return nativeReadyPromise;
}

/**
* Se llama una vez al arrancar la app (ver main.jsx). Pide permiso de
* notificaciones al SO — en iOS esto dispara el diálogo nativo del sistema,
* así que no conviene llamarlo en mitad de otro flujo (p. ej. justo al
* abrir un viaje) para no generar el prompt en un momento raro.
*/
export function initPushNotifications() {
    if (!isNativePlatform()) return;
    Promise.all([getOneSignalAppId(), whenNativeReady()]).then(([appId, available]) => {
          if (!appId) {
                  console.warn('[push] No se pudo obtener el App ID de OneSignal del backend, no se inicializa');
                  return;
          }
          const OneSignal = getOneSignal();
          if (!available || !OneSignal) {
                  console.warn('[push] OneSignal no disponible tras esperar al bridge nativo — el plugin no se cargó');
                  return;
          }
          console.log('[push] Inicializando OneSignal…');
          OneSignal.initialize(appId);
          OneSignal.Notifications.requestPermission(true);
          // José (21 sep 2026): tocar un aviso ("Tren · sale en 4 h") solo abría la app
          // donde se hubiera quedado. Ahora lleva al Home de ESE viaje, donde está el
          // billete destacado. Todo va envuelto: si la API del plugin cambia, tocar un
          // aviso sigue abriendo la app como antes.
          try {
            OneSignal.Notifications.addEventListener?.('click', (event) => {
              try {
                const data = event?.notification?.additionalData || {};
                const tripId = data.tripId || data.trip_id;
                if (tripId) window.location.assign('/Home?trip_id=' + encodeURIComponent(tripId));
              } catch { /* nada */ }
            });
          } catch { /* nada */ }
    });
}

/**
* Asocia esta instalación al usuario que acaba de autenticarse. Llamar tras
* cada login exitoso (ver AuthContext.jsx / checkUserAuth).
*/
export function syncPushIdentity(userId) {
    if (!userId) return;
    whenNativeReady().then((available) => {
          if (!available) {
                  console.warn('[push] No se puede vincular external_id — OneSignal no disponible');
                  return;
          }
          getOneSignal()?.login(String(userId));
    });
}

/**
* Desvincula la instalación del usuario al cerrar sesión — imprescindible
* en dispositivos compartidos (el ordenador o móvil de la familia en un
* viaje conjunto): sin esto, el siguiente que inicie sesión en el mismo
* teléfono seguiría recibiendo los push del usuario anterior.
*/
export function clearPushIdentity() {
    whenNativeReady().then((available) => {
          if (!available) return;
          getOneSignal()?.logout();
    });
}

/**
* Cancela todas las notificaciones de OneSignal ya entregadas al sistema y,
* con ello, resetea el badge del icono de la app. Se llama al arrancar la
* app y cada vez que vuelve a primer plano (ver main.jsx) — así el badge
* nunca se queda "pegado" con un número que ya no corresponde a nada
* pendiente dentro de la app.
*/
export function clearDeliveredNotifications() {
    whenNativeReady().then((available) => {
          if (!available) return;
          getOneSignal()?.Notifications?.clearAll?.();
    });
}
