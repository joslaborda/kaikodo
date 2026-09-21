import { useEffect, useRef, useState } from 'react';
import { loadLeaflet } from '@/components/spots/spotsHelpers';
import { KODO_TILE_URL, KODO_TILE_SUBDOMAINS, KODO_TILE_ATTRIBUTION, injectKodoMapStyles } from '@/components/spots/mapTiles';
import { loadGoogleMaps, KODO_GOOGLE_MAP_STYLE, canUseGoogleToday, markGoogleUsed, getGoogleMapsApiKey } from '@/lib/googleMaps';
import { arePointsTight, SINGLE_POINT_ZOOM, MAX_FIT_ZOOM } from '@/lib/mapFit';
import { stayGoogleIcon, stayLeafletIcon } from '@/components/spots/stayIcon';

// Mini-mapa de la ruta del dia: hotel (si hay uno guardado como spot type
// 'hotel' para esta ciudad) + los items del dia con coordenadas, numerados
// en el mismo orden en que aparecen en el timeline de abajo.
//
// Renderiza con Google Maps cuando hay API key configurada (comprobado vía
// getGoogleMapsApiKey(), que la pide al backend) -- necesario porque en
// cuanto DocumentForm/Restaurants empiecen a guardar coordenadas que vienen
// de Google Places, los terminos de Google exigen mostrar esos datos sobre
// un mapa de Google, no sobre Leaflet/CARTO. Sin key configurada se sigue
// usando el Leaflet de siempre, sin ningun cambio de comportamiento.
const DOC_ROUTE_COLOR = { flight: '#2563eb', train: '#16a34a' };

function numberedDivIcon(L, num, bg) {
    return L.divIcon({
          html: '<div style="width:24px;height:24px;background:' + bg + ';color:#fff;border:2.5px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.3)">' + num + '</div>',
          iconSize: [24, 24], iconAnchor: [12, 12], className: '',
    });
}

function numberedSvgIcon(google, num, bg) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="11" fill="${bg}" stroke="#fff" stroke-width="2.5"/><text x="14" y="18" text-anchor="middle" font-size="11" font-weight="700" font-family="sans-serif" fill="#fff">${num}</text></svg>`;
    return {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
          scaledSize: new google.maps.Size(28, 28),
          anchor: new google.maps.Point(14, 14),
    };
}

export default function TodayRouteMap({ hotelSpot, items = [], height = 150, onSelectSpot }) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    // Mismo problema real que ya se arregló en DaySpotsMap.jsx (14 sep
    // 2026): un google.maps.Map no tiene .remove(). Aquí es MÁS grave
    // porque este mapa no es colapsable — se desmonta/limpia cada vez que
    // cambian hotelSpot/items (ver deps del useEffect más abajo, línea con
    // routeItems.map(...)), así que con Google activo podía petar la app
    // solo por navegar Hoy/Mañana con normalidad, no solo al cerrar algo
    // a propósito.
    const mapLibRef = useRef(null);
    const markersRef = useRef([]);
    const onSelectSpotRef = useRef(onSelectSpot);
    onSelectSpotRef.current = onSelectSpot;

  const routeItems = items.filter(i => i._kind === 'spot' ? (i?.lat && i?.lng) : (i?.location_lat && i?.location_lng));
    const hasHotel = !!(hotelSpot?.lat && hotelSpot?.lng);
    const totalPoints = routeItems.length + (hasHotel ? 1 : 0);
        // null = todavía no sabemos si hay Google (se pregunta a la vez que se monta el
        // componente). Antes arrancaba en false, así que se creaba primero un mapa
        // Leaflet que se destruía al llegar la respuesta y se creaba el de Google en
        // el mismo contenedor: parpadeo gris de varios segundos y clases de Leaflet
        // sobrando en el contenedor de Google.
        const [useGoogle, setUseGoogle] = useState(null);
        useEffect(() => {
            let cancelled = false;
            getGoogleMapsApiKey().then(key => {
                if (!cancelled) setUseGoogle(!!key && canUseGoogleToday('mapLoad'));
            });
            return () => { cancelled = true; };
        }, []);

  useEffect(() => {
        if (totalPoints === 0 || useGoogle === null) return undefined;
        let cancelled = false;

                if (useGoogle) {
                        loadGoogleMaps().then(google => {
                                  if (cancelled || !containerRef.current) return;
                                                markGoogleUsed('mapLoad');
                                  markersRef.current.forEach(m => m.setMap(null));
                                  markersRef.current = [];

                                                      if (!mapRef.current || mapLibRef.current !== 'google') {
                                                                  mapRef.current = new google.maps.Map(containerRef.current, {
                                                                                styles: KODO_GOOGLE_MAP_STYLE,
                                                                                disableDefaultUI: true,
                                                                                gestureHandling: 'greedy',
                                                                                scrollwheel: false,
                                                                  });
                                                                  mapLibRef.current = 'google';
                                                      }
                                  const map = mapRef.current;
                                  const bounds = new google.maps.LatLngBounds();
                                  const path = [];

                                                      if (hasHotel) {
                                                                  const pos = { lat: hotelSpot.lat, lng: hotelSpot.lng };
                                                                  const marker = new google.maps.Marker({ position: pos, map, icon: stayGoogleIcon(google) });
                                                                  marker.addListener('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current({ ...hotelSpot, _kind: 'spot' }); });
                                                                  markersRef.current.push(marker);
                                                                  bounds.extend(pos); path.push(pos);
                                                      }

                                                      routeItems.forEach((item, i) => {
                                                                  const isDoc = item._kind === 'doc';
                                                                  const lat = isDoc ? item.location_lat : item.lat;
                                                                  const lng = isDoc ? item.location_lng : item.lng;
                                                                  const pos = { lat, lng };
                                                                  const bg = isDoc ? (DOC_ROUTE_COLOR[item.category || item.type] || 'hsl(16 75% 45%)') : 'hsl(16 75% 45%)';
                                                                  const marker = new google.maps.Marker({ position: pos, map, icon: numberedSvgIcon(google, i + 1, bg) });
                                                                  marker.addListener('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current(item); });
                                                                  markersRef.current.push(marker);
                                                                  bounds.extend(pos); path.push(pos);
                                                      });

                                                      if (path.length > 1) {
                                                                  new google.maps.Polyline({ path, map, strokeColor: 'hsl(16 75% 45%)', strokeOpacity: 0.85, strokeWeight: 2.5, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1 }, offset: '0', repeat: '10px' }] });
                                                      }
                                                      if (arePointsTight(path)) {
                                                                  map.setCenter(bounds.getCenter());
                                                                  map.setZoom(SINGLE_POINT_ZOOM);
                                                      } else {
                                                                  map.fitBounds(bounds, 24);
                                                                  google.maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM); });
                                                      }
                        }).catch((err) => { console.warn('[TodayRouteMap] Google Maps fallo, cayendo a Leaflet:', err); if (!cancelled) runLeaflet(); });
                        return () => { cancelled = true; };
                }

                function runLeaflet() {
                    injectKodoMapStyles();
        loadLeaflet().then(L => {
                if (cancelled || !containerRef.current) return;
                if (mapRef.current && mapLibRef.current === 'leaflet') { mapRef.current.remove(); mapRef.current = null; }

                                 const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
                mapLibRef.current = 'leaflet';
                L.tileLayer(KODO_TILE_URL, { subdomains: KODO_TILE_SUBDOMAINS, attribution: KODO_TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
                map.invalidateSize();

                                 const points = [];

                                 if (hasHotel) {
                                           points.push([hotelSpot.lat, hotelSpot.lng]);
                                           const hotelIcon = stayLeafletIcon(L);
                                           const hotelMarker = L.marker([hotelSpot.lat, hotelSpot.lng], { icon: hotelIcon }).addTo(map);
                                           hotelMarker.on('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current({ ...hotelSpot, _kind: 'spot' }); });
                                 }

                                 routeItems.forEach((item, i) => {
                                           const isDoc = item._kind === 'doc';
                                           const lat = isDoc ? item.location_lat : item.lat;
                                           const lng = isDoc ? item.location_lng : item.lng;
                                           points.push([lat, lng]);
                                           const bg = isDoc ? (DOC_ROUTE_COLOR[item.category || item.type] || 'hsl(16 75% 45%)') : 'hsl(16 75% 45%)';
                                           const marker = L.marker([lat, lng], { icon: numberedDivIcon(L, i + 1, bg) }).addTo(map);
                                           marker.on('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current(item); });
                                 });

                                 if (points.length > 1) {
                                           L.polyline(points, { color: 'hsl(16 75% 45%)', weight: 2.5, dashArray: '5,6', opacity: 0.85 }).addTo(map);
                                 }
                                 const leafletTight = arePointsTight(points.map(([lat, lng]) => ({ lat, lng })));
                                 const fitLeaflet = (m) => {
                                           if (leafletTight) m.setView(L.latLngBounds(points).getCenter(), SINGLE_POINT_ZOOM);
                                           else m.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: MAX_FIT_ZOOM });
                                 };
                                 fitLeaflet(map);

                                 requestAnimationFrame(() => {
                                           if (cancelled || !mapRef.current) return;
                                           mapRef.current.invalidateSize();
                                           fitLeaflet(mapRef.current);
                                 });

                                 mapRef.current = map;
        });
                }

      if (!useGoogle) runLeaflet();
      

                return () => {
                        cancelled = true;
                        if (mapRef.current) {
                                // .remove() solo existe en Leaflet — ver comentario arriba.
                                if (mapLibRef.current === 'leaflet') mapRef.current.remove();
                                else if (mapLibRef.current === 'google') markersRef.current.forEach(m => m.setMap(null));
                                mapRef.current = null;
                                mapLibRef.current = null;
                        }
                        markersRef.current = [];
                };

  }, [hotelSpot?.id, hotelSpot?.lat, hotelSpot?.lng, useGoogle, routeItems.map(i => i.id + ':' + (i._kind === 'doc' ? i.location_lat + ':' + i.location_lng : i.lat + ':' + i.lng)).join(',')]);

  if (totalPoints === 0) return null;

  return <div ref={containerRef} className="kodo-map-warm" style={{ height, borderRadius: 12, overflow: 'hidden' }} />;
}