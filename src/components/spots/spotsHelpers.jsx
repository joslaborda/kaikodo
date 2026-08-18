import { CirclePlus, Compass, Landmark, ShoppingBag, Ticket, Utensils, Hotel, TrainFront, BusFront } from 'lucide-react';
import { PlaneIcon } from '@/lib/icons';
// ── Maps URL helper ───────────────────────────────────────────────────────────
export function getMapsUrl(spot) {
  if (spot.lat && spot.lng) return `https://www.google.com/maps?q=${spot.lat},${spot.lng}`;
  const q = encodeURIComponent(spot.address || spot.title);
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export async function loadLeaflet() {
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

export const TYPE_CONFIG = {
  food:      { label:'Comer',      tk:'spots.types.food',      Icon: Utensils,    color:'bg-orange-100 dark:bg-orange-950/30 text-primary' },
  sight:     { label:'Cultura',    tk:'spots.types.sight',     Icon: Landmark,    color:'bg-violet-100 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400' },
  activity:  { label:'Actividad',  tk:'spots.types.activity',  Icon: Ticket,      color:'bg-green-100 dark:bg-green-950/30 text-green-600 dark:text-green-400' },
  shopping:  { label:'Compras',    tk:'spots.types.shopping',  Icon: ShoppingBag, color:'bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400' },
  transport: { label:'Transporte', tk:'spots.types.transport', Icon: Compass,     color:'bg-secondary text-muted-foreground' },
  hotel:     { label:'Hotel',      tk:'spots.types.hotel',     Icon: Hotel,       color:'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400' },
  // Antes 'transport' era el único cajón para bus/tren/aeropuerto — un solo
  // icono de brújula genérico para los tres. Ahora cada uno tiene el suyo;
  // 'transport' se queda como fallback para spots antiguos ya guardados así.
  airport:   { label:'Aeropuerto', tk:'spots.types.airport',   Icon: PlaneIcon,   color:'bg-sky-100 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400' },
  train:     { label:'Estación de tren', tk:'spots.types.train', Icon: TrainFront, color:'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' },
  bus:       { label:'Estación de autobús', tk:'spots.types.bus', Icon: BusFront, color:'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400' },
  custom:    { label:'Otro',       tk:'spots.types.custom',    Icon: CirclePlus,  color:'bg-secondary text-muted-foreground' },
};

// ── Recent searches (localStorage) ───────────────────────────────────────────
const RECENT_SEARCHES_KEY = 'kodo_recent_searches';
export function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]'); } catch { return []; }
}
export function addRecentSearch(query) {
  const searches = getRecentSearches().filter(s => s.query !== query);
  searches.unshift({ query, date: new Date().toISOString() });
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches.slice(0, 8)));
}
export function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY);
}

// ── Country-specific special tags ─────────────────────────────────────────────
export const COUNTRY_SPECIAL_TAGS = {
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
  'Colombia': ['#café', '#cartajena', '#naturaleza', '#salsa', '#flores', '#aventura'],
};

// ── Dynamic hashtags from existing spots ──────────────────────────────────────
export function buildHashtags(spots, tripCities) {
  const typeTags = {
    food: '#gastronomía', sight: '#cultura', activity: '#actividades',
    shopping: '#compras', custom: '#otros',
  };
  const tags = new Set();
  const countries = [...new Set(tripCities.map(c => c.country).filter(Boolean))];
  countries.forEach(country => {
    (COUNTRY_SPECIAL_TAGS[country] || []).forEach(t => tags.add(t));
  });
  spots.forEach(s => { if (typeTags[s.type]) tags.add(typeTags[s.type]); });
  return [...tags].slice(0, 12);
}