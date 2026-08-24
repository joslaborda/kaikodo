import { useEffect, useRef, useState } from 'react';
import { loadLeaflet } from '@/components/spots/spotsHelpers';
import { KODO_TILE_URL, KODO_TILE_SUBDOMAINS, KODO_TILE_ATTRIBUTION, injectKodoMapStyles } from '@/components/spots/mapTiles';
import { loadGoogleMaps, isGoogleMapsConfigured, KODO_GOOGLE_MAP_STYLE, canUseGoogleToday, markGoogleUsed, getGoogleMapsApiKey } from '@/lib/googleMaps';

// Mini-mapa de la ruta del dia: hotel (si hay uno guardado como spot type
// 'hotel' para esta ciudad) + los items del dia con coordenadas, numerados
// en el mismo orden en que aparecen en el timeline de abajo.
//
// Renderiza con Google Maps cuando hay API key configurada (ver
// isGoogleMapsConfigured en src/lib/googleMaps.js) -- necesario porque en
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

function hotelSvgIcon(google) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="34" viewBox="0 0 30 34"><path d="M15 1C7.8 1 2 6.8 2 14c0 9.5 13 19 13 19s13-9.5 13-19C28 6.8 22.2 1 15 1z" fill="#6b6460" stroke="#fff" stroke-width="2.5"/><path d="M9 15l6-4.5 6 4.5v6.5a1.2 1.2 0 0 1-1.2 1.2H10.2A1.2 1.2 0 0 1 9 21.5z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M12.5 22.7V17h5v5.7" fill="none" stroke="#fff" stroke-width="1.8"/></svg>`;
    return {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
          scaledSize: new google.maps.Size(30, 34),
          anchor: new google.maps.Point(15, 32),
    };
}

export default function TodayRouteMap({ hotelSpot, items = [], height = 150, onSelectSpot }) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const markersRef = useRef([]);
    const onSelectSpotRef = useRef(onSelectSpot);
    onSelectSpotRef.current = onSelectSpot;

  const routeItems = items.filter(i => i._kind === 'spot' ? (i?.lat && i?.lng) : (i?.location_lat && i?.location_lng));
    const hasHotel = !!(hotelSpot?.lat && hotelSpot?.lng);
    const totalPoints = routeItems.length + (hasHotel ? 1 : 0);
        const [useGoogle, setUseGoogle] = useState(false);
        useEffect(() => {
            let cancelled = false;
            getGoogleMapsApiKey().then(key => {
                if (!cancelled) setUseGoogle(!!key && canUseGoogleToday('mapLoad'));
            });
            return () => { cancelled = true; };
        }, []);

  useEffect(() => {
        if (totalPoints === 0) return undefined;
        let cancelled = false;

                if (useGoogle) {
                        loadGoogleMaps().then(google => {
                                  if (cancelled || !containerRef.current) return;
                                                markGoogleUsed('mapLoad');
                                  markersRef.current.forEach(m => m.setMap(null));
                                  markersRef.current = [];

                                                      if (!mapRef.current) {
                                                                  mapRef.current = new google.maps.Map(containerRef.current, {
                                                                                styles: KODO_GOOGLE_MAP_STYLE,
                                                                                disableDefaultUI: true,
                                                                                gestureHandling: 'greedy',
                                                                                scrollwheel: false,
                                                                  });
                                                      }
                                  const map = mapRef.current;
                                  const bounds = new google.maps.LatLngBounds();
                                  const path = [];

                                                      if (hasHotel) {
                                                                  const pos = { lat: hotelSpot.lat, lng: hotelSpot.lng };
                                                                  const marker = new google.maps.Marker({ position: pos, map, icon: hotelSvgIcon(google) });
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
                                                                  map.fitBounds(bounds, 24);
                                                      } else {
                                                                  map.setCenter(path[0]);
                                                                  map.setZoom(15);
                                                      }
                        }).catch((err) => { console.warn('[TodayRouteMap] Google Maps fallo, cayendo a Leaflet:', err); if (!cancelled) runLeaflet(); });
                        return () => { cancelled = true; };
                }

                function runLeaflet() {
                    injectKodoMapStyles();
        loadLeaflet().then(L => {
                if (cancelled || !containerRef.current) return;
                if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

                                 const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
                L.tileLayer(KODO_TILE_URL, { subdomains: KODO_TILE_SUBDOMAINS, attribution: KODO_TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
                map.invalidateSize();

                                 const points = [];

                                 if (hasHotel) {
                                           points.push([hotelSpot.lat, hotelSpot.lng]);
                                           const hotelIcon = L.divIcon({
                                                       html: '<div style="width:26px;height:26px;background:#6b6460;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" style="transform:rotate(45deg)"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg></div>',
                                                       iconSize: [26, 26], iconAnchor: [13, 26], className: '',
                                           });
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
                                           map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
                                 } else {
                                           map.setView(points[0], 15);
                                 }

                                 requestAnimationFrame(() => {
                                           if (cancelled || !mapRef.current) return;
                                           mapRef.current.invalidateSize();
                                           if (points.length > 1) {
                                                       mapRef.current.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
                                           } else {
                                                       mapRef.current.setView(points[0], 15);
                                           }
                                 });

                                 mapRef.current = map;
        });
                }

      if (!useGoogle) runLeaflet();
      

                return () => {
                        cancelled = true;
                        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
                };

  }, [hotelSpot?.id, hotelSpot?.lat, hotelSpot?.lng, useGoogle, routeItems.map(i => i.id + ':' + (i._kind === 'doc' ? i.location_lat + ':' + i.location_lng : i.lat + ':' + i.lng)).join(',')]);

  if (totalPoints === 0) return null;

  return <div ref={containerRef} className="kodo-map-warm" style={{ height, borderRadius: 12, overflow: 'hidden' }} />;
}