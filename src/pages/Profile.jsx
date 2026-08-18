import { useState, useEffect, useMemo, useRef} from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Check, CirclePlus, Compass, Hotel, Landmark, Loader2, MapPin, Plus, Search, ShoppingBag, Ticket, TrainFront, BusFront, Utensils, X } from 'lucide-react';
import { PlaneIcon } from '@/lib/icons';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { getCountryMeta, normalizeCountry, getCountryLabel } from '@/lib/countryConfig';
import { getContinent, CONTINENT_ORDER, CONTINENT_EMOJI } from '@/lib/continents';
import { getTripCoverImage } from '@/lib/tripImage';
import TripCard from '@/components/trip/TripCard';
import OTabBar from '@/components/trip/OTabBar';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { normalizeEmail } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const SPOT_ICONS_MAP = {
  food: Utensils, sight: Landmark, activity: Ticket,
  shopping: ShoppingBag, custom: CirclePlus, other: Compass,
  restaurant: Utensils, museum: Landmark,
  // Antes hotel/aeropuerto/tren/bus caían en el fallback MapPin de más
  // abajo — no un "+", pero tampoco su icono real.
  hotel: Hotel, transport: Compass, airport: PlaneIcon, train: TrainFront, bus: BusFront,
};
const TYPE_LABEL  = { food:'spots.types.food', sight:'spots.types.sight', activity:'spots.types.activity', shopping:'spots.types.shopping', custom:'spots.types.custom' };
const TYPE_FILTERS = [
  { key:'all',      tk:'common.all' },
  { key:'food',     tk:'spots.types.food' },
  { key:'sight',    tk:'spots.types.sight' },
  { key:'activity', tk:'spots.types.activity' },
  { key:'shopping', tk:'spots.types.shopping' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Group spots by country → city
// ─────────────────────────────────────────────────────────────────────────────
function groupByCountry(spots) {
  const g = {};
  spots.forEach(s => {
    const country = normalizeCountry(s.country || '') || 'Otros';
    if (!g[country]) g[country] = [];
    g[country].push(s);
  });
  return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
}

function countryFlag(country) {
  return getCountryMeta(country)?.flag || '🌍';
}

// ─────────────────────────────────────────────────────────────────────────────
// Spot row — used in both tabs and search results
// ─────────────────────────────────────────────────────────────────────────────
function SpotRow({ spot, isSaved, onSave, onUnsave, showLikes = false, showVisibility = false }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const handleSaveClick = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(spot);
    } finally {
      setSaving(false);
    }
  };
  const SpotTypeIcon = SPOT_ICONS_MAP[spot.type] || MapPin;
  const coverImg = spot.image_url || (spot.city_name || spot.country
    ? getTripCoverImage(spot.city_name, spot.country)
    : null);
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      {coverImg ? (
        <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-secondary">
          <img src={coverImg} alt={spot.title} className="w-full h-full object-cover"
            onError={e => { e.currentTarget.style.display='none'; }} />
        </div>
      ) : (
        <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0"><SpotTypeIcon size={16} className="text-muted-foreground" /></div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{spot.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {spot.city_name || spot.city || ''}
          {showLikes && spot.likes_count ? ` · ${t('profile.likesCount', { count: spot.likes_count })}` : ''}
        </p>
      </div>
      {showVisibility && (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
          spot.visibility === 'public'
            ? 'bg-orange-50 dark:bg-orange-950/30 text-primary border border-orange-200 dark:border-orange-900/50'
            : 'bg-secondary text-muted-foreground border border-border'
        }`}>
          {spot.visibility === 'public' ? t('profile.public') : t('profile.private')}
        </span>
      )}
      {onSave && !isSaved && (
        <button onClick={handleSaveClick} disabled={saving}
          className="w-7 h-7 rounded-full bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/50 flex items-center justify-center flex-shrink-0 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors disabled:opacity-50 disabled:pointer-events-none">
          <Plus className="w-3.5 h-3.5 text-primary" />
        </button>
      )}
      {onSave && isSaved && (
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900/50 flex-shrink-0">
          {t('profile.savedBadge')}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Spot collection grouped by country
// ─────────────────────────────────────────────────────────────────────────────
function SpotCollection({spots, showLikes = false, showVisibility = false }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState({});
  const [showAll, setShowAll] = useState({});

  if (!spots.length) return (
    <div className="text-center py-10 px-4">
      
      <p className="text-sm font-medium text-foreground mb-1">{t('profile.emptyTitle')}</p>
      <p className="text-xs text-muted-foreground">{t('profile.emptyHint')}</p>
    </div>
  );

  const groups = groupByCountry(spots);

  return (
    <div>
      {groups.map(([country, cSpots], gi) => {
        const isExp = expanded[country] !== false;
        const previewCount = 2;
        const visible = isExp ? (showAll[country] ? cSpots : cSpots.slice(0, previewCount)) : [];
        const flag = countryFlag(country);

        return (
          <div key={country} className={gi > 0 ? 'border-t border-border' : ''}>
            <button onClick={() => setExpanded(p => ({ ...p, [country]: !isExp }))}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-secondary/30 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-sm">{flag}</span>
                <span className="text-sm font-medium text-foreground">{getCountryLabel(country, i18n.language)}</span>
                <span className="text-xs text-muted-foreground">· {t('profile.spotCount', { count: cSpots.length })}</span>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`text-muted-foreground transition-transform ${isExp ? 'rotate-90' : ''}`}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>

            {isExp && visible.map(spot => (
              <div key={spot.id} className="border-t border-border">
                <SpotRow spot={spot} showLikes={showLikes} showVisibility={showVisibility} />
              </div>
            ))}

            {isExp && !showAll[country] && cSpots.length > previewCount && (
              <button onClick={() => setShowAll(p => ({ ...p, [country]: true }))}
                className="w-full text-left px-3 py-2 text-xs text-primary font-medium border-t border-border hover:bg-secondary/20 transition-colors">
                {t('profile.showMore', { count: cSpots.length - previewCount })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// Browse tree: continente → país → ciudad → spots (para explorar sin buscar)
// ─────────────────────────────────────────────────────────────────────────────
function buildBrowseTree(spots) {
  const tree = {};
  spots.forEach(s => {
    const country = normalizeCountry(s.country || '') || 'Otros';
    const continent = getContinent(country);
    const city = s.city_name; // ciudad obligatoria en todo spot (llega de Google o de la validación al crear)
    if (!tree[continent]) tree[continent] = {};
    if (!tree[continent][country]) tree[continent][country] = {};
    if (!tree[continent][country][city]) tree[continent][country][city] = [];
    tree[continent][country][city].push(s);
  });
  return tree;
}

function countSpots(node) {
  if (Array.isArray(node)) return node.length;
  return Object.values(node).reduce((sum, v) => sum + countSpots(v), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Spot browser — jerarquía continente → país → ciudad
// ─────────────────────────────────────────────────────────────────────────────
// Dado el árbol y un punto de partida, avanza automáticamente por los niveles
// que solo tienen una opción (un continente con un único país, un país con
// una única ciudad) — evita obligar a tocar una fila que no tiene alternativa.
// Solo se llama al entrar en un nivel (montaje o clic explícito de una fila),
// nunca de forma reactiva en cada render, para que la flecha de "atrás" pueda
// mostrar ese nivel de una sola fila sin que el auto-avance lo vuelva a saltar
// hacia adelante en un bucle.
function cascadeBrowseTree(tree, startContinent, startCountry) {
  let continent = startContinent, country = startCountry, city = null;
  if (continent == null) {
    const continents = CONTINENT_ORDER.filter(c => tree[c]);
    if (continents.length === 1) continent = continents[0];
    else return { continent, country, city };
  }
  if (country == null) {
    const countries = Object.keys(tree[continent] || {});
    if (countries.length === 1) country = countries[0];
    else return { continent, country, city };
  }
  const cities = Object.keys((tree[continent] || {})[country] || {});
  if (cities.length === 1) city = cities[0];
  return { continent, country, city };
}

function SpotBrowser({ tree, savedSpotIds, onSave, isLoading }) {
  const { t, i18n } = useTranslation();
  const [continent, setContinent] = useState(null);
  const [country, setCountry] = useState(null);
  const [city, setCity] = useState(null);

  // Si el nivel superior tiene un solo hijo (p. ej. todos los spots públicos
  // son de un único continente), saltar directo en vez de obligar a tocarlo.
  const cascadedOnMount = useRef(false);
  useEffect(() => {
    if (cascadedOnMount.current) return;
    if (!Object.keys(tree).length) return;
    cascadedOnMount.current = true;
    const r = cascadeBrowseTree(tree, null, null);
    if (r.continent) { setContinent(r.continent); setCountry(r.country); setCity(r.city); }
  }, [tree]);

  const selectContinent = (c) => {
    const r = cascadeBrowseTree(tree, c, null);
    setContinent(r.continent); setCountry(r.country); setCity(r.city);
  };
  const selectCountry = (co) => {
    const r = cascadeBrowseTree(tree, continent, co);
    setCountry(r.country); setCity(r.city);
  };
  const goBack = () => {
    if (city) setCity(null);
    else if (country) setCountry(null);
    else if (continent) setContinent(null);
  };

  if (isLoading) {
    return (
      <div className="text-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
      </div>
    );
  }

  if (!Object.keys(tree).length) {
    return (
      <div className="bg-card border border-border rounded-2xl text-center py-8">
        <Compass className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{t('profile.noPublicSpots')}</p>
      </div>
    );
  }

  const crumbs = [{ label: t('profile.explore'), onClick: () => { setContinent(null); setCountry(null); setCity(null); } }];
  if (continent) crumbs.push({ label: `${CONTINENT_EMOJI[continent] || ''} ${t(`continents.${continent}`)}`, onClick: () => { setCountry(null); setCity(null); } });
  if (country) crumbs.push({ label: `${countryFlag(country)} ${getCountryLabel(country, i18n.language)}`, onClick: () => setCity(null) });
  if (city) crumbs.push({ label: city, onClick: null });

  let rows = [];
  if (!continent) {
    rows = CONTINENT_ORDER
      .filter(c => tree[c])
      .map(c => ({ key: c, label: `${CONTINENT_EMOJI[c] || ''} ${t(`continents.${c}`)}`, count: countSpots(tree[c]), onClick: () => selectContinent(c) }))
      .sort((a, b) => b.count - a.count);
  } else if (!country) {
    const countries = tree[continent] || {};
    rows = Object.entries(countries)
      .map(([cName, cities]) => ({ key: cName, label: `${countryFlag(cName)} ${getCountryLabel(cName, i18n.language)}`, count: countSpots(cities), onClick: () => selectCountry(cName) }))
      .sort((a, b) => b.count - a.count);
  } else if (!city) {
    const cities = (tree[continent] || {})[country] || {};
    rows = Object.entries(cities)
      .map(([cityName, citySpotList]) => ({ key: cityName, label: cityName, count: citySpotList.length, onClick: () => setCity(cityName) }))
      .sort((a, b) => b.count - a.count);
  }

  const citySpots = (continent && country && city) ? (((tree[continent] || {})[country] || {})[city] || []) : [];

  return (
    <div className="space-y-2">
      {/* Flecha atrás + breadcrumb */}
      <div className="flex items-center gap-2 px-1">
        {continent && (
          <button aria-label={t('common.back')} onClick={goBack}
            className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </button>
        )}
        <div className="flex items-center gap-1 flex-wrap text-xs">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/50">/</span>}
              {c.onClick ? (
                <button onClick={c.onClick} className="text-primary font-medium hover:underline">{c.label}</button>
              ) : (
                <span className="text-foreground font-medium">{c.label}</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {!city ? (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {rows.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">{t('profile.noPublicSpots')}</p>
            </div>
          ) : rows.map((row, i) => (
            <button key={row.key} onClick={row.onClick}
              className={`w-full flex items-center justify-between px-3 py-2.5 hover:bg-secondary/30 transition-colors text-left ${i > 0 ? 'border-t border-border' : ''}`}>
              <span className="text-sm font-medium text-foreground">{row.label}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {t('profile.spotCount', { count: row.count })}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {citySpots.map((spot, i) => {
            const isSaved = savedSpotIds.has(spot.id);
            return (
              <div key={spot.id} className={i > 0 ? 'border-t border-border' : ''}>
                <SpotRow
                  spot={spot}
                  isSaved={isSaved}
                  onSave={isSaved ? null : (s) => onSave(s)}
                  showLikes
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Spot search panel
// ─────────────────────────────────────────────────────────────────────────────
function SpotSearchPanel({savedSpotIds, onSave }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [toastMsg, setToastMsg] = useState(null);
  const inputRef = useRef(null);

  const { data: allPublicSpots = [], isLoading } = useQuery({
    queryKey: ['publicSpots'],
    queryFn: async () => {
      const spots = await base44.entities.Spot.filter({ visibility: 'public' });
      return spots;
    },
    staleTime: 60000,
  });

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allPublicSpots.filter(s => {
      const matchesText =
        s.title?.toLowerCase().includes(q) ||
        s.city_name?.toLowerCase().includes(q) ||
        s.country?.toLowerCase().includes(q) ||
        s.tags?.some(tag => tag.toLowerCase().includes(q));
      const matchesType = typeFilter === 'all' || s.type === typeFilter;
      return matchesText && matchesType;
    }).slice(0, 20);
  }, [query, typeFilter, allPublicSpots]);

  const browseTree = useMemo(() => buildBrowseTree(allPublicSpots), [allPublicSpots]);

  const handleSave = async (spot) => {
    await onSave(spot);
    setToastMsg(t('profile.savedToast', { title: spot.title, country: spot.country || '' }));
    setTimeout(() => setToastMsg(null), 3000);
  };

  return (
    <div className="space-y-2">
      {/* Search input */}
      <div className={`bg-card border rounded-2xl px-3 py-2.5 flex items-center gap-2 transition-colors ${
        query ? 'border-primary' : 'border-border'
      }`}>
        <Search className={`w-4 h-4 flex-shrink-0 ${query ? 'text-primary' : 'text-muted-foreground'}`} />
        <input
          ref={inputRef}
          type="text"
          placeholder={t('profile.searchSpots')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder-muted-foreground"
        />
        {query && (
          <button onClick={() => setQuery('')} className="flex-shrink-0 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="bg-foreground rounded-2xl px-4 py-3 flex items-center gap-2.5">
          <Check size={16} className="text-green-600" />
          <p className="text-xs font-medium text-white">{toastMsg}</p>
        </div>
      )}

      {/* Results */}
      {query.trim() ? (
        <>
          {/* Type filters */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {TYPE_FILTERS.map(f => (
              <button key={f.key} onClick={() => setTypeFilter(f.key)}
                className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  typeFilter === f.key
                    ? 'bg-primary text-white border-primary'
                    : 'bg-card border-border text-muted-foreground'
                }`}>
                {t(f.tk)}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="text-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
            </div>
          ) : results.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl text-center py-8">
              <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t('profile.noResultsFor', { query })}</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <p className="text-xs text-muted-foreground px-3 pt-3 pb-1">
                {t('profile.resultsCount', { count: results.length, query })}
              </p>
              {results.map((spot, i) => {
                const isSaved = savedSpotIds.has(spot.id);
                return (
                  <div key={spot.id} className={i > 0 ? 'border-t border-border' : ''}>
                    <SpotRow
                      spot={spot}
                      isSaved={isSaved}
                      onSave={isSaved ? null : handleSave}
                      showLikes
                    />
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <SpotBrowser
          tree={browseTree}
          savedSpotIds={savedSpotIds}
          onSave={handleSave}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
export default function Profile() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('guardados');

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['myProfile', user?.id],
    queryFn: async () => {
      const r = await base44.entities.UserProfile.filter({ user_id: user.id });
      return r[0] || null;
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  // All spots created by the user
  const { data: mySpots = [] } = useQuery({
    queryKey: ['mySpots', user?.email],
    queryFn: async () => {
      const all = await base44.entities.Spot.filter({ created_by: user.email });
      // Solo cuenta spots creados explícitamente vía el formulario "Crear spot"
      // (source === 'manual'). Antes se admitía también cualquier spot sin
      // osm_id/source como fallback "manual por defecto" — eso colaba en
      // "Creados" los spots asignados desde OSM y los importados desde otros
      // viajes, que nunca llegaron a tener ese metadata rellenado.
      return all.filter(s => s.source === 'manual');
    },
    enabled: !!user?.email,
    staleTime: 60000,
  });

  // Saved spots — wishlist personal del usuario, guardados desde el buscador de perfil
  // Usa SavedSpot (una fila por spot guardado) en lugar de mutar el Spot original
  const { data: savedSpots = [] } = useQuery({
    queryKey: ['savedSpots', user?.id],
    queryFn: () => base44.entities.SavedSpot.filter({ user_id: user.id }),
    enabled: !!user?.id,
    staleTime: 60000,
  });

  // All trips for the user — created OR member
  const { data: myTrips = [] } = useQuery({
    queryKey: ['myTrips', user?.id, user?.email],
    queryFn: async () => {
      // trip.members está en minúsculas; user.email tal cual viene del auth
      // no siempre lo está — sin normalizar, un invitado (no creador) con
      // email de distinto casing no aparecía en esta lista de viajes.
      const [created, asMember] = await Promise.all([
        base44.entities.Trip.filter({ created_by: user.email }),
        base44.entities.Trip.filter(
          { members: { $elemMatch: { $eq: normalizeEmail(user.email) } } },
          '-created_date'
        ),
      ]);
      const createdIds = new Set(created.map(item => item.id));
      const memberOnly = asMember.filter(item => !createdIds.has(item.id));
      return [...created, ...memberOnly].sort((a, b) =>
        (b.start_date || '').localeCompare(a.start_date || '')
      );
    },
    enabled: !!user?.id && !!user?.email,
    staleTime: 60000,
  });

  const { data: myTripCities = [] } = useQuery({
    queryKey: ['myTripCities', myTrips.map(item => item.id).join(',')],
    queryFn: async () => {
      if (!myTrips.length) return [];
      const all = await Promise.all(
        myTrips.map(item => base44.entities.City.filter({ trip_id: item.id }))
      );
      return all.flat();
    },
    enabled: myTrips.length > 0,
    staleTime: 60000,
  });

  const tripsCount = myTrips.length;

  // Set de source_spot_id para saber qué spots ya están en la wishlist
  const savedSpotIds = useMemo(() => new Set(savedSpots.map(s => s.source_spot_id).filter(Boolean)), [savedSpots]);

  // Count unique countries visited — from trip cities
  const countriesCount = useMemo(() => {
    const fromCities = new Set(myTripCities.map(c => c.country).filter(Boolean));
    const fromSpots = new Set(mySpots.map(s => s.country).filter(Boolean));
    return new Set([...fromCities, ...fromSpots]).size;
  }, [myTripCities, mySpots]);

  // Guardar spot en la wishlist personal — crea una fila SavedSpot, no toca el Spot original
  const saveMutation = useMutation({
    mutationFn: async (spot) => {
      // Evitar duplicados
      const already = savedSpots.find(s => s.source_spot_id === spot.id);
      if (already) return;
      await base44.entities.SavedSpot.create({
        user_id: user.id,
        source_spot_id: spot.id,
        title: spot.title,
        type: spot.type || 'custom',
        address: spot.address || '',
        city_name: spot.city_name || '',
        country: normalizeCountry(spot.country || ''),
        lat: spot.lat || null,
        lng: spot.lng || null,
        image_url: spot.image_url || null,
        notes: spot.notes || '',
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['savedSpots', user?.id] }),
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  if (profileLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  const displayName = profile?.display_name || user?.full_name || t('profile.user');
  const initials = displayName[0]?.toUpperCase() || '?';
  const countryMeta = getCountryMeta(profile?.home_country || '');

  return (
    <div className="bg-background min-h-screen">

      {/* ── Header ── */}
      <div className="bg-background sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 pt-12 pb-0">
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('TripsList')}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
              {t('profile.myTrips')}
            </Link>
            <Link to={createPageUrl('Settings')}
              className="flex items-center gap-1.5 text-primary text-sm font-medium hover:text-primary/80 transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              {t('settings.title')}
            </Link>
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-4">{t('profile.title')}</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-5 pb-24 space-y-4">

        {/* ── Identity card ── */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-16 h-16 rounded-full overflow-hidden border border-border flex-shrink-0 flex items-center justify-center bg-primary text-white text-xl font-medium">
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt={displayName} className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display='none'; }}/>
                : initials
              }
            </div>
            <div>
              <p className="text-base font-medium text-foreground">{displayName}</p>
              <p className="text-sm text-muted-foreground">
                {profile?.username ? `@${profile.username}` : ''}
                {profile?.username && profile?.home_country ? ' · ' : ''}
                {profile?.home_country ? `${countryMeta.flag} ${getCountryLabel(profile.home_country, i18n.language)}` : ''}
                {profile?.second_nationality ? (() => {
                  const m2 = getCountryMeta(profile.second_nationality);
                  return ` · ${m2.flag} ${getCountryLabel(profile.second_nationality, i18n.language)}`;
                })() : ''}
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="flex border-t border-border pt-3">
            {[
              { value: tripsCount, label: t('profile.trips') },
              { value: mySpots.length, label: t('profile.mySpots') },
              { value: countriesCount, label: t('profile.countries') },
            ].map((stat, i) => (
              <div key={stat.label} className={`flex-1 text-center ${i > 0 ? 'border-l border-border' : ''}`}>
                <p className="text-lg font-medium text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Search ── */}
        <SpotSearchPanel
          savedSpotIds={savedSpotIds}
          onSave={spot => saveMutation.mutateAsync(spot)}
        />

        {/* ── Tabs ── */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <OTabBar
            tabs={[{key:'guardados',label: t('profile.saved')},{key:'creados',label: t('profile.created')},{key:'viajes',label: `${t('profile.trips')}${tripsCount ? ' ('+tripsCount+')' : ''}`}]}
            activeKey={tab}
            onChange={setTab}
          />

          {tab === 'guardados' && (
            <SpotCollection spots={savedSpots} />
          )}

          {tab === 'creados' && (
            <SpotCollection spots={mySpots} showLikes showVisibility />
          )}

          {tab === 'viajes' && (
            <div className="p-3 space-y-2">
              {myTrips.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <p className="text-sm">{t('profile.noTrips')}</p>
                </div>
              ) : (
                myTrips.map(trip => {
                  const cities = myTripCities.filter(c => c.trip_id === trip.id);
                  return <TripCard key={trip.id} trip={trip} cities={cities} />;
                })
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
