import { getLanguage } from '@/i18n/index.js';
import { base44 } from '@/api/base44Client';

// Carga perezosa y compartida del SDK de Google Maps (JS API) + Places
// touch build: forzar rebuild fresco tras re-anadir VITE_GOOGLE_MAPS_API_KEY en Secretos (2026-08-18) v2
// (New) -- mismo patron que loadLeaflet() en Restaurants.jsx (inyecta un
// <script> una sola vez, singleton por promesa), asi no hace falta anadir
// ninguna dependencia nueva a package.json ni arriesgar el pipeline de
// build de Base44 con un paquete npm que no conocemos si soporta.
//
// Requiere VITE_GOOGLE_MAPS_API_KEY como variable de entorno (se pone en
// Base44 -> Configuracion -> Secretos, NUNCA hardcodeada aqui). Sin ella,
// getGoogleMapsApiKey() (abajo) resuelve a '' y cualquier componente que la
// use debe mostrar su propio estado de "no disponible" en vez de romper la
// app.
//
// Nota (24-ago-2026): existía aquí isGoogleMapsConfigured(), que leía
// import.meta.env.VITE_GOOGLE_MAPS_API_KEY directamente en el cliente --
// siempre vacío en producción (Base44 no inyecta Secretos en el bundle del
// frontend), así que nunca devolvía true. TodayRouteMap.jsx y
// SpotsMapView.jsx la importaban pero no la llamaban (confirmado antes de
// borrarla). Eliminada como código muerto; usar getGoogleMapsApiKey().
let loadPromise = null;
let apiKeyPromise = null;

// Memoizada a nivel de módulo: llama a getGoogleMapsKey una sola vez por
// sesión y cachea el resultado (mismo patrón que loadPromise). Base44 solo
// inyecta Secretos en funciones de backend en runtime, nunca en el bundle
// del frontend, así que import.meta.env.VITE_GOOGLE_MAPS_API_KEY siempre
// llega vacío al cliente. Esta función pide la clave al backend que sí
// tiene acceso al secreto.
export function getGoogleMapsApiKey() {
    if (apiKeyPromise) return apiKeyPromise;
    apiKeyPromise = base44.functions.invoke('getGoogleMapsKey', {})
        .then(res => {
            const key = res?.data?.key || res?.key || '';
            // No cacheamos fallos: si la clave vino vacía (backend en frío que
            // devolvió 500/401, secreto aún no inyectado, sesión no resuelta),
            // descartamos apiKeyPromise para que la próxima llamada vuelva a
            // pedir la clave en vez de quedar sellada con '' para toda la
            // sesión — ese era el bug: searchPlaces hacía `if (!apiKey) return`
            // silenciosamente y nunca llegaba a fetch aunque el backend ya
            // funcionara.
            if (!key) apiKeyPromise = null;
            return key;
        })
        .catch(() => { apiKeyPromise = null; return ''; });
    return apiKeyPromise;
}

export function loadGoogleMaps() {
    if (loadPromise) return loadPromise;
    loadPromise = getGoogleMapsApiKey().then(key => {
        if (!key) throw new Error('VITE_GOOGLE_MAPS_API_KEY no configurada');
        return new Promise((resolve, reject) => {
              // Fix (24-ago, encontrado en vivo con el console.warn ya puesto en
              // los 3 componentes de mapa): esto resolvía con
              // window.google.maps, pero TODO el código que llama a
              // loadGoogleMaps() usa el patrón estándar de la API de Google
              // (google.maps.Map, google.maps.Marker, google.maps.Size...) --
              // con `google` siendo ya `window.google.maps`, esas llamadas
              // intentaban leer `.maps` otra vez sobre el propio namespace de
              // maps, que no existe: "Cannot read properties of undefined
              // (reading 'Map')". Resolver con window.google (el namespace
              // completo, no solo su sub-propiedad .maps) es lo que espera
              // cada callback existente, sin tocar ninguno de ellos.
              // José (23 sep 2026): Places UI Kit (fichas de Google, ver
              // GooglePlaceCard.jsx) EXIGE cargar Maps JS con el cargador
              // dinámico oficial (importLibrary), no con <script ...&callback>.
              // Este es el bootstrap oficial de Google, sin cambios de lógica.
              // Se sigue resolviendo con window.google (namespace completo)
              // tras importar maps/places/marker, así que todo el código que
              // usa google.maps.Map, google.maps.Marker, etc. sigue igual.
              if (window.google?.maps?.places?.PlaceDetailsElement) { resolve(window.google); return; }
              try {
                if (!window.google?.maps?.importLibrary) {
                  /* eslint-disable */
                  (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({ key, v: 'weekly', language: getLanguage() === 'en' ? 'en' : 'es' });
                  /* eslint-enable */
                }
                Promise.all([
                  window.google.maps.importLibrary('maps'),
                  window.google.maps.importLibrary('places'),
                  window.google.maps.importLibrary('marker'),
                ]).then(() => resolve(window.google))
                  .catch(() => { loadPromise = null; reject(new Error('No se pudo cargar Google Maps')); });
              } catch (err) {
                loadPromise = null;
                reject(err);
              }
        });
    });
    return loadPromise;
}

// Estilo "Sistema O" para Google Maps -- mismo espiritu que KODO_TILE_URL en
// mapTiles.js (CARTO Positron): gris/crema suave, POIs y comercios ajenos
// apagados, para que los pines naranjas del viaje sean lo primero que se ve
// en vez de competir con los iconos de negocios de Google.
export const KODO_GOOGLE_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f8f6f3' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b655b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f8f6f3' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e8e3dc' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  // 21 sep 2026 (probando en Chrome): las calles apenas se distinguían del
  // fondo (blanco sobre crema con un borde casi igual). Ahora el terreno es un
  // tono más oscuro que las calles y estas llevan un borde definido, para que
  // el trazado de la ciudad se lea de un vistazo sin volver el mapa pesado.
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f1ede7' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d6cfc3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#c9c1b3' }] },
  { featureType: 'road.arterial', elementType: 'geometry.stroke', stylers: [{ color: '#cfc7ba' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#5f594f' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dce7ea' }] },
  ];

// Icono de pin naranja "teardrop", equivalente al L.divIcon de Leaflet
// (ver LeafletMap en Restaurants.jsx) -- mismo path que usa el marcador por
// defecto de Google pero recoloreado, en vez del pin rojo generico.
export function kodoMarkerIcon(google, { color = '#c2410c', scale = 1.6 } = {}) {
    return {
          path: 'M12 2C7.58 2 4 5.58 4 10c0 6 8 12 8 12s8-6 8-12c0-4.42-3.58-8-8-8z',
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale,
          anchor: new google.maps.Point(12, 22),
    };
}

// -- Tope diario de seguridad, por dispositivo --------------------------------
// Places API (New) no tiene limite "por dia" configurable en la consola de
// Google, solo por minuto (ver docs.cloud.google.com/apis/docs/capping-api-usage).
// Asi que esto es lo unico que da un stop real sin depender de la consola ni
// de estar pendiente de correos: un contador local por dispositivo que, al
// llegar al tope del dia, hace que el codigo llamante caiga automaticamente a
// Nominatim/Leaflet (gratis), sin intervencion. No es un limite global entre
// todos los dispositivos -- es la barrera contra el escenario real que
// importa, que es un bug o bucle metiendo cana desde un solo dispositivo. Con
// el volumen normal de un viaje/grupo esto no se nota nunca.
const GOOGLE_DAILY_CAPS = { autocomplete: 200, placeDetails: 200, mapLoad: 200, reverseGeocode: 200 };

function googleCapKey(sku) {
        const day = new Date().toISOString().slice(0, 10);
        return `kodo_google_cap_${sku}_${day}`;
}

export function canUseGoogleToday(sku) {
        try {
                    const cap = GOOGLE_DAILY_CAPS[sku];
                    if (!cap) return true;
                    const count = parseInt(localStorage.getItem(googleCapKey(sku)) || '0', 10);
                    return count < cap;
        } catch {
                    return true;
        }
}

export function markGoogleUsed(sku) {
        try {
                    const key = googleCapKey(sku);
                    const count = parseInt(localStorage.getItem(key) || '0', 10);
                    localStorage.setItem(key, String(count + 1));
        } catch {
                    // localStorage no disponible (privado/incognito) -- no bloqueamos
        }
}