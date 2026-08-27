import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { loadLeaflet } from './spotsHelpers';
import { KODO_TILE_URL, KODO_TILE_SUBDOMAINS, KODO_TILE_ATTRIBUTION, injectKodoMapStyles } from './mapTiles';
import { loadGoogleMaps, KODO_GOOGLE_MAP_STYLE, canUseGoogleToday, markGoogleUsed, getGoogleMapsApiKey } from '@/lib/googleMaps';
import { spotTypeIconSvg } from './spotTypeIcon';

// Antes cada día usaba uno de los 5 --chart-1..5, todos tonos naranja/marrón
// muy parecidos entre sí ("los colores... no son suficientemente
// diferentes" fue el feedback exacto). Esta paleta está sacada de las
// líneas del metro de Londres precisamente porque están diseñadas para
// distinguirse a simple vista incluso en espacios pequeños (un aro de pocos
// px, un pin, un chip) — el mismo problema que resuelve el mapa del tube.
// Si un viaje tiene más de 12 días con spots asignados, se cicla desde el
// principio otra vez.
const TUBE_COLORS = [
  '#E32017', // Central — rojo
  '#0098D4', // Victoria — azul claro
  '#00782A', // District — verde
  '#B36305', // Bakerloo — marrón
  '#9B0056', // Metropolitan — magenta
  '#003688', // Piccadilly — azul oscuro
  '#F3A9BB', // Hammersmith & City — rosa
  '#6950A1', // Elizabeth — morado
  '#95CDBA', // Waterloo & City — turquesa
  '#FFD300', // Circle — amarillo
  '#A0A5A9', // Jubilee — gris
  '#000000', // Northern — negro
];

// Version Google Maps de los mismos iconos que ya usa Leaflet mas abajo
// (numberedIcon/plainIcon, dentro del componente): mismo diseno visual --
// circulo numerado por color de dia, o pin plano con el icono real del tipo
// de spot -- pero como URL de imagen (SVG data-uri), que es lo que exige
// la API de Marker de Google Maps en vez de un elemento DOM como Leaflet.
function numberedSvgIcon(google, num, color, size) {
    size = size || 26;
    var r = size / 2 - 2.5;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="' + color + '" stroke="#fff" stroke-width="2.5"/><text x="' + size / 2 + '" y="' + (size / 2 + 4) + '" text-anchor="middle" font-size="12" font-weight="800" font-family="sans-serif" fill="#fff">' + num + '</text></svg>';
    return {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
          scaledSize: new google.maps.Size(size, size),
          anchor: new google.maps.Point(size / 2, size / 2),
    };
}

function plainSvgIcon(google, spot, size) {
    size = size || 28;
    const inner = spotTypeIconSvg(spot.type, { size: 13, color: '#fff', strokeWidth: 2.5 });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + (size / 2 - 1) + '" fill="#8a8580" fill-opacity="0.35"/><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + (size / 2 - 5) + '" fill="hsl(16 75% 45%)" fill-opacity="0.92" stroke="#fff" stroke-width="2.5"/><g transform="translate(' + (size / 2 - 6.5) + ',' + (size / 2 - 6.5) + ')">' + inner + '</g></svg>';
    return {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
          scaledSize: new google.maps.Size(size, size),
          anchor: new google.maps.Point(size / 2, size / 2),
    };
}

// Mapa de "todo el viaje" para la tab Mis spots: "Todos" dibuja, a la vez,
// la ruta conectada y numerada de CADA día (un color por día, estilo mapa
// de metro) más los spots sin fecha como pines sueltos — antes "Todos" solo
// agrupaba por ciudad y no se veía ninguna ruta hasta elegir un día suelto.
// Elegir un chip de día aísla esa ruta sola. Tocar el mapa fuera de un pin
// dispara onCreatePin(lat,lng) para soltar un pin nuevo ahí mismo.
export default function SpotsMapView({ spots = [], cities = [], onCreatePin, onSelectSpot, height = 260 }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? undefined : es;
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const onCreatePinRef = useRef(onCreatePin);
  const onSelectSpotRef = useRef(onSelectSpot);
  onCreatePinRef.current = onCreatePin;
  onSelectSpotRef.current = onSelectSpot;
    const markersRef = useRef([]);
    const polylinesRef = useRef([]);
    const [useGoogle, setUseGoogle] = useState(false);
    useEffect(() => {
        let cancelled = false;
        getGoogleMapsApiKey().then(key => {
            if (!cancelled) setUseGoogle(!!key && canUseGoogleToday('mapLoad'));
        });
        return () => { cancelled = true; };
    }, []);

  const [selectedDate, setSelectedDate] = useState(null);

  const withCoords = spots.filter(s => s?.lat && s?.lng);

  const distinctDates = [...new Set(withCoords.map(s => s.assigned_date).filter(Boolean))].sort();
  const dayColor = (date) => date ? TUBE_COLORS[distinctDates.indexOf(date) % TUBE_COLORS.length] : 'hsl(var(--muted-foreground) / .35)';

  // Mismo orden que ya usa el timeline de Home/Ruta: day_order primero
  // (posición explícita guardada al arrastrar), si no hay, por hora
  // asignada, si tampoco hay, al final — así el numerito del pin coincide
  // con el orden real del día.
  const sortByDayOrder = (list) => [...list].sort((a, b) => {
    if (a.day_order != null && b.day_order != null) return a.day_order - b.day_order;
    if (a.day_order != null) return -1;
    if (b.day_order != null) return 1;
    const at = a.assigned_time || '99:99', bt = b.assigned_time || '99:99';
    return at.localeCompare(bt);
  });

  const dayRoutes = distinctDates.map(d => ({
    date: d,
    color: dayColor(d),
    spots: sortByDayOrder(withCoords.filter(s => s.assigned_date === d)),
  }));
  const unscheduledSpots = withCoords.filter(s => !s.assigned_date);

  const visibleRoutes = selectedDate ? dayRoutes.filter(r => r.date === selectedDate) : dayRoutes;
  const visibleUnscheduled = selectedDate ? [] : unscheduledSpots;

  useEffect(() => {
    if (!withCoords.length) return undefined;
    let cancelled = false;

    const renderLeaflet = () => {
          injectKodoMapStyles();
    loadLeaflet().then(L => {
      if (cancelled || !containerRef.current) return;
      if (mapRef.current && mapRef.current.remove) { mapRef.current.remove(); mapRef.current = null; }

      // zoomControl:true — mismo default que LeafletMap.jsx (el selector de
      // pin al crear spot). Antes lo llevaba a false sin querer y, sumado a
      // scrollWheelZoom:false, no había ninguna forma de hacer zoom out.
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
      L.tileLayer(KODO_TILE_URL, { subdomains: KODO_TILE_SUBDOMAINS, attribution: KODO_TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
      // El contenedor puede no tener su tamaño final asentado en el instante
      // en que corre este efecto (cambio de tab, layout todavía animando) y
      // un fitBounds contra un tamaño stale deja el mapa con pines fuera del
      // viewport visible.
      map.invalidateSize();

      map.on('click', (e) => {
        if (onCreatePinRef.current) onCreatePinRef.current(e.latlng.lat, e.latlng.lng);
      });

      const numberedIcon = (num, color, size = 26) => L.divIcon({
        html: '<div style="width:' + size + 'px;height:' + size + 'px;background:' + color + ';color:#fff;border:2.5px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;box-shadow:0 2px 8px rgba(0,0,0,.3)">' + num + '</div>',
        iconSize: [size, size], iconAnchor: [size / 2, size / 2], className: '',
      });

      // Spot sin fecha — pin suelto con el icono real de su tipo, sin
      // número ni línea (no pertenece a ninguna ruta de día todavía).
      const plainIcon = (spot, size = 28) => {
        const inner = spotTypeIconSvg(spot.type, { size: 13, color: '#fff', strokeWidth: 2.5 });
        return L.divIcon({
          html: '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;padding:3px;background:hsl(var(--muted-foreground) / .35)">' +
            '<div style="width:100%;height:100%;background:hsl(16 75% 45% / .92);color:#fff;border:2.5px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center">' + inner + '</div>' +
          '</div>',
          iconSize: [size, size], iconAnchor: [size / 2, size / 2], className: '',
        });
      };

      const allPoints = [];

      visibleRoutes.forEach(route => {
        const points = route.spots.map(s => [s.lat, s.lng]);
        allPoints.push(...points);
        route.spots.forEach((spot, i) => {
          const marker = L.marker([spot.lat, spot.lng], { icon: numberedIcon(i + 1, route.color) }).addTo(map);
          marker.on('click', (e) => {
            if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
            if (onSelectSpotRef.current) onSelectSpotRef.current(spot);
          });
        });
        if (points.length > 1) {
          L.polyline(points, { color: route.color, weight: 2.5, dashArray: '5,6', opacity: 0.85 }).addTo(map);
        }
      });

      visibleUnscheduled.forEach(spot => {
        allPoints.push([spot.lat, spot.lng]);
        const marker = L.marker([spot.lat, spot.lng], { icon: plainIcon(spot) }).addTo(map);
        marker.on('click', (e) => {
          if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
          if (onSelectSpotRef.current) onSelectSpotRef.current(spot);
        });
      });

      const fitToPoints = () => {
        if (!mapRef.current || allPoints.length === 0) return;
        if (allPoints.length > 1) mapRef.current.fitBounds(L.latLngBounds(allPoints), { padding: [42, 42] });
        else mapRef.current.setView(allPoints[0], 15);
      };

      mapRef.current = map;
      fitToPoints();
      // Mismo motivo que el invalidateSize() de arriba: si el layout no
      // estaba del todo asentado en este frame, se repite el encuadre en el
      // siguiente, cuando el tamaño del contenedor ya es fiable al 100%.
      requestAnimationFrame(() => { if (!cancelled) { mapRef.current?.invalidateSize(); fitToPoints(); } });
    });
    };

      if (useGoogle) {
            loadGoogleMaps().then(google => {
                    if (cancelled || !containerRef.current) return;
                    markGoogleUsed('mapLoad');
                    markersRef.current.forEach(m => m.setMap(null));
                    markersRef.current = [];
                    polylinesRef.current.forEach(p => p.setMap(null));
                    polylinesRef.current = [];

                    if (!mapRef.current) {
                              mapRef.current = new google.maps.Map(containerRef.current, {
                                          styles: KODO_GOOGLE_MAP_STYLE,
                                          disableDefaultUI: true,
                                          zoomControl: true,
                                          gestureHandling: 'greedy',
                              });
                              mapRef.current.addListener('click', (e) => {
                                          if (onCreatePinRef.current) onCreatePinRef.current(e.latLng.lat(), e.latLng.lng());
                              });
                    }
                    const map = mapRef.current;
                    const bounds = new google.maps.LatLngBounds();
                    let anyPoints = false;

                    visibleRoutes.forEach(route => {
                              const path = [];
                              route.spots.forEach((spot, i) => {
                                          const pos = { lat: spot.lat, lng: spot.lng };
                                          const marker = new google.maps.Marker({ position: pos, map, icon: numberedSvgIcon(google, i + 1, route.color) });
                                          marker.addListener('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current(spot); });
                                          markersRef.current.push(marker);
                                          bounds.extend(pos); path.push(pos); anyPoints = true;
                              });
                              if (path.length > 1) {
                                          const poly = new google.maps.Polyline({ path, map, strokeColor: route.color, strokeOpacity: 0.85, strokeWeight: 2.5, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1 }, offset: '0', repeat: '10px' }] });
                                          polylinesRef.current.push(poly);
                              }
                    });

                    visibleUnscheduled.forEach(spot => {
                              const pos = { lat: spot.lat, lng: spot.lng };
                              const marker = new google.maps.Marker({ position: pos, map, icon: plainSvgIcon(google, spot) });
                              marker.addListener('click', () => { if (onSelectSpotRef.current) onSelectSpotRef.current(spot); });
                              markersRef.current.push(marker);
                              bounds.extend(pos); anyPoints = true;
                    });

                    if (anyPoints) {
                              if (markersRef.current.length > 1) map.fitBounds(bounds, 42);
                              else { map.setCenter(bounds.getCenter()); map.setZoom(15); }
                    }
            }).catch((err) => { console.warn('[SpotsMapView] Google Maps fallo, cayendo a Leaflet:', err); if (!cancelled) renderLeaflet(); });
      } else {
            renderLeaflet();
      }
    

    return () => {
      cancelled = true;
      if (mapRef.current && mapRef.current.remove) { mapRef.current.remove(); mapRef.current = null; }
    };
     
  }, [
    selectedDate,
        useGoogle,
    withCoords.map(s => s.id + '@' + (s.assigned_date || '') + '@' + (s.day_order ?? '') + '@' + (s.assigned_time || '')).join(','),
  ]);

  if (!withCoords.length) {
    return (
      <div className="text-center py-10 border-2 border-dashed border-border rounded-2xl bg-card">
        <p className="text-sm text-muted-foreground">{t('spots.map.noCoords')}</p>
      </div>
    );
  }

  return (
    <div>
      <div ref={containerRef} style={{ height, borderRadius: 16, overflow: 'hidden', cursor: 'crosshair' }} className="border border-border kodo-map-warm" />

      {/* Selector de día debajo del mapa, igual que el resto de selectores
          de chip de la app (sin scroll lateral, envuelve en varias líneas
          si no caben). "Todos" ya no es la vista agrupada por ciudad de
          antes — dibuja la ruta de cada día a la vez, una encima de otra,
          cada una de su color. Un chip de día aísla esa ruta sola. */}
      {distinctDates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2 px-1">
          <button onClick={() => setSelectedDate(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              !selectedDate ? 'bg-primary text-white border-primary' : 'bg-card text-muted-foreground border-border hover:border-primary/40'
            }`}>
            {t('spots.map.allDays')}
          </button>
          {distinctDates.map((d, i) => (
            <button key={d} onClick={() => setSelectedDate(d)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                selectedDate === d ? 'text-white border-transparent' : 'bg-card text-muted-foreground border-border hover:border-primary/40'
              }`}
              style={selectedDate === d ? { background: TUBE_COLORS[i % TUBE_COLORS.length] } : {}}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TUBE_COLORS[i % TUBE_COLORS.length] }} />
              {format(parseISO(d), 'dd MMM', { locale: dateLocale })}
            </button>
          ))}
        </div>
      )}

      {selectedDate ? (
        <p className="text-xs text-muted-foreground mt-2 px-1">{t('spots.map.dayRouteHint')}</p>
      ) : (
        <>
          {unscheduledSpots.length > 0 && distinctDates.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 px-1 text-xs text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-muted-foreground/35" />
              {t('spots.map.noDate')}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2 px-1">{t('spots.map.tapHint')}</p>
        </>
      )}
    </div>
  );
}