// Carga perezosa y compartida del SDK de Google Maps (JS API) + Places
// (New) -- mismo patron que loadLeaflet() en Restaurants.jsx (inyecta un
// <script> una sola vez, singleton por promesa), asi no hace falta anadir
// ninguna dependencia nueva a package.json ni arriesgar el pipeline de
// build de Base44 con un paquete npm que no conocemos si soporta.
//
// Requiere VITE_GOOGLE_MAPS_API_KEY como variable de entorno (se pone en
// Base44 -> Configuracion -> Secretos, NUNCA hardcodeada aqui). Sin ella,
// isGoogleMapsConfigured() devuelve false y cualquier componente que la use
// debe mostrar su propio estado de "no disponible" en vez de romper la app.
let loadPromise = null;

export function isGoogleMapsConfigured() {
    return typeof import.meta !== 'undefined' && !!import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;
}

export function loadGoogleMaps() {
    if (loadPromise) return loadPromise;
    const key = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) {
          loadPromise = Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY no configurada'));
          return loadPromise;
    }
    loadPromise = new Promise((resolve, reject) => {
          if (window.google?.maps?.places) { resolve(window.google.maps); return; }
          const cbName = '__kodoGoogleMapsReady';
          window[cbName] = () => resolve(window.google.maps);
          const script = document.createElement('script');
          script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places,marker&v=weekly&loading=async&callback=${cbName}`;
          script.async = true;
          script.onerror = () => reject(new Error('No se pudo cargar Google Maps'));
          document.head.appendChild(script);
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
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8478' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f8f6f3' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e8e3dc' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e8e3dc' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f0ebe4' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#8a8478' }] },
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
