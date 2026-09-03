import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { loadLeaflet } from '@/components/spots/spotsHelpers';
import { KODO_TILE_URL, KODO_TILE_SUBDOMAINS, KODO_TILE_ATTRIBUTION, injectKodoMapStyles } from '@/components/spots/mapTiles';
import { loadGoogleMaps, KODO_GOOGLE_MAP_STYLE, canUseGoogleToday, markGoogleUsed, getGoogleMapsApiKey } from '@/lib/googleMaps';

// Mapa de "Mi colección" en el Perfil (guardados + creados). Mismo patrón que
// DaySpotsMap/SpotsMapView/TodayRouteMap: Google Maps cuando hay API key y
// tope diario disponible (canUseGoogleToday('mapLoad')), con fallback a
// Leaflet (CARTO Positron + filtro cálido) si no. A diferencia de
// DaySpotsMap (spots de un día, numerados, con ruta), aquí no hay orden ni
// ruta — el color del pin indica si el spot es tuyo (creado) o guardado.
const COLOR_MINE = 'hsl(142 63% 30%)';
const COLOR_SAVED = 'hsl(16 75% 45%)';

function svgIcon(google, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><circle cx="13" cy="13" r="10" fill="${color}" stroke="#fff" stroke-width="2.5"/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(26, 26),
    anchor: new google.maps.Point(13, 13),
  };
}
function divIcon(L, color) {
  return L.divIcon({
    html: `<div style="width:22px;height:22px;background:${color};border:2.5px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11], className: '',
  });
}

export default function CollectionMapView({ spots = [], height = 340, onSelectSpot }) {
  const { t } = useTranslation();
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
        mappable.forEach(spot => {
          points.push([spot.lat, spot.lng]);
          const marker = L.marker([spot.lat, spot.lng], { icon: divIcon(L, spot.owner === 'mine' ? COLOR_MINE : COLOR_SAVED) }).addTo(map);
          marker.on('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current(spot); });
        });
        if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [32, 32] });
        else map.setView(points[0], 13);
        requestAnimationFrame(() => {
          if (cancelled || !mapRef.current) return;
          mapRef.current.invalidateSize();
          if (points.length > 1) mapRef.current.fitBounds(L.latLngBounds(points), { padding: [32, 32] });
          else mapRef.current.setView(points[0], 13);
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
        mappable.forEach(spot => {
          const pos = { lat: spot.lat, lng: spot.lng };
          const marker = new google.maps.Marker({ position: pos, map, icon: svgIcon(google, spot.owner === 'mine' ? COLOR_MINE : COLOR_SAVED) });
          marker.addListener('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current(spot); });
          markersRef.current.push(marker);
          bounds.extend(pos);
        });
        if (mappable.length > 1) map.fitBounds(bounds, 32);
        else { map.setCenter(bounds.getCenter()); map.setZoom(13); }
      }).catch((err) => { console.warn('[CollectionMapView] Google Maps fallo, cayendo a Leaflet:', err); if (!cancelled) runLeaflet(); });
    } else {
      runLeaflet();
    }

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [useGoogle, mappable.map(s => s.id + ':' + s.lat + ':' + s.lng).join(',')]);

  if (mappable.length === 0) {
    return (
      <div style={{ height }} className="rounded-2xl border border-border bg-card flex flex-col items-center justify-center gap-2 text-center px-6">
        <MapPin className="w-6 h-6 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">{t('profile.mapEmpty')}</p>
      </div>
    );
  }

  return <div ref={containerRef} className="kodo-map-warm" style={{ height, borderRadius: 16, overflow: 'hidden' }} />;
}
