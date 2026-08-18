import { useEffect, useRef, useState } from 'react';
import { loadLeaflet } from '@/components/spots/spotsHelpers';
import { KODO_TILE_URL, KODO_TILE_SUBDOMAINS, KODO_TILE_ATTRIBUTION, injectKodoMapStyles } from '@/components/spots/mapTiles';
import { loadGoogleMaps, KODO_GOOGLE_MAP_STYLE, canUseGoogleToday, markGoogleUsed, getGoogleMapsApiKey } from '@/lib/googleMaps';

// Mapa colapsable de los spots de un día concreto dentro de Ruta (Cities.jsx).
// Reutiliza el mismo patrón que TodayRouteMap/SpotsMapView: Google Maps cuando
// hay API key y tope diario disponible (canUseGoogleToday('mapLoad') +
// markGoogleUsed('mapLoad')), con fallback a Leaflet (CARTO Positron) si no.
// Solo se monta cuando el usuario despliega el botón "Mapa" del día, así que
// no consume tope ni carga scripts hasta entonces.

const PIN_COLOR = 'hsl(16 75% 45%)';

function numberedSvgIcon(google, num) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="11" fill="${PIN_COLOR}" stroke="#fff" stroke-width="2.5"/><text x="14" y="18" text-anchor="middle" font-size="11" font-weight="700" font-family="sans-serif" fill="#fff">${num}</text></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(28, 28),
    anchor: new google.maps.Point(14, 14),
  };
}

function numberedDivIcon(L, num) {
  return L.divIcon({
    html: `<div style="width:24px;height:24px;background:${PIN_COLOR};color:#fff;border:2.5px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.3)">${num}</div>`,
    iconSize: [24, 24], iconAnchor: [12, 12], className: '',
  });
}

export default function DaySpotsMap({ spots = [], height = 220, onSelectSpot }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const onSelectSpotRef = useRef(onSelectSpot);
  onSelectSpotRef.current = onSelectSpot;

  const mappable = spots.filter(s => s?.lat && s?.lng);

  const [useGoogle, setUseGoogle] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getGoogleMapsApiKey().then(key => {
      if (!cancelled) setUseGoogle(!!key && canUseGoogleToday('mapLoad'));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mappable.length === 0) return undefined;
    let cancelled = false;

    function runLeaflet() {
      injectKodoMapStyles();
      loadLeaflet().then(L => {
        if (cancelled || !containerRef.current) return;
        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
        const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
        L.tileLayer(KODO_TILE_URL, { subdomains: KODO_TILE_SUBDOMAINS, attribution: KODO_TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
        map.invalidateSize();
        const points = [];
        mappable.forEach((spot, i) => {
          points.push([spot.lat, spot.lng]);
          const marker = L.marker([spot.lat, spot.lng], { icon: numberedDivIcon(L, i + 1) }).addTo(map);
          marker.on('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current(spot); });
        });
        if (points.length > 1) {
          L.polyline(points, { color: PIN_COLOR, weight: 2.5, dashArray: '5,6', opacity: 0.85 }).addTo(map);
          map.fitBounds(L.latLngBounds(points), { padding: [32, 32] });
        } else {
          map.setView(points[0], 15);
        }
        requestAnimationFrame(() => {
          if (cancelled || !mapRef.current) return;
          mapRef.current.invalidateSize();
          if (points.length > 1) mapRef.current.fitBounds(L.latLngBounds(points), { padding: [32, 32] });
          else mapRef.current.setView(points[0], 15);
        });
        mapRef.current = map;
      });
    }

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
            zoomControl: true,
            gestureHandling: 'greedy',
          });
        }
        const map = mapRef.current;
        const bounds = new google.maps.LatLngBounds();
        const path = [];
        mappable.forEach((spot, i) => {
          const pos = { lat: spot.lat, lng: spot.lng };
          const marker = new google.maps.Marker({ position: pos, map, icon: numberedSvgIcon(google, i + 1) });
          marker.addListener('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current(spot); });
          markersRef.current.push(marker);
          bounds.extend(pos); path.push(pos);
        });
        if (path.length > 1) {
          new google.maps.Polyline({ path, map, strokeColor: PIN_COLOR, strokeOpacity: 0.85, strokeWeight: 2.5, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1 }, offset: '0', repeat: '10px' }] });
          map.fitBounds(bounds, 32);
        } else {
          map.setCenter(path[0]); map.setZoom(15);
        }
      }).catch(() => { if (!cancelled) runLeaflet(); });
    } else {
      runLeaflet();
    }

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [useGoogle, mappable.map(s => s.id + ':' + s.lat + ':' + s.lng).join(',')]);

  if (mappable.length === 0) return null;

  return <div ref={containerRef} className="kodo-map-warm" style={{ height, borderRadius: 12, overflow: 'hidden' }} />;
}