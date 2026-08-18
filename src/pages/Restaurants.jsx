import { createPageUrl } from '@/utils';
import { useState, useEffect, useRef, useMemo} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { normalizeEmail } from '@/lib/utils';
import { useTripContext } from '@/hooks/useTripContext';
import { notify, resolveUserIds } from '@/lib/notifications';
import { searchUserProfiles } from '@/lib/userProfiles';
import { normalizeCountry } from '@/lib/countryConfig';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, X, Navigation, MapPin, ArrowRight, Utensils, Landmark, Ticket, ShoppingBag, CirclePlus, Compass, Moon, AlertTriangle, Loader2, Check, CheckCircle2, List, Map as MapIcon, Hotel, Star } from 'lucide-react';
import OTabBar from '@/components/trip/OTabBar';
import { Link, useNavigate } from 'react-router-dom';
import MySpotRow from '@/components/spots/MySpotRow';
import SpotDetailSheet from '@/components/spots/SpotDetailSheet';
import SpotsMapView from '@/components/spots/SpotsMapView';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { getTripDays, tripDayOptionValue, parseTripDayOptionValue, sameCityName } from '@/lib/tripDays';
import { canUseGoogleToday, markGoogleUsed, getGoogleMapsApiKey } from '@/lib/googleMaps';
// El LeafletMap de aquí abajo es una copia local independiente del
// componente compartido (src/components/spots/LeafletMap.jsx) — no lo
// importa, así que arreglar el tile compartido nunca cambió nada en este
// selector de pin. Se reusa solo el estilo de tiles (CARTO Positron), no el
// componente entero, para no tocar loadLeaflet/reverseGeocode locales.
import { KODO_TILE_URL, KODO_TILE_SUBDOMAINS, KODO_TILE_ATTRIBUTION, injectKodoMapStyles } from '@/components/spots/mapTiles';




// ── Auto-orden por cercanía ──────────────────────────────────────────────────
// Distancia aproximada en metros (Haversine) — de sobra para decidir "cuál de
// los que ya hay ese día tengo más cerca", no para calcular una ruta óptima.
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Dado un spot recién asignado a un día y los spots que YA estaban en ese
// mismo día (ordenados), sugiere en qué índice insertarlo: justo después del
// que tenga más cerca. Si no hay coordenadas de por medio, se va al final —
// sigue siendo editable a mano arrastrando en la lista (DraggableSpotList).
function suggestInsertIndex(newSpot, daySpotsSorted) {
  const withCoords = daySpotsSorted.filter(s => s.lat && s.lng);
  if (!withCoords.length || !newSpot.lat || !newSpot.lng) return daySpotsSorted.length;
  let nearest = withCoords[0], nearestDist = Infinity;
  withCoords.forEach(s => {
    const d = haversineMeters(newSpot.lat, newSpot.lng, s.lat, s.lng);
    if (d < nearestDist) { nearestDist = d; nearest = s; }
  });
  return daySpotsSorted.findIndex(s => s.id === nearest.id) + 1;
}


const GOOGLE_TYPE_MAP = {
  restaurant:'food', cafe:'food', bar:'food', bakery:'food', meal_takeaway:'food',
    meal_delivery:'food', night_club:'food',
    museum:'sight', art_gallery:'sight', tourist_attraction:'sight', church:'sight',
    hindu_temple:'sight', mosque:'sight', synagogue:'sight', park:'sight',
    monument:'sight', historical_landmark:'sight', place_of_worship:'sight',
    shopping_mall:'shopping', clothing_store:'shopping', department_store:'shopping',
    supermarket:'shopping', book_store:'shopping', market:'shopping',
    movie_theater:'activity', bowling_alley:'activity', amusement_park:'activity',
    stadium:'activity', zoo:'activity', spa:'activity',
    lodging:'hotel', hotel:'hotel', motel:'hotel', resort_hotel:'hotel', hostel:'hotel',
    airport:'airport', international_airport:'airport',
    train_station:'train', subway_station:'train', light_rail_station:'train', transit_station:'train',
    bus_station:'bus', bus_stop:'bus',
};
function googleTypeToKodoType(types) {
    for (const t of (types || [])) { if (GOOGLE_TYPE_MAP[t]) return GOOGLE_TYPE_MAP[t]; }
    return 'sight';
}
async function searchPlacesGoogle(query, city, country, signal, apiKey) {
    if (!canUseGoogleToday('autocomplete')) throw new Error('daily-cap-reached');
    const input = [query, city, country].filter(Boolean).join(', ');
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
          body: JSON.stringify({ input, languageCode: 'es' }),
          signal,
    });
    if (!res.ok) return [];
    markGoogleUsed('autocomplete');
    const data = await res.json();
    return (data.suggestions || []).map(s => s.placePrediction).filter(Boolean).slice(0, 8).map(p => ({
          id: p.placeId,
          name: p.structuredFormat?.mainText?.text || p.text?.text || query,
          address: p.structuredFormat?.secondaryText?.text || '',
          lat: null, lng: null,
          type: googleTypeToKodoType(p.types),
          _placeId: p.placeId,
    }));
}
async function fetchPlaceDetailsGoogle(placeId, apiKey, signal) {
    if (!canUseGoogleToday('placeDetails')) return null;
    const res = await fetch('https://places.googleapis.com/v1/places/' + placeId, {
          headers: {
                  'X-Goog-Api-Key': apiKey,
                  'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,primaryType,types,rating,userRatingCount,photos',
          },
          signal,
    });
    if (!res.ok) return null;
    markGoogleUsed('placeDetails');
    const p = await res.json();
  const photoName = p.photos?.[0]?.name;
    return {
          name: p.displayName?.text,
          address: p.formattedAddress,
          lat: p.location?.latitude, lng: p.location?.longitude,
          type: googleTypeToKodoType(p.primaryType ? [p.primaryType, ...(p.types||[])] : p.types),
      rating: p.rating || null,
      userRatingCount: p.userRatingCount || null,
      photoUrl: photoName ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=160&key=${apiKey}` : null,
    };
}

async function searchPlaces(query, city, country, signal) {
    const apiKey = await getGoogleMapsApiKey();
    if (!apiKey) return [];
    try {
          return await searchPlacesGoogle(query, city, country, signal, apiKey);
    } catch (err) {
          if (err?.name === 'AbortError') throw err;
          return [];
    }
}


async function reverseGeocodeGoogle(lat, lng, apiKey, signal) {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=es&key=${apiKey}`,
    { signal }
  );
  if (!res.ok) return '';
  const data = await res.json();
  const result = data.results?.[0];
  if (!result) return '';
  const comp = result.address_components || [];
  const get = type => comp.find(c => c.types.includes(type))?.long_name || '';
  const road = get('route');
  const city = get('locality') || get('postal_town') || get('administrative_area_level_2');
  return [road, city].filter(Boolean).join(', ') || result.formatted_address?.split(',').slice(0, 2).join(',') || '';
}

// reverseGeocode: intenta primero Google Geocoding (mejor calidad de datos),
// y si no hay tope disponible ese día o falla, cae a Nominatim (gratis) —
// mismo patrón de tope+fallback que ya usan autocomplete/placeDetails en
// googleMaps.js, así nunca se rompe la etiqueta de dirección aunque se
// agote la cuota de Google.
async function reverseGeocode(lat, lng) {
  const apiKey = await getGoogleMapsApiKey();
  if (apiKey && canUseGoogleToday('reverseGeocode')) {
    try {
      const label = await reverseGeocodeGoogle(lat, lng, apiKey, AbortSignal.timeout(6000));
      if (label) { markGoogleUsed('reverseGeocode'); return label; }
    } catch {}
  }
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'es,en', 'User-Agent': 'KodoTravelApp/1.0' }, signal: AbortSignal.timeout(6000) }
    );
    const d = await res.json();
    const a = d.address || {};
    const road = a.road || a.pedestrian || a.footway || '';
    const city = a.city || a.town || a.village || a.municipality || '';
    return [road, city].filter(Boolean).join(', ') || d.display_name?.split(',').slice(0,2).join(',') || '';
  } catch { return ''; }
}

async function loadLeaflet() {
  if (window.L) return window.L;
  await new Promise((res, rej) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = res; script.onerror = rej;
    document.head.appendChild(script);
  });
  return window.L;
}

// ── Type config ───────────────────────────────────────────────────────────────
// labelKey (clave i18n, reutiliza spots.types.* que ya tenía el mismo texto)
// en vez de label fijo en español — este mapa es un const de módulo, sin
// acceso a t(), así que se traduce en el punto de uso. Colores con dark:
// añadido — antes no tenían variante y quedaban demasiado claros en modo
// oscuro (chips de tipo en CreateSpotSheet y PlaceResultCard).
const TYPE_CONFIG = {
  food:      { labelKey:'spots.types.food',      Icon: Utensils,    color:'bg-orange-100 dark:bg-orange-950/30 text-primary' },
  sight:     { labelKey:'spots.types.sight',      Icon: Landmark,    color:'bg-violet-100 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400' },
  activity:  { labelKey:'spots.types.activity',   Icon: Ticket,      color:'bg-green-100 dark:bg-green-950/30 text-green-600 dark:text-green-400' },
  shopping:  { labelKey:'spots.types.shopping',   Icon: ShoppingBag, color:'bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400' },
  transport: { labelKey:'spots.types.transport',  Icon: Compass,     color:'bg-secondary text-muted-foreground' },
  hotel:     { labelKey:'spots.types.hotel',      Icon: Hotel,       color:'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400' },
  custom:    { labelKey:'spots.types.custom',     Icon: CirclePlus,  color:'bg-secondary text-muted-foreground' },
};

// ── Country-specific special tags ─────────────────────────────────────────────
const COUNTRY_SPECIAL_TAGS = {
  'Japón': ['#templos', '#onsen', '#ramen', '#anime', '#sakura', '#naturaleza', '#museos', '#nightlife'],
  'Italia': ['#pizza', '#coliseo', '#arte', '#pasta', '#vino', '#museos', '#arquitectura', '#gelato'],
  'Francia': ['#croissant', '#louvre', '#baguette', '#vino', '#museos', '#moda', '#arte'],
  'Tailandia': ['#mango', '#templos', '#tukTuk', '#playa', '#naturaleza', '#streetfood', '#nightlife'],
  'México': ['#tacos', '#cenotes', '#mariachi', '#mezcal', '#arqueología', '#playa', '#mercados'],
  'Marruecos': ['#medina', '#hammam', '#té', '#zoco', '#desierto', '#arquitectura', '#especias'],
  'Turquía': ['#baño', '#bazar', '#kebab', '#mezquita', '#arqueología', '#mar', '#historia'],
  'Corea del Sur': ['#kpop', '#bbq', '#hanok', '#kimchi', '#palacio', '#skincare', '#streetfood'],
  'Vietnam': ['#pho', '#banh-mi', '#moto', '#bahia', '#arrozales', '#historia', '#streetfood'],
  'India': ['#curry', '#taj-mahal', '#rickshaw', '#yoga', '#templos', '#especias', '#mercados'],
  'España': ['#tapas', '#flamenco', '#catedral', '#playa', '#vino', '#museos', '#nightlife'],
  'Portugal': ['#pastelde-nata', '#fado', '#azulejos', '#surf', '#vino', '#historia'],
  'Grecia': ['#acropolis', '#islas', '#souvlaki', '#mar', '#historia', '#vino', '#arqueología'],
  'Alemania': ['#cerveza', '#castillos', '#mercadillos', '#museos', '#historia', '#selva-negra'],
  'Países Bajos': ['#bicicleta', '#tulipanes', '#museos', '#canales', '#queso', '#arte'],
  'Reino Unido': ['#pubs', '#museos', '#historia', '#teatros', '#highlands', '#castillos'],
  'Estados Unidos': ['#parques', '#jazz', '#hamburguesas', '#museos', '#naturaleza', '#roadtrip'],
  'Perú': ['#machupichu', '#ceviche', '#inca', '#naturaleza', '#titicaca', '#aventura'],
  'Argentina': ['#asado', '#tango', '#patagonia', '#vino', '#glaciares', '#fútbol'],
  'Colombia': ['#café', '#cartajena', '#naturaleza', '#salsa', '#flores', '#aventura'],
  'Chile': ['#atacama', '#patagonia', '#vino', '#mar', '#naturaleza', '#aventura'],
  'Brasil': ['#samba', '#playa', '#amazonia', '#carnaval', '#naturaleza', '#caipirinha'],
  'Indonesia': ['#bali', '#templos', '#surf', '#arrozales', '#naturaleza', '#buceo'],
  'Filipinas': ['#islas', '#mar', '#buceo', '#playa', '#naturaleza', '#streetfood'],
  'Singapur': ['#hawker', '#jardines', '#rascacielos', '#museos', '#streetfood', '#marina'],
  'Camboya': ['#angkorwat', '#templos', '#historia', '#naturaleza', '#streetfood'],
  'Nepal': ['#himalaya', '#trekking', '#budismo', '#naturaleza', '#aventura'],
  'Egipto': ['#piramides', '#faraonico', '#desierto', '#nilo', '#historia', '#arqueología'],
  'Sudáfrica': ['#safari', '#naturaleza', '#vinos', '#playas', '#aventura', '#wildlife'],
  'Kenia': ['#safari', '#masai-mara', '#wildlife', '#naturaleza', '#aventura'],
  'Australia': ['#koalas', '#surf', '#outback', '#barrera-coral', '#naturaleza', '#bbq'],
  'Nueva Zelanda': ['#hobbit', '#aventura', '#naturaleza', '#fiordos', '#senderismo'],
  'Canadá': ['#aurora', '#naturaleza', '#lagos', '#montañas', '#maple', '#cascadas'],
  'Cuba': ['#son', '#habana', '#coches-clásicos', '#mojito', '#historia', '#playa'],
  'Costa Rica': ['#naturaleza', '#surf', '#biodiversidad', '#aventura', '#volcanes'],
  'Islandia': ['#aurora', '#cascadas', '#glaciares', '#géiseres', '#naturaleza', '#yoga'],
  'Noruega': ['#fiordos', '#aurora', '#naturaleza', '#senderismo', '#vikingos'],
  'Suecia': ['#diseño', '#naturaleza', '#aurora', '#museos', '#midsommar'],
};

// ── Dynamic hashtags from existing spots ──────────────────────────────────────
function buildHashtags(spots, tripCities) {
  const typeTags = {
    food: '#comida',
    sight: '#museos',
    activity: '#aventura',
    shopping: '#compras',
    custom: '#especial',
  };
  const typeSet = new Set(spots.map(s => typeTags[s.type]).filter(Boolean));
  // Always add a few generic travel tags
  const genericTags = ['#naturaleza', '#nightlife', '#streetfood', '#vistas', '#barato'];
  const countryTags = [];
  const countries = [...new Set(tripCities.map(c => c.country).filter(Boolean))];
  countries.forEach(c => {
    const tags = COUNTRY_SPECIAL_TAGS[c] || [];
    tags.forEach(tag => countryTags.push(tag));
  });
  // Combine: type tags + country-specific + generic, deduplicated
  const all = [...typeSet, ...countryTags, ...genericTags];
  return [...new Set(all)].slice(0, 12);
}

// ── Recent searches (localStorage) ───────────────────────────────────────────
const RECENT_SEARCHES_KEY = 'kodo_recent_searches';
function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]'); } catch { return []; }
}
function addRecentSearch(query) {
  const searches = getRecentSearches().filter(s => s.query !== query);
  searches.unshift({ query, date: new Date().toISOString() });
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches.slice(0, 8)));
}
function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY);
}

// ── Leaflet map ───────────────────────────────────────────────────────────────
function LeafletMap({ lat, lng, onMove }) {
  const leafletRef = useRef(null);
  const markerRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    injectKodoMapStyles();
    loadLeaflet().then(L => {
      if (cancelled || !containerRef.current || leafletRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView([lat, lng], 15);
      L.tileLayer(KODO_TILE_URL, { subdomains: KODO_TILE_SUBDOMAINS, attribution: KODO_TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
      const icon = L.divIcon({
        html: '<div style="width:28px;height:28px;background:hsl(var(--primary));border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>',
        iconSize: [28, 28], iconAnchor: [14, 28], className: ''
      });
      const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
      marker.on('dragend', async e => {
        const { lat: la, lng: ln } = e.target.getLatLng();
        const addr = await reverseGeocode(la, ln);
        onMove(la, ln, addr);
      });
      map.on('click', async e => {
        const { lat: la, lng: ln } = e.latlng;
        marker.setLatLng([la, ln]);
        const addr = await reverseGeocode(la, ln);
        onMove(la, ln, addr);
      });
      leafletRef.current = map;
      markerRef.current = marker;
      setTimeout(() => map.invalidateSize(), 100);
    }).catch(() => {});
    return () => { cancelled = true; if (leafletRef.current) { leafletRef.current.remove(); leafletRef.current = null; } };
  }, []);

  useEffect(() => {
    if (markerRef.current && leafletRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      leafletRef.current.setView([lat, lng], 15);
    }
  }, [lat, lng]);

  return <div ref={containerRef} className="kodo-map-warm" style={{ height: '180px', width: '100%', borderRadius: '12px', overflow: 'hidden', zIndex: 0 }}/>;
}

// ── Create spot bottom sheet ──────────────────────────────────────────────────
function CreateSpotSheet({ open, onClose, onSave, saving, spots, city, country, initialLat, initialLng, initialType }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [type, setType] = useState(initialType || 'food');

  // Si se abre con un tipo forzado (p. ej. desde "+ Añadir hotel" en Home),
  // preseleccionarlo cada vez que se abre — sin esto, cerrar y reabrir el
  // sheet para otro spot se quedaba pegado en "hotel" del uso anterior.
  useEffect(() => {
    if (open) setType(initialType || 'food');
  }, [open, initialType]);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [pinLat, setPinLat] = useState(null);
  const [pinLng, setPinLng] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [duplicate, setDuplicate] = useState(null); // spot that matches

  // El campo de dirección era solo texto libre — no buscaba nada, así que
  // escribir "Atocha" ahí no hacía nada salvo guardar la palabra "Atocha"
  // como etiqueta, sin coordenadas. Ahora busca de verdad (mismo
  // searchPlaces que ya usa la tab "Buscar" de esta página) y, al elegir un
  // resultado, coloca el pin y revela el mapa — se puede seguir afinando
  // arrastrando después. suppressNextSearchRef evita que un cambio de
  // `address` que viene de reverseGeocode (arrastrar el pin / GPS) dispare
  // una búsqueda hacia adelante sobre el texto que él mismo acaba de poner.
  const [addressResults, setAddressResults] = useState([]);
  const [addressSearching, setAddressSearching] = useState(false);
  const addressTimer = useRef(null);
  const addressAbortRef = useRef(null);
  const suppressNextSearchRef = useRef(false);

  useEffect(() => {
    if (suppressNextSearchRef.current) { suppressNextSearchRef.current = false; setAddressResults([]); return; }
    if (!address.trim() || address.trim().length < 3) { setAddressResults([]); return; }
    clearTimeout(addressTimer.current);
    addressTimer.current = setTimeout(async () => {
      if (addressAbortRef.current) addressAbortRef.current.abort();
      addressAbortRef.current = new AbortController();
      setAddressSearching(true);
      try {
        setAddressResults(await searchPlaces(address.trim(), city, country, addressAbortRef.current.signal));
      } catch (e) {
        if (e?.name !== 'AbortError') setAddressResults([]);
      } finally {
        setAddressSearching(false);
      }
    }, 600);
    return () => clearTimeout(addressTimer.current);
     
  }, [address, city, country]);

  // Al venir de un tap en el mapa grande de Spots (SpotsMapView), llega ya con
  // coordenadas — se precarga el pin y se abre el mapa directamente en vez de
  // arrancar en el placeholder "toca para añadir ubicación".
  useEffect(() => {
    if (open && initialLat && initialLng) {
      setPinLat(initialLat);
      setPinLng(initialLng);
      setShowMap(true);
      reverseGeocode(initialLat, initialLng).then(addr => { if (addr) { suppressNextSearchRef.current = true; setAddress(addr); } });
    }
  }, [open, initialLat, initialLng]);

  // A: real-time duplicate check
  useEffect(() => {
    if (!title.trim() || title.length < 3) { setDuplicate(null); return; }
    const match = spots.find(s =>
      s.title?.toLowerCase().trim() === title.toLowerCase().trim() &&
      (s.city_name?.toLowerCase() === city?.toLowerCase() || !s.city_name)
    );
    setDuplicate(match || null);
  }, [title, spots, city]);

  const handleGPS = () => {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const la = pos.coords.latitude, ln = pos.coords.longitude;
        setPinLat(la); setPinLng(ln);
        const addr = await reverseGeocode(la, ln);
        if (addr) { suppressNextSearchRef.current = true; setAddress(addr); }
        setShowMap(true);
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const handleSave = () => {
    // B: block if exact duplicate
    if (duplicate) return;
    if (!title.trim()) return;
    // Un hotel es solo tuyo/de tu viaje — no tiene sentido publicarlo en Kaikōdo
    // Community, así que se guarda siempre trip_members, sin depender del
    // toggle (que ni siquiera se muestra para type === 'hotel').
    onSave({ title, type, notes, address, lat: pinLat, lng: pinLng, visibility: type === 'hotel' ? 'trip_members' : (isPublic ? 'public' : 'trip_members') });
    // reset
    setTitle(''); setType('food'); setNotes(''); setAddress('');
    setPinLat(null); setPinLng(null); setShowMap(false); setIsPublic(true);
  };

  if (!open) return null;

  const defaultLat = pinLat || 35.6762;
  const defaultLng = pinLng || 139.6503;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 pb-[80px]" onClick={onClose}>
      <div className="bg-card w-full max-w-lg rounded-t-3xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
        {/* Handle + header — fixed */}
        <div className="flex-shrink-0 px-5 pt-4 pb-4 border-b border-border">
          <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between">
            <p className="font-semibold text-foreground text-base">{t('spots.create.title')}</p>
            <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Location FIRST (map at top) */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('spots.create.location')}</p>
            {/* Map placeholder / real map */}
            <div className="rounded-xl overflow-hidden border border-border mb-2" style={{ height: '180px', background: 'var(--kodo-bg-subtle)', position: 'relative' }}>
              {showMap
                ? <LeafletMap lat={defaultLat} lng={defaultLng} onMove={(la, ln, addr) => { setPinLat(la); setPinLng(ln); if (addr) { suppressNextSearchRef.current = true; setAddress(addr); } }} />
                : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <MapPin className="w-8 h-8 text-muted-foreground/40" />
                    <p className="text-xs">{t('spots.create.tapToAddLocation')}</p>
                  </div>
                )
              }
            </div>
            <button aria-label={t('spots.create.useMyLocation')} onClick={() => { if (!pinLat) handleGPS(); setShowMap(true); }}
              className="w-full flex items-center justify-between px-4 py-2.5 border border-border rounded-2xl text-sm text-primary font-medium hover:bg-orange-50 transition-colors mb-2">
              <span className="flex items-center gap-2"><Navigation className="w-4 h-4"/>{locating ? t('spots.create.locating') : t('spots.create.useMyLocationFull')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <div className="relative">
              <Input value={address} onChange={e => { suppressNextSearchRef.current = false; setAddress(e.target.value); }}
                placeholder={t('spots.create.addressPlaceholder')} className="h-9 text-sm pr-8" />
              {addressSearching && (
                <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin absolute right-2.5 top-1/2 -translate-y-1/2" />
              )}
              {addressResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                  {addressResults.map(r => (
<button key={r.id} type="button" onClick={async () => {
    suppressNextSearchRef.current = true;
    let rLat = r.lat, rLng = r.lng, rName = r.name, rAddress = r.address;
    if (rLat == null && r._placeId) {
          const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
          const details = apiKey ? await fetchPlaceDetailsGoogle(r._placeId, apiKey) : null;
          if (details) { rLat = details.lat; rLng = details.lng; rAddress = details.address || rAddress; rName = details.name || rName; }
    }
    setAddress(rName + (rAddress ? ', ' + rAddress : ''));
    setPinLat(rLat); setPinLng(rLng);
    setShowMap(true);
    setAddressResults([]);
    setTitle(prev => prev.trim() ? prev : rName);
}}
                      className="w-full flex flex-col items-start px-3 py-2.5 text-left hover:bg-secondary/30 transition-colors border-b border-border last:border-0">
                      <span className="text-sm font-medium text-foreground truncate w-full">{r.name}</span>
                      {r.address && <span className="text-xs text-muted-foreground truncate w-full">{r.address}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Name + duplicate check */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('spots.create.name')}</p>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('spots.create.namePlaceholder')}
              className="h-10 text-sm"
              autoFocus
            />
            {duplicate && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2.5 flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-amber-800">{t('spots.create.duplicateExists', { city })}</p>
                  <p className="text-xs text-amber-700 mt-0.5">{t('spots.create.alreadyInListQuoted', { title: duplicate.title })}</p>
                </div>
              </div>
            )}
          </div>

          {/* Type */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('spots.create.type')}</p>
            <div className="flex flex-wrap gap-2">
              {/* airport/train/bus solo salen de la búsqueda (googleTypeToKodoType) —
                  no tiene sentido que el usuario elija manualmente "eres un
                  aeropuerto", igual que ya pasaba con 'transport'. */}
              {Object.entries(TYPE_CONFIG).filter(([k]) => !['transport', 'airport', 'train', 'bus'].includes(k)).map(([val, tc]) => (
                <button key={val} onClick={() => setType(val)}
                  className={`text-sm px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                    type === val ? 'bg-primary text-white border-primary' : 'bg-card text-muted-foreground border-border hover:border-primary/40'
                  }`}>
                  {tc.Icon && <tc.Icon size={13} />} {t(tc.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('spots.create.note')}</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('spots.create.notePlaceholder')}
              className="w-full text-sm border border-border rounded-xl px-3 py-2.5 h-20 resize-none outline-none focus:border-primary bg-secondary"
            />
          </div>

          {/* Visibility toggle — no aplica a hoteles: un hotel es solo para
              tu viaje, no algo que tenga sentido publicar en Kaikōdo Community. */}
          {type !== 'hotel' && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('spots.create.visibility')}</p>
              <div className="flex rounded-xl border border-border overflow-hidden">
                <button onClick={() => setIsPublic(true)}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${isPublic ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:bg-secondary/50'}`}>
                  Kaikōdo Community
                </button>
                <button onClick={() => setIsPublic(false)}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${!isPublic ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:bg-secondary/50'}`}>
                  {t('spots.create.tripOnly')}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 px-1">
                {isPublic ? t('spots.create.publicHint') : t('spots.create.privateHint')}
              </p>
            </div>
          )}
        </div>

        {/* Sticky footer buttons */}
        <div className="flex-shrink-0 flex gap-3 px-5 py-4 border-t border-border bg-card">
          <Button variant="outline" onClick={onClose} className="flex-1">{t('common.cancel')}</Button>
          <Button
            onClick={handleSave}
            disabled={!title.trim() || saving || !!duplicate}
            className="flex-1 bg-primary hover:bg-primary/90 text-white">
            {saving ? t('spots.saving') : t('spots.create.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── OSM result card ───────────────────────────────────────────────────────────
function PlaceResultCard({ place, onSave, saving, isDuplicate }) {
  const { t } = useTranslation();
  const tc = TYPE_CONFIG[place.type] || TYPE_CONFIG.custom;
  return (
    <div className={`bg-card rounded-2xl border flex overflow-hidden transition-all ${isDuplicate ? 'border-amber-200 opacity-60' : 'border-border hover:shadow-sm'}`}>
      <div className="w-12 bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center flex-shrink-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tc.color}`}>{tc.Icon && <tc.Icon size={16} />}</div>
      </div>
      <div className="flex-1 min-w-0 p-3">
        <p className="font-semibold text-sm text-foreground leading-tight">{place.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t(tc.labelKey)}{place.address ? ' · ' + place.address : ''}</p>
        {isDuplicate ? (
          <p className="text-xs text-amber-600 mt-1.5 font-medium">{t('spots.inYourList')}</p>
        ) : (
          <Button size="sm" onClick={() => onSave(place)} disabled={saving}
            className="mt-2 h-7 text-xs bg-primary hover:bg-primary/90 text-white px-3">
            <Plus className="w-3 h-3 mr-1"/>{saving ? t('spots.saving') : t('spots.addShort')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Assign date modal (shown after saving a spot) ─────────────────────────────
function AssignDateModal({ spot, tripCities = [], onAssign, onSkip, onUndo }) {
  const { t } = useTranslation();
  const [selectedDate, setSelectedDate] = useState('');
  // Ciudad explícitamente elegida en el <select> — ver comentario junto al
  // botón "Confirmar" sobre por qué re-derivar la ciudad solo a partir de la
  // fecha es ambiguo en un día de tránsito entre dos ciudades distintas.
  const [selectedCityId, setSelectedCityId] = useState(null);
  // El botón de confirmar no se deshabilitaba mientras onAssign (async)
  // seguía en curso — un doble tap (fácil en móvil) lo disparaba dos veces,
  // y como reordena + muestra un toast de "orden sugerido", salían dos
  // toasts idénticos apilados.
  const [submitting, setSubmitting] = useState(false);
    // Hora opcional en el mismo paso que el día — antes solo se podía
    // asignar día aquí y la hora aparte, más tarde, desde el detalle del spot.
    const [selectedTime, setSelectedTime] = useState('');

  // Si el viaje visita la misma ciudad más de una vez (varios registros City
  // con el mismo nombre, p. ej. Lima 3 veces en fechas distintas), agrupar
  // por NOMBRE en vez de por el city_id exacto de la estancia en la que se
  // creó el spot — si no, solo se podían elegir los días de la primera
  // visita. Al confirmar (ver isAllowed/onAssign más abajo) se re-ancla el
  // spot a la estancia que de verdad contiene la fecha elegida, para que no
  // desaparezca de las vistas de itinerario (que exigen que assigned_date Y
  // city_id coincidan).
  const dayOptions = useMemo(() => {
    const allDays = getTripDays(tripCities);
    const spotCityName = spot?.city_name || tripCities.find(c => c.id === spot?.city_id)?.name;
    if (!spotCityName) {
      if (!spot?.city_id) return allDays;
      const own = allDays.filter(d => d.cityId === spot.city_id);
      return own.length > 0 ? own : allDays;
    }
    const sameCity = allDays.filter(d => sameCityName(d.city, spotCityName));
    return sameCity.length > 0 ? sameCity : allDays;
  }, [tripCities, spot?.city_id, spot?.city_name]);

  const tripDates = useMemo(() => new Set(dayOptions.map(d => d.date)), [dayOptions]);

  const minDate = tripCities.map(c => c.start_date).filter(Boolean).sort()[0] || '';
  const maxDate = tripCities.map(c => c.end_date).filter(Boolean).sort().reverse()[0] || '';
  const isAllowed = (date) => tripDates.size === 0 || tripDates.has(date);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 pb-[80px]">
      <div className="bg-card w-full max-w-md rounded-t-3xl flex flex-col relative" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
        <div className="p-5">
          <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />

          {/* Close button */}
          <button aria-label={t('common.close')}
            onClick={onSkip}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Saved confirmation */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
              <Check className="w-5 h-5 text-green-600" strokeWidth={2.5} />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">{t('spots.assign.saved')}</p>
              <p className="text-xs text-muted-foreground truncate max-w-[220px]">{spot.title}</p>
            </div>
          </div>

          {/* Date picker — trip days only */}
          <p className="text-sm font-semibold text-foreground mb-2">{t('spots.assign.whenVisit')}</p>
          {tripDates.size > 0 ? (
            <select
              // value combina fecha+ciudad (tripDayOptionValue) — con solo
              // la fecha, un día de tránsito entre dos ciudades (misma
              // fecha, dos City) no se puede distinguir cuál se eligió.
              value={selectedDate ? tripDayOptionValue({ date: selectedDate, cityId: selectedCityId }) : ''}
              onChange={e => {
                const { date, cityId } = parseTripDayOptionValue(e.target.value);
                setSelectedDate(date);
                setSelectedCityId(cityId);
              }}
              className="w-full h-11 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary"
            >
              <option value="">{t('spots.assign.unassigned')}</option>
              {dayOptions.map(d => (
                <option key={tripDayOptionValue(d)} value={tripDayOptionValue(d)}>{d.date} · {d.city}</option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              value={selectedDate}
              min={minDate}
              max={maxDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full h-11 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary"
            />
          )}
          {/* Hora opcional en el mismo paso que el día */}
                    <p className="text-sm font-semibold text-foreground mt-4 mb-2">{t('spots.assignTime')}</p>
          <input
            type="time"
            value={selectedTime}
            onChange={e => setSelectedTime(e.target.value)}
            className="w-full h-11 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary"
          />
        </div>

        {/* Buttons — always visible */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onUndo}
            className="flex-1 py-3 border border-border rounded-2xl text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
          >
            {t('spots.undo')}
          </button>
          <button
            onClick={async () => {
              if (submitting) return;
              if (selectedDate && isAllowed(selectedDate)) {
                setSubmitting(true);
                // selectedCityId es la ciudad que el usuario eligió
                // EXPLÍCITAMENTE en el <select> de arriba — no se
                // re-deriva de la fecha (resolveCityIdForDate), que en un
                // día de tránsito entre dos ciudades podía devolver la
                // ciudad equivocada aunque el usuario hubiera elegido
                // explícitamente la otra.
                try { await onAssign(selectedDate, selectedCityId, selectedTime); }
                finally { setSubmitting(false); }
              } else {
                onSkip();
              }
            }}
            disabled={submitting}
            className={`flex-1 py-3 bg-primary text-white rounded-full text-sm font-semibold transition-colors ${submitting ? 'opacity-60 pointer-events-none' : ''}`}
          >
            {submitting ? t('common.loading') : (selectedDate && isAllowed(selectedDate) ? t('spots.assign.confirm') : t('spots.assign.notNow'))}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ spot, city, onUndo, visible }) {
  const { t } = useTranslation();
  if (!visible || !spot) return null;
  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 max-w-sm mx-auto">
      <div className="bg-foreground rounded-xl px-4 py-3 flex items-center gap-3">
        <CheckCircle2 className="w-5 h-5 text-green-500" />
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{city ? t('spots.toast.savedIn', { city }) : t('spots.toast.saved')}</p>
          <p className="text-white/60 text-xs truncate">{spot.title}</p>
        </div>
        <button onClick={onUndo} className="text-amber-400 text-xs font-medium flex-shrink-0">{t('spots.undo')}</button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Restaurants() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const tripId = urlParams.get('trip_id');
  const importSavedParam = urlParams.get('import_saved') === '1';
  // Enlace desde el mini-mapa de Home ("+ Añadir hotel") cuando el día no
  // tiene ninguno guardado — mismo patrón que import_saved de arriba.
  const openCreateParam = urlParams.get('open_create');
  const cityIdFromParam = urlParams.get('city_id');

  useEffect(() => {
    if (!tripId || tripId === 'null') {
      navigate(createPageUrl('TripsList'), { replace: true });
    }
  }, [tripId, navigate]);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { trip, activeCity } = useTripContext(tripId);
  const { user: currentUser } = useAuth();
  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles_rest', tripId],
    queryFn: async () => {
      const members = trip?.members || [];
      if (!members.length) return [];
      // members ya está normalizado; p.email/p.user_email deberían estarlo
      // también, pero un .includes() en crudo dependía de que ambos lados
      // coincidieran exactamente — normalizar por seguridad evita que un
      // perfil legacy con distinto casing se quede sin avatar/nombre aquí.
      const membersNorm = members.map(normalizeEmail);
      // UserProfile.read se cerró en el rls (exponía email/nationality de
      // todo el mundo) — antes esto traía TODOS los perfiles de la app para
      // filtrar por miembros en el cliente; ahora se pide directo por los
      // emails ya conocidos (trip.members), que además es más preciso y más
      // rápido — ver src/lib/userProfiles.js.
      return searchUserProfiles({ emails: membersNorm });
    },
    enabled: !!trip?.members?.length,
    staleTime: 60000,
  });

  const notifyMembers = (type, _unused, refTitle, refExtra) => {
    // Mismo bug que ya se arregló en Expenses.jsx: trip.members está
    // normalizado en minúsculas pero currentUser?.email no — sin normalizar
    // aquí, el propio autor de la acción podía acabar recibiendo su propia
    // notificación (o excluirse mal a sí mismo) si el email de auth traía
    // mayúsculas distintas.
    const others = (trip?.members || []).filter(e => normalizeEmail(e) !== normalizeEmail(currentUser?.email));
    if (!others.length) return;
    resolveUserIds(others).then(resolved => {
      resolved.forEach(({ userId }) => notify({
        userId, type, actor: myProfile, tripId, tripName: trip?.name, refId: refExtra?.spotId, refTitle, refExtra,
      }));
    });
  };
  const city = activeCity?.name || trip?.destination || '';
  const country = activeCity?.country || trip?.country || '';
  const cityId = activeCity?.id || null;

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const [tab, setTab] = useState('buscar'); // 'buscar' | 'mis'
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState(() => getRecentSearches());
  const [osmResults, setOsmResults] = useState([]);
  const [enriched, setEnriched] = useState({}); // placeId -> {rating, userRatingCount, photoUrl}
  const enrichedIdsRef = useRef(new Set());
  const enrichObserverRef = useRef(null);
 const [searching, setSearching] = useState(false);
  const [nearbyFilter, setNearbyFilter] = useState([]);  // empty = all
  const [showCreate, setShowCreate] = useState(false);
  const [pinPrefill, setPinPrefill] = useState(null); // {lat,lng} — al tocar el mapa de Mis spots
  const [mySpotsView, setMySpotsView] = useState('lista'); // 'lista' | 'mapa'
  const [savingId, setSavingId] = useState(null);
  const [stateFilter, setStateFilter] = useState('all');
  const [assignDateSpot, setAssignDateSpot] = useState(null); // spot to assign date after saving
  const [selectedCity, setSelectedCity] = useState('');
  // Los chips de "Lima", "Oxapampa"... antes solo guardaban el NOMBRE elegido
  // (selectedCity). Si el viaje repite ciudad (varias paradas con el mismo
  // nombre), eso rompía dos cosas: (a) el chip "seleccionado" se comparaba por
  // nombre, así que las DOS paradas "Lima" se pintaban resaltadas a la vez al
  // tocar cualquiera de ellas; y (b) los spots que se guardaban (buscados o
  // creados a mano) nunca usaban el id de la parada que el chip representaba
  // — se etiquetaban con `cityId` (la ciudad "activa hoy" según la fecha,
  // fija) sin importar qué chip de Lima se hubiera tocado. selectedCityId
  // guarda el id exacto de la parada elegida para que ambas cosas apunten a
  // la parada correcta.
  const [selectedCityId, setSelectedCityId] = useState(null);
  const effectiveCityId = selectedCityId || cityId;
  const effectiveCityName = selectedCity || city;
  // Renombrado de `toast` a `savedToast`: el nombre `toast` tapaba la función
  // useToast() de más abajo — los onError de las mutaciones de Spot llamaban
  // a este estado como si fuera función y crasheaban con "toast is not a
  // function" en cada fallo de crear/editar/borrar un spot.
  const { toast } = useToast();
  const [savedToast, setSavedToast] = useState({ visible: false, spot: null });
  const [lastSavedId, setLastSavedId] = useState(null);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [mySpotSearch, setMySpotSearch] = useState('');
  const [showCityInput, setShowCityInput] = useState(false);
  const [customCity, setCustomCity] = useState('');
  const searchTimer = useRef(null);
  const searchAbortRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    if (activeCity?.name && !selectedCity) { setSelectedCity(activeCity.name); setSelectedCityId(activeCity.id || null); }
  }, [activeCity?.name, activeCity?.id]);

  // Queries
  const { data: spots = [], isLoading: loadingSpots } = useQuery({
    queryKey: ['spots', tripId],
    queryFn: () => base44.entities.Spot.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 30000,
  });

  const { data: myProfile } = useQuery({
    queryKey: ['myProfile', user?.id],
    queryFn: async () => { const r = await base44.entities.UserProfile.filter({ user_id: user.id }); return r[0]||null; },
    enabled: !!user?.id, staleTime: 60000,
  });

  const { data: publicSpots = [] } = useQuery({
    queryKey: ['publicSpots'],
    queryFn: () => base44.entities.Spot.filter({ visibility: 'public' }),
    staleTime: 5*60*1000,
  });

  const { data: tripCities = [] } = useQuery({
    queryKey: ['cities', tripId],
    queryFn: () => base44.entities.City.filter({ trip_id: tripId }, 'order'), // misma queryKey ['cities', tripId] que otras pantallas — unificado para no compartir caché con fetches distintos
    enabled: !!tripId, staleTime: 60000,
  });

  // Wishlist personal del usuario — para el panel de importación
  const { data: userSavedSpots = [] } = useQuery({
    queryKey: ['savedSpots', user?.id],
    queryFn: () => base44.entities.SavedSpot.filter({ user_id: user.id }),
    enabled: !!user?.id,
    staleTime: 60000,
  });

  // Spots de la wishlist que coinciden con el país/destino de este viaje
  const importableSpots = useMemo(() => {
    if (!userSavedSpots.length) return [];
    const tripCountry = normalizeCountry(country || trip?.country || '');
    if (!tripCountry) return [];
    return userSavedSpots.filter(s => normalizeCountry(s.country || '') === tripCountry);
  }, [userSavedSpots, country, trip?.country]);

  // Agrupa los spots importables por la ciudad del VIAJE a la que
  // corresponden (comparando nombre normalizado), no por la ciudad
  // "activa" del momento. Antes, importar un spot guardado de p.ej. Cusco
  // en un viaje Lima+Cusco lo colgaba siempre bajo la ciudad activa (Lima si
  // el viaje aún no había empezado) sin importar de qué ciudad era — el
  // filtro de arriba solo comprueba el país. Los que no coinciden con
  // ninguna ciudad del viaje (guardados de otra ciudad del mismo país que no
  // está en este itinerario) se agrupan aparte y cuelgan de la ciudad activa
  // como ya hacía antes, en vez de quedar sin ciudad — un Spot sin city_id
  // no está probado en el resto de la app (Ruta, día a día, etc).
  const normCityName = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const importGroups = useMemo(() => {
    const groups = tripCities.map(c => ({ city: c, spots: [] }));
    const other = [];
    importableSpots.forEach(s => {
      const match = tripCities.find(c => normCityName(c.name) === normCityName(s.city_name));
      if (match) groups.find(g => g.city.id === match.id).spots.push(s);
      else other.push(s);
    });
    const nonEmpty = groups.filter(g => g.spots.length > 0);
    if (other.length) nonEmpty.push({ city: null, spots: other });
    return nonEmpty;
  }, [importableSpots, tripCities]);

  // Activar panel de importación si viene desde el popup de creación de viaje
  useEffect(() => {
    if (importSavedParam && importableSpots.length > 0) {
      setShowImportPanel(true);
      setTab('mis');
    }
  }, [importSavedParam, importableSpots.length]);

  // Abrir directo el formulario de crear spot con type "hotel" — enlace desde
  // "+ Añadir hotel" en el mini-mapa de Home cuando ese día aún no tiene uno.
  useEffect(() => {
    if (openCreateParam === 'hotel') {
      if (cityIdFromParam) setSelectedCityId(cityIdFromParam);
      setTab('mis');
      setShowCreate(true);
    }
     
  }, [openCreateParam, cityIdFromParam]);

  // Mutations
  // Si `trip` no había cargado (conexión lenta/intermitente), antes se
  // guardaba con trip_members:[] y el spot quedaba invisible para siempre,
  // ni para quien lo creó. Se corta antes de guardar algo roto.
  const createMutation = useMutation({
    mutationFn: d => {
      if (!trip?.members?.length) throw new Error(t('cities.tripNotLoadedRetry'));
      return base44.entities.Spot.create({ ...d, trip_members: trip.members });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spots', tripId] }),

    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Spot.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spots', tripId] }),
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });
  const deleteMutation = useMutation({
    mutationFn: id => base44.entities.Spot.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spots', tripId] }),
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  // OSM search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) { setOsmResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      searchAbortRef.current = new AbortController();
      const signal = searchAbortRef.current.signal;
      setSearching(true);
      addRecentSearch(searchQuery.trim());
      setRecentSearches(getRecentSearches());
      try { setOsmResults(await searchPlaces(searchQuery, selectedCity || city, country, signal)); }
      catch (e) { if (e?.name !== 'AbortError') setOsmResults([]); }
      finally { setSearching(false); }
    }, 700);
    return () => clearTimeout(searchTimer.current);
  }, [searchQuery, selectedCity, city, country]);

    const enrichPlace = async (place) => {
      if (!place?._placeId || enrichedIdsRef.current.has(place.id)) return;
      enrichedIdsRef.current.add(place.id);
      const apiKey = await getGoogleMapsApiKey();
      if (!apiKey) return;
      const details = await fetchPlaceDetailsGoogle(place._placeId, apiKey);
      if (details) setEnriched(prev => ({ ...prev, [place.id]: details }));
    };

    const observeCard = (node, place) => {
      if (!node || !place?._placeId || enrichedIdsRef.current.has(place.id)) return;
      if (!enrichObserverRef.current) {
        enrichObserverRef.current = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting && entry.target._kdPlace) {
              enrichPlace(entry.target._kdPlace);
              enrichObserverRef.current.unobserve(entry.target);
            }
          });
        }, { rootMargin: '200px' });
      }
      node._kdPlace = place;
      enrichObserverRef.current.observe(node);
    };

    useEffect(() => {
      enrichedIdsRef.current = new Set();
      setEnriched({});
      osmResults.slice(0, 5).forEach(enrichPlace);
    }, [osmResults]);

  
  const baseData = extra => ({
    trip_id: tripId || undefined, city_id: effectiveCityId||undefined, city_name: effectiveCityName, country: normalizeCountry(country),
    visibility: 'trip_members', visited: false,
    created_by: user?.email, created_by_user_id: user?.id,
    creator_username: myProfile?.username||'',
    ...extra,
  });

  const showToastFor = (spot, cityName) => {
    setSavedToast({ visible: true, spot, city: cityName || city });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setSavedToast({ visible: false, spot: null }), 3000);
  };

  const saveOsmPlace = async place => {
    if (!tripId) return;
    const dup = spots.find(s => s.title?.toLowerCase().trim() === place.name?.toLowerCase().trim());
    if (dup) { showToastFor({ title: t('spots.create.alreadyInListQuoted', { title: place.name }) }, city); return; }
    setSavingId(place.id);
    try {
        let resolved = place;
        if (place.lat == null && place._placeId) {
        const cached = enriched[place.id];
              const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
                const details = cached || (apiKey ? await fetchPlaceDetailsGoogle(place._placeId, apiKey) : null);
          if (details) resolved = { ...place, lat: details.lat, lng: details.lng, address: details.address || place.address, type: details.type || place.type, name: details.name || place.name };
      }
        const created = await createMutation.mutateAsync({
                trip_id: tripId || undefined, city_id: effectiveCityId||undefined,
          city_name: effectiveCityName, country: normalizeCountry(country),
          title: resolved.name, type: resolved.type || 'sight',
          address: resolved.address || '', lat: resolved.lat, lng: resolved.lng,
          osm_id: resolved.id || null, source: 'osm',
          visibility: 'trip_members', visited: false,
          created_by: null, created_by_user_id: null,
          saved_by: [user?.email].filter(Boolean),
      });
      setLastSavedId(created?.id);
            setOsmResults([]); setSearchQuery(''); setNearbyFilter([]);
      showToastFor({ title: place.name }, city);
      if (created?.id) setAssignDateSpot(created);
      notifyMembers('spot_added', '', place.name, { spotId: created?.id, spotDate: created?.assigned_date });
    } catch(e) {
      console.error('Error al guardar spot:', e);
    } finally { setSavingId(null); }
  };

  const saveManualSpot = async form => {
    if (!tripId) return;
    setSavingId('manual');
    try {
      const created = await createMutation.mutateAsync(baseData({
        title: form.title, type: form.type, notes: form.notes,
        address: form.address, lat: form.lat, lng: form.lng,
        visibility: form.visibility, source: 'manual',
      }));
      setLastSavedId(created?.id);
      setShowCreate(false);
      setPinPrefill(null);
      showToastFor({ title: form.title }, city);
      if (created?.id) setAssignDateSpot(created);
      notifyMembers('spot_added', '', form.title, { spotId: created?.id, spotDate: created?.assigned_date });
    } finally { setSavingId(null); }
  };

  // Importar un spot de la wishlist personal al viaje actual.
  // targetCity: la ciudad del VIAJE a la que corresponde este spot guardado
  // (resuelta en importGroups comparando nombres) — si no hay ninguna ciudad
  // del viaje que coincida (guardado de una ciudad que no está en este
  // itinerario), cae a la ciudad activa como hacía siempre antes.
  const importSavedSpot = async (savedSpot, targetCity) => {
    const dup = spots.find(s => s.title?.toLowerCase().trim() === savedSpot.title?.toLowerCase().trim());
    if (dup) return;
    setSavingId('import_' + savedSpot.id);
    try {
      const created = await createMutation.mutateAsync({
        trip_id: tripId, city_id: targetCity?.id || effectiveCityId || undefined,
        city_name: targetCity?.name || effectiveCityName, country: normalizeCountry(country),
        title: savedSpot.title, type: savedSpot.type || 'custom',
        address: savedSpot.address || '', lat: savedSpot.lat, lng: savedSpot.lng,
        notes: savedSpot.notes || '', image_url: savedSpot.image_url || null,
        visibility: 'trip_members', visited: false,
        created_by: user?.email, created_by_user_id: user?.id,
        source: 'saved_import',
      });
      setLastSavedId(created?.id);
      showToastFor({ title: savedSpot.title }, targetCity?.name || city);
    } finally {
      setSavingId(null);
    }
  };

  // Importar todos los spots pendientes de un grupo (ciudad) de una vez —
  // secuencial para no disparar N mutaciones concurrentes ni pisar el
  // indicador savingId de cada botón individual.
  const [importingGroup, setImportingGroup] = useState(null);
  const importGroup = async (group) => {
    const targetCity = group.city;
    const pending = group.spots.filter(s => !spots.some(sp => sp.title?.toLowerCase().trim() === s.title?.toLowerCase().trim()));
    if (!pending.length) return;
    setImportingGroup(targetCity?.id || 'other');
    try {
      for (const savedSpot of pending) {
        await importSavedSpot(savedSpot, targetCity);
      }
    } finally {
      setImportingGroup(null);
    }
  };

  const saveCommunitySpot = async spot => {
    if (!tripId) return;
    const dup = spots.find(s => s.title?.toLowerCase().trim() === spot.title?.toLowerCase().trim());
    if (dup) return;
    const savingKey = spot.id || spot.title;
    setSavingId(savingKey);
    try {
      // Save community spot WITHOUT overriding created_by — preserve original author
      const created = await createMutation.mutateAsync({
        trip_id: tripId || undefined, city_id: effectiveCityId || undefined,
        city_name: effectiveCityName, country: normalizeCountry(country),
        title: spot.title, type: spot.type, address: spot.address || '',
        lat: spot.lat, lng: spot.lng, notes: spot.notes || '',
        visibility: 'trip_members', visited: false,
        // Keep original authorship — this spot was created by someone else
        created_by: spot.created_by || null,
        created_by_user_id: spot.created_by_user_id || user?.id,
        creator_username: spot.creator_username || myProfile?.username || '',
        // Tag as saved (not created) by current user
        saved_by: [user?.email].filter(Boolean),
      });
      setLastSavedId(created?.id);
      showToastFor({ title: spot.title }, selectedCity || city);
      if (created?.id) setAssignDateSpot(created);
    } finally { setSavingId(null); }
  };

  const undoSave = async () => {
    if (lastSavedId) {
      await deleteMutation.mutateAsync(lastSavedId);
      // El modal de "¿cuándo?" puede seguir abierto para este mismo spot recién
      // creado — si no lo cerramos aquí, al confirmar una fecha ahí se intenta
      // actualizar un spot que este Deshacer ya borró ("Entity Spot ... not found").
      setAssignDateSpot(prev => (prev?.id === lastSavedId ? null : prev));
      setLastSavedId(null);
    }
    setSavedToast({ visible: false, spot: null });
  };

  // Seed spots. spotsDB son ~112 KB de datos que solo hacen falta en esta pantalla;
  // se cargan bajo demanda para no lastrar el arranque (pages.config.js importa
  // todas las páginas de forma estática, así que un import normal iría al bundle inicial).
  const [seedSpots, setSeedSpots] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!country || !city) { setSeedSpots([]); return; }
    import('@/lib/spotsDB')
      .then(({ getSeedSpotsForCity }) => {
        if (!cancelled) setSeedSpots(getSeedSpotsForCity(country, selectedCity || city) || []);
      })
      .catch(() => { if (!cancelled) setSeedSpots([]); });
    return () => { cancelled = true; };
  }, [country, selectedCity, city]);

  // Seed spots that match the search query (shown alongside OSM results)
  const seedSearchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase().replace('#', '');
    return seedSpots.filter(s => {
      const inTitle = s.title?.toLowerCase().includes(q);
      const inNotes = s.notes?.toLowerCase().includes(q);
      const inTags = s.tags?.some(tag => tag.toLowerCase().includes(q));
      return inTitle || inNotes || inTags;
    }).slice(0, 6);
  }, [searchQuery, seedSpots]);

    // Spots publicos de la comunidad que coinciden con la busqueda — se muestran junto a Google para no duplicar spots que otro usuario ya marco como visibles para todos.
    const communitySpotResults = useMemo(() => {
      if (!searchQuery.trim() || searchQuery.length < 2) return [];
      const q = searchQuery.toLowerCase();
      const cityQ = normCityName(selectedCity || city);
      return publicSpots.filter(s => {
        if (spots.some(sp => sp.title?.toLowerCase().trim() === s.title?.toLowerCase().trim())) return false;
        const matchesQuery = s.title?.toLowerCase().includes(q) || s.notes?.toLowerCase().includes(q) || s.tags?.some(tag => tag.toLowerCase().includes(q));
        if (!matchesQuery) return false;
        if (!cityQ) return true;
        return normCityName(s.city_name) === cityQ;
      }).slice(0, 8);
    }, [searchQuery, publicSpots, spots, selectedCity, city]);

  // Hashtags
  const hashtags = useMemo(() => buildHashtags(spots, tripCities), [spots, tripCities]);

  // Filtered spots (by state + local search)
  const myCreatedSpots = useMemo(() =>
    spots.filter(s => s.created_by === user?.email || s.created_by_user_id === user?.id),
    [spots, user]
  );
  const mySavedSpots = useMemo(() =>
    spots.filter(s => Array.isArray(s.saved_by) && s.saved_by.includes(user?.email) && s.created_by !== user?.email),
    [spots, user]
  );

  const filteredSpots = useMemo(() => {
    let result = spots.filter(s => {
      if (stateFilter === 'assigned') return !!s.assigned_date;
      if (stateFilter === 'unassigned') return !s.assigned_date;
      if (stateFilter === 'created') return s.created_by === user?.email || s.created_by_user_id === user?.id;
      if (stateFilter === 'saved') return Array.isArray(s.saved_by) && s.saved_by.includes(user?.email) && s.created_by !== user?.email;
      return true;
    });
    if (mySpotSearch.trim().length >= 1) {
      const q = mySpotSearch.toLowerCase();
      result = result.filter(s =>
        s.title?.toLowerCase().includes(q) ||
        s.notes?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q) ||
        s.city_name?.toLowerCase().includes(q)
      );
    }
    if (nearbyFilter.length > 0) {
      const TYPE_MAP = {
        food:      ['food'],
        cultural:  ['sight'],
        interest:  ['activity', 'custom'],
        shop:      ['hotel', 'transport', 'shopping'],
        nightlife: ['nightlife', 'bar'],
      };
      const allowed = new Set(nearbyFilter.flatMap(k => TYPE_MAP[k] || []));
      result = result.filter(s => allowed.has(s.type));
    }
    return result;
  }, [spots, stateFilter, mySpotSearch, nearbyFilter]);

  const isSearchActive = searchQuery.length >= 2;

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="bg-background sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 pt-12 pb-0">
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('Home') + '?trip_id=' + tripId}>
              <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                {t('spots.backHome')}
              </button>
            </Link>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 text-primary text-sm font-medium hover:text-primary/80 transition-colors">
              <Plus className="w-4 h-4" />{t('spots.create.title')}
            </button>
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-1">{t('spots.title')}</h1>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{t('spots.intro')}</p>
          <OTabBar
            tabs={[{key:'buscar',label:t('spots.tabSearch')},{key:'mis',label:t('spots.mySpots')}]}
            activeKey={tab}
            onChange={setTab}
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-5 py-5 pb-24">

        {/* ── BUSCAR TAB ── */}
        {tab === 'buscar' && (
          <div className="space-y-4">

            {/* Search */}
            <div className="flex items-center gap-2">
              <div className={`flex-1 flex items-center gap-2 bg-card border rounded-2xl px-3 py-2.5 transition-colors ${searchQuery ? 'border-primary' : 'border-border'}`}>
                <Search className={`w-4 h-4 flex-shrink-0 ${searchQuery ? 'text-primary' : 'text-muted-foreground'}`} />
                <input
                  value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t('spots.search')}
                  className="flex-1 text-sm outline-none bg-transparent text-foreground min-w-0"
                />
                {searchQuery && (
                                <button aria-label={t('spots.clearSearch')} onClick={() => { setSearchQuery(''); setOsmResults([]); }} className="text-muted-foreground flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Chips de ciudad — solo si hay más de una */}
            {!searchQuery && tripCities.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {tripCities.map(c => (
                  <button key={c.id} onClick={() => {
                      const isSame = selectedCityId === c.id;
                      setSelectedCity(isSame ? '' : c.name);
                      setSelectedCityId(isSame ? null : c.id);
                    }}
                    className={`text-sm px-4 py-1.5 rounded-full border font-medium transition-colors flex-shrink-0 ${
                      selectedCityId === c.id
                        ? 'bg-primary text-white border-primary'
                        : 'bg-card border-border text-foreground hover:border-primary/40'
                    }`}>
                    {c.name}
                  </button>
                ))}
                {!showCityInput ? (
                  <button onClick={() => setShowCityInput(true)}
                    className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-full border border-dashed border-primary/40 text-primary bg-accent font-medium">
                    <Plus className="w-3.5 h-3.5" />{t('spots.cityShort')}
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={customCity}
                      onChange={e => setCustomCity(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && customCity.trim()) { setSelectedCity(customCity.trim()); setSelectedCityId(null); setShowCityInput(false); setCustomCity(''); }
                        if (e.key === 'Escape') { setShowCityInput(false); setCustomCity(''); }
                      }}
                      placeholder={t('spots.cityPlaceholder')}
                      className="text-sm px-3 py-1.5 rounded-full border border-primary outline-none bg-card text-foreground w-28"
                    />
                    <button aria-label={t('common.cancel')} onClick={() => { setShowCityInput(false); setCustomCity(''); }} className="text-muted-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Chips de categoría */}
            {!searchQuery && (
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'food',      Icon: Utensils,    label: t('spots.cat.food') },
                  { key: 'cultural',  Icon: Landmark,    label: t('spots.cat.cultural') },
                  { key: 'interest',  Icon: Ticket,      label: t('spots.cat.interest') },
                  { key: 'shop',      Icon: ShoppingBag, label: t('spots.cat.shopping') },
                  { key: 'nightlife', Icon: Moon,        label: t('spots.cat.nightlife') },
                ].map(({ key: k, Icon, label }) => (
                  <button key={k} type="button"
                    onClick={() => {
                      const next = nearbyFilter.includes(k) ? nearbyFilter.filter(x => x !== k) : [...nearbyFilter, k];
                      setNearbyFilter(next);
                    }}
                    className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition-colors ${
                      nearbyFilter.includes(k)
                        ? 'bg-primary text-white border-primary'
                        : 'bg-card text-muted-foreground border-border hover:border-primary/40'
                    }`}>
                    <Icon size={13} />{label}
                  </button>
                ))}
              </div>
            )}

            {/* Estado vacío */}
            {!searchQuery && osmResults.length === 0 && !searching && (
              <div className="text-center py-12">
                <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-3">
                  <Compass className="w-6 h-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">{t('spots.emptySearchLine1')}<br />{t('spots.emptySearchLine2')}</p>
              </div>
            )}

            {/* Resultados con búsqueda */}
            {searchQuery.length >= 2 && (
              <div className="space-y-4">

                {/* Tus spots que coinciden — primero */}
                {(() => {
                  const q = searchQuery.toLowerCase();
                  const matched = spots.filter(s =>
                    s.title?.toLowerCase().includes(q) ||
                    s.notes?.toLowerCase().includes(q) ||
                    s.address?.toLowerCase().includes(q)
                  );
                  if (!matched.length) return null;
                  return (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t('spots.yourSpots')}</p>
                      <div className="space-y-2">
                        {matched.map(spot => (
                          <button key={spot.id} onClick={() => setSelectedSpot(spot)}
                            className="w-full flex items-center gap-3 bg-card border border-border rounded-2xl p-3 text-left hover:border-primary/40 transition-colors">
                            <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
                              {(() => { const I = {food:Utensils,sight:Landmark,activity:Ticket,shopping:ShoppingBag,nightlife:Moon,bar:Moon}[spot.type] || Compass; return <I size={16} className="text-primary" />; })()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">{spot.title}</p>
                              <p className="text-xs text-muted-foreground truncate">{spot.city_name || city}</p>
                            </div>
                            <span className={`text-xs font-semibold px-2 py-1 rounded-lg flex-shrink-0 ${spot.assigned_date ? 'bg-orange-100 text-primary' : 'bg-green-50 text-green-700'}`}>
                              {spot.assigned_date ? t('spots.assignedBadge') : t('spots.savedBadge')}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

            {/* Spots de la comunidad Kaikodo, junto a los resultados de Google */}
            {communitySpotResults.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t('spots.communityResults')}</p>
                <div className="space-y-2">
                  {communitySpotResults.map(spot => (
                    <PlaceResultCard
                      key={spot.id}
                      place={{ ...spot, name: spot.title }}
                      onSave={saveCommunitySpot}
                      saving={savingId === (spot.id || spot.title)}
                    />
                  ))}
                </div>
              </div>
            )}

                {/* Resultados OSM */}
                {searching && <p className="text-sm text-muted-foreground text-center py-4">{t('spots.searching')}</p>}
                {!searching && osmResults.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t('spots.moreResults')}</p>
                    <div className="bg-card border border-border rounded-2xl overflow-hidden">
                      {osmResults.map((p, i) => {
                        const isDuplicate = spots.some(s => s.title?.toLowerCase().trim() === p.name?.toLowerCase().trim());
                            const enr = enriched[p.id];
                        return (
                          <div key={p.id} ref={node => observeCard(node, p)} className={`flex items-center gap-3 px-3 py-2.5 ${i < osmResults.length - 1 ? 'border-b border-border' : ''}`}>
                            {enr?.photoUrl ? (
          <img src={enr.photoUrl} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                ) : (
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
            {(() => { const I = {food:Utensils,sight:Landmark,activity:Ticket,shopping:ShoppingBag,nightlife:Moon,bar:Moon}[p.type] || Compass; return <I size={14} className="text-muted-foreground" />; })()}
          </div>
                )}
                              <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                              {p.address && <p className="text-xs text-muted-foreground truncate">{p.address}</p>}
                            {enr?.rating && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Star className="w-3 h-3 fill-current" />
              {enr.rating}{enr.userRatingCount ? ` (${enr.userRatingCount})` : ''}
            </p>
          )}
                          </div>
                            {isDuplicate ? <span className="text-xs text-muted-foreground flex-shrink-0">{t('spots.savedBadge')}</span>
                              : <button onClick={() => saveOsmPlace(p)} disabled={savingId === p.id} className="flex-shrink-0 text-primary hover:text-primary/70 transition-colors">
                                  <Plus className="w-5 h-5" />
                                </button>
                            }
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {!searching && searchQuery.length >= 2 && osmResults.length === 0 && (
                  <div className="text-center py-8 bg-card border border-border rounded-2xl">
                    <p className="text-sm text-muted-foreground">{t('spots.noResultsFor', { query: searchQuery })}</p>
                    <button onClick={() => setShowCreate(true)}
                      className="mt-3 flex items-center gap-1.5 mx-auto text-sm text-primary font-medium">
                      <Plus className="w-4 h-4" />{t('spots.createManually')}
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        )}

                {/* ── MIS SPOTS TAB ── */}
        {tab === 'mis' && (
          <div>
            {/* Panel de importación desde wishlist personal */}
            {showImportPanel && importableSpots.length > 0 && (
              <div className="mb-4 bg-orange-50 dark:bg-primary/10 border border-orange-200 dark:border-primary/30 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-orange-200 dark:border-primary/20">
                  <div>
                    <p className="text-sm font-medium text-primary">
                      {t('spots.importCount', { count: importableSpots.length, country: normalizeCountry(country || trip?.country || '') })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('spots.importHint')}</p>
                  </div>
                  <button onClick={() => setShowImportPanel(false)} className="text-muted-foreground hover:text-foreground p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {importGroups.map((group, gi) => {
                  const groupKey = group.city?.id || 'other';
                  const pendingInGroup = group.spots.filter(s => !spots.some(sp => sp.title?.toLowerCase().trim() === s.title?.toLowerCase().trim()));
                  const isImportingGroup = importingGroup === groupKey;
                  return (
                    <div key={groupKey} className={gi > 0 ? 'border-t border-orange-200 dark:border-primary/20' : ''}>
                      <div className="flex items-center justify-between px-4 py-2 bg-orange-100/50 dark:bg-primary/15">
                        <p className="text-xs font-semibold text-primary uppercase tracking-wide">
                          {group.city ? group.city.name : t('spots.importOtherCities')}
                        </p>
                        {pendingInGroup.length > 1 && (
                          <button
                            onClick={() => importGroup(group)}
                            disabled={isImportingGroup}
                            className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                          >
                            {isImportingGroup ? '...' : t('spots.importAllShort', { count: pendingInGroup.length })}
                          </button>
                        )}
                      </div>
                      {group.spots.map(savedSpot => {
                        const alreadyInTrip = spots.some(s => s.title?.toLowerCase().trim() === savedSpot.title?.toLowerCase().trim());
                        const isSaving = savingId === 'import_' + savedSpot.id;
                        const SpotIcon = { food: Utensils, sight: Landmark, activity: Ticket, shopping: ShoppingBag }[savedSpot.type] || CirclePlus;
                        return (
                          <div key={savedSpot.id} className="flex items-center gap-3 px-4 py-3 border-t border-orange-200 dark:border-primary/20">
                            <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-primary/20 flex items-center justify-center flex-shrink-0">
                              <SpotIcon size={14} className="text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{savedSpot.title}</p>
                              {!group.city && savedSpot.city_name && <p className="text-xs text-muted-foreground">{savedSpot.city_name}</p>}
                            </div>
                            {alreadyInTrip ? (
                              <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded-full flex-shrink-0">{t('spots.alreadyAdded')}</span>
                            ) : (
                              <button
                                onClick={() => importSavedSpot(savedSpot, group.city)}
                                disabled={isSaving || isImportingGroup}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-full flex-shrink-0 disabled:opacity-50"
                              >
                                {isSaving ? '...' : <><Plus className="w-3 h-3" />{t('spots.addShort')}</>}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Search bar */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={mySpotSearch}
                onChange={e => setMySpotSearch(e.target.value)}
                placeholder={t('spots.searchMine')}
                className="w-full pl-9 pr-9 py-2.5 rounded-2xl text-sm outline-none bg-card border border-border focus:border-primary text-foreground"
              />
              {mySpotSearch && (
                <button onClick={() => setMySpotSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground p-1">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filters */}
            <div className="flex gap-2 mb-4">
              {[['all',t('spots.filterAll')],['created',t('spots.filterCreated')],['saved',t('spots.filterSaved')],['assigned',t('spots.filterAssigned')]].map(([v,l]) => (
                <button key={v} onClick={() => setStateFilter(v)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    stateFilter===v ? 'bg-primary text-white border-primary' : 'bg-card border-border text-muted-foreground hover:border-primary/40'
                  }`}>
                  {l}
                </button>
              ))}
            </div>

            {/* Toggle Lista / Mapa — solo tiene sentido si ya hay algo que ver */}
            {!loadingSpots && spots.length > 0 && (
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">
                  {t('spots.map.countSummary', { count: spots.length, cities: new Set(spots.map(s => s.city_id || s.city_name).filter(Boolean)).size })}
                </span>
                <div className="inline-flex bg-secondary rounded-full p-1 gap-0.5">
                  <button onClick={() => setMySpotsView('lista')}
                    className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                      mySpotsView === 'lista' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}>
                    <List className="w-3.5 h-3.5" />{t('spots.map.listView')}
                  </button>
                  <button onClick={() => setMySpotsView('mapa')}
                    className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                      mySpotsView === 'mapa' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}>
                    <MapIcon className="w-3.5 h-3.5" />{t('spots.map.mapView')}
                  </button>
                </div>
              </div>
            )}

            {!loadingSpots && spots.length > 0 && mySpotsView === 'mapa' ? (
              <SpotsMapView
                spots={filteredSpots.length ? filteredSpots : spots}
                cities={tripCities}
                onCreatePin={(lat, lng) => { setPinPrefill({ lat, lng }); setShowCreate(true); }}
                onSelectSpot={setSelectedSpot}
              />
            ) : loadingSpots && spots.length === 0 ? (
              <div className="text-center py-12">
                <Loader2 className="w-6 h-6 text-muted-foreground animate-spin mx-auto" />
              </div>
            ) : spots.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
                  <MapPin className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">{t('spots.emptyTitle')}</p>
                <p className="text-xs text-muted-foreground mb-5">{t('spots.emptySubtitle')}</p>
                <button onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm rounded-full font-medium">
                  <Plus className="w-4 h-4" />{t('spots.createFirst')}
                </button>
              </div>
            ) : filteredSpots.length === 0 && mySpotSearch.trim().length >= 1 ? (
              /* No local match — show message + seed/OSM suggestions */
              <div className="space-y-4">
                <div className="text-center py-6 bg-card rounded-2xl border border-border">
                  <Search className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground mb-1">{t('spots.noLocalTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('spots.searchResultsFor')} <strong>"{mySpotSearch}"</strong></p>
                </div>
                {/* Show seed matches as suggestions */}
                {seedSpots.filter(s => s.title?.toLowerCase().includes(mySpotSearch.toLowerCase())).slice(0, 5).map((p, i) => {
                  const isDuplicate = spots.some(s => s.title?.toLowerCase().trim() === p.title?.toLowerCase().trim());
                  return <PlaceResultCard key={`ms-seed-${i}`} place={{ id: `ms-seed-${i}`, name: p.title, type: p.type, address: p.address || '' }} onSave={saveOsmPlace} saving={savingId===`ms-seed-${i}`} isDuplicate={isDuplicate} />;
                })}
                <button onClick={() => { setTab('buscar'); setSearchQuery(mySpotSearch); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-card border border-dashed border-border rounded-2xl text-sm text-primary font-medium hover:bg-orange-50 transition-colors">
                  <Search className="w-4 h-4" />{t('spots.searchOnMap', { query: mySpotSearch })}
                </button>
              </div>
            ) : filteredSpots.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-muted-foreground text-sm">{t('spots.noFilterMatch')}</p>
              </div>
            ) : (
              <div className="bg-card rounded-2xl border border-border overflow-hidden">
                {filteredSpots.map(spot => (
                  <MySpotRow
                    key={spot.id}
                    spot={spot}
                    onTap={setSelectedSpot}
                    userId={user?.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Create sheet */}
      <CreateSpotSheet
        open={showCreate}
        onClose={() => { setShowCreate(false); setPinPrefill(null); }}
        onSave={saveManualSpot}
        saving={savingId === 'manual'}
        spots={spots}
        city={city}
        country={country}
        initialLat={pinPrefill?.lat}
        initialLng={pinPrefill?.lng}
        initialType={openCreateParam === 'hotel' ? 'hotel' : undefined}
      />

      {/* Spot detail sheet */}
      {selectedSpot && (
        <SpotDetailSheet
          spot={selectedSpot}
          open={!!selectedSpot}
          onClose={() => setSelectedSpot(null)}
          onNotify={notifyMembers}
          onSave={(id, data) => updateMutation.mutateAsync({ id, data })}
          onDelete={id => deleteMutation.mutate(id)}
          tripId={tripId}
          tripCities={tripCities}
          userId={user?.id}
          currentUserEmail={normalizeEmail(currentUser?.email)}
        />
      )}

      {/* Assign date modal */}
      {assignDateSpot && (
        <AssignDateModal
          spot={assignDateSpot}
          tripCities={tripCities}
          onAssign={async (date, resolvedCityId, time) => {
            const data = { assigned_date: date, assigned_time: time || null };
            // Re-ancla el spot a la estancia correcta si la fecha elegida
            // pertenece a otra visita a la misma ciudad — si no, se queda
            // con el city_id de la estancia original y desaparece de las
            // vistas de itinerario (que exigen que ambos coincidan).
            if (resolvedCityId && resolvedCityId !== assignDateSpot.city_id) {
              data.city_id = resolvedCityId;
            }
            try {
              await updateMutation.mutateAsync({ id: assignDateSpot.id, data });
            } catch (e) {
              // El spot pudo haber sido borrado con el "Deshacer" del toast
              // mientras este modal seguía abierto — no es un error real que
              // mostrar, simplemente ya no hay nada que actualizar.
              const notFound = /not found/i.test(String(e?.message || ''));
              if (!notFound) throw e;
            }

            // El guardado esencial (fecha/hora) ya está hecho — cerramos el
            // modal aquí. Antes el auto-orden de abajo corría DENTRO del
            // mismo await que el botón "Confirmar" esperaba: con mala
            // conexión, los Spot.update en Promise.all podían tardar mucho o
            // quedarse colgados sin resolver ni rechazar nunca, y el botón se
            // quedaba en "Cargando..." para siempre aunque el spot ya
            // estuviera guardado (auditoría: José, 2026-08-06). Ahora el
            // auto-orden es best-effort en segundo plano y no puede volver a
            // bloquear el botón.
            setAssignDateSpot(null);

            (async () => {
              try {
                // Auto-orden: si el spot tiene coordenadas y ya hay otros spots
                // ese mismo día en la misma ciudad, se inserta junto al que
                // tenga más cerca en vez de dejarlo desordenado al final. El
                // usuario puede arrastrar para corregirlo (DraggableSpotList).
                const finalCityId = data.city_id || assignDateSpot.city_id;
                const daySpots = spots
                  .filter(s => s.id !== assignDateSpot.id && s.assigned_date === date && s.city_id === finalCityId)
                  .sort((a, b) => (a.day_order ?? 999) - (b.day_order ?? 999));
                if (daySpots.length > 0 && assignDateSpot.lat && assignDateSpot.lng && !data.assigned_time) {
                  const insertIdx = suggestInsertIndex(assignDateSpot, daySpots);
                  const reordered = [...daySpots];
                  reordered.splice(insertIdx, 0, assignDateSpot);
                  await Promise.all(reordered.map((s, idx) => base44.entities.Spot.update(s.id, { day_order: idx })));
                  queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
                  toast({ title: t('spots.autoOrder.title'), description: t('spots.autoOrder.body', { position: insertIdx + 1 }) });
                }
              } catch {
                // Best-effort: el spot ya quedó guardado con su fecha/hora,
                // así que un fallo aquí no debe interrumpir al usuario.
              }
            })();
          }}
          onSkip={() => setAssignDateSpot(null)}
          onUndo={async () => {
            if (assignDateSpot?.id) {
              // Antes: .catch(() => {}) tragaba el error y el modal se cerraba
              // igual, dando a entender que el spot se había borrado aunque
              // siguiera existiendo (auditoría 1.4). Ahora se avisa con un
              // toast si el borrado falla, en vez de fingir que "Deshacer"
              // funcionó.
              try {
                await deleteMutation.mutateAsync(assignDateSpot.id);
                if (lastSavedId === assignDateSpot.id) setLastSavedId(null);
                setSavedToast(prev => (prev.spot && lastSavedId === assignDateSpot.id ? { visible: false, spot: null } : prev));
              } catch {
                toast({ title: t('common.error'), description: t('spots.undoError'), variant: 'destructive' });
              }
            }
            setAssignDateSpot(null);
          }}
        />
      )}

      {/* Toast */}
      <Toast spot={savedToast.spot} city={savedToast.city} visible={savedToast.visible} onUndo={undoSave} />
    </div>
  );
}