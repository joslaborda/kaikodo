import { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import {
  Bookmark, CirclePlus, Compass, ExternalLink, Hotel, Landmark, Loader2,
  MapPin, Navigation, Search, ShoppingBag, Sparkles, Star, Ticket, TrainFront,
  BusFront, Trash2, Utensils, X,
} from 'lucide-react';
import { PlaneIcon } from '@/lib/icons';
import { Link } from 'react-router-dom';
import OTabBar from '@/components/trip/OTabBar';
import { createPageUrl } from '@/utils';
import { getCountryMeta, normalizeCountry, getCountryLabel } from '@/lib/countryConfig';
import { getTripStatus } from '@/components/trip/TripCard';
import { searchNewPlaces, fetchPlaceDetails } from '@/components/spots/placesAutocomplete';
import { matchTripCity } from '@/lib/tripCityMatch';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { normalizeEmail, isSafeHttpUrl } from '@/lib/utils';
import GooglePlaceCard, { googlePlaceIdOf, isGoogleCardControl } from '@/components/spots/GooglePlaceCard';
import { TYPE_CONFIG, getMapsUrl } from '@/components/spots/spotsHelpers';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const SPOT_ICONS_MAP = {
  food: Utensils, sight: Landmark, activity: Ticket,
  shopping: ShoppingBag, custom: CirclePlus, other: Compass,
  restaurant: Utensils, museum: Landmark,
  hotel: Hotel, transport: Compass, airport: PlaneIcon, train: TrainFront, bus: BusFront,
};

function countryFlag(country) {
  return getCountryMeta(country)?.flag || '🌍';
}

function fmtShortDate(dateStr, lang) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fila de un spot de la colección — con papelera y aviso si está en un viaje
// ─────────────────────────────────────────────────────────────────────────────
function CollectionRow({ spot, tripName, onDelete, deleting, onOpenSheet }) {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const tc = TYPE_CONFIG[spot.type] || TYPE_CONFIG.custom;
  const inItinerary = spot.owner === 'mine' && !!spot.assigned_date;
  const placeId = googlePlaceIdOf(spot);
  const online = useOnlineStatus();
  // José (24 sep 2026): estas filas tienen que verse igual que las de Spots
  // (MySpotRow). Antes llevaban la portada genérica de la ciudad -- la misma
  // foto repetida en todas -- y el nombre tecleado al buscar ("Restaurante").
  // Ahora, igual que en Spots: ficha de Google (Places UI Kit, carga
  // diferida; nombre, foto y estrellas reales del sitio, términos EEA) y, sin
  // place id o sin conexión, la fila propia con el icono del tipo.
  const showOwnMeta = !placeId || !online;
  const cityLabel = spot.city_name || spot.city || '';

  const ownHeader = (
    <div className="flex items-center gap-3 min-w-0">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tc.color}`}>{tc.Icon && <tc.Icon size={16} />}</div>
      <p className="text-sm font-medium text-foreground truncate">{spot.title}</p>
    </div>
  );

  const badges = (spot.owner === 'mine' || spot.importedToTripName) ? (
    <span className="flex items-center gap-1.5 min-w-0">
      {spot.owner === 'mine' && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900/50 shrink-0">
          {t('profile.yours')}
        </span>
      )}
      {spot.importedToTripName && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950/30 text-primary border border-orange-200 dark:border-orange-900/50 truncate max-w-[9rem]">
          {t('profile.inYourTrip', { trip: spot.importedToTripName })}
        </span>
      )}
    </span>
  ) : null;

  const trashBtn = !confirming && (
    <button
      aria-label={t('profile.deleteSpot', { title: spot.title })}
      onClick={() => setConfirming(true)}
      disabled={deleting}
      className="w-9 h-9 -m-1.5 rounded-full flex items-center justify-center flex-shrink-0 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40">
      <Trash2 className="w-4 h-4" />
    </button>
  );

  return (
    <div className="relative bg-card">
      {/* Fila pulsable: abre la ficha del spot. */}
      <button onClick={e => { if (isGoogleCardControl(e)) return; onOpenSheet?.(spot); }}
        className={`w-full block px-4 pt-3 text-left hover:bg-secondary/20 transition-colors ${showOwnMeta ? 'pb-1' : 'pb-3'}`}>
        <GooglePlaceCard placeId={placeId} variant="compact" orientation="horizontal" fallback={ownHeader} />
      </button>

      {showOwnMeta ? (
        <div className="flex items-center gap-2 px-4 pb-3 pt-1">
          <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
            {t(tc.tk)}{cityLabel ? ' · ' + cityLabel : ''}
          </span>
          {badges}
          {trashBtn}
        </div>
      ) : (
        // Con ficha de Google: como en Spots, los controles van abajo a la
        // derecha, a la altura de la atribución "Google Maps" (que queda a la
        // izquierda y no se tapa).
        <div className="absolute right-4 bottom-3 flex items-center gap-2">
          {badges}
          {trashBtn}
        </div>
      )}

      {confirming && (
        <div className="px-4 pb-3">
          {inItinerary && (
            <p className="text-xs text-accent-foreground bg-accent border border-orange-200 dark:border-orange-900/50 rounded-lg px-2.5 py-2 mb-2 leading-snug">
              {t('profile.inItineraryWarning', { trip: tripName || t('profile.thisTrip'), date: fmtShortDate(spot.assigned_date, i18n.language) })}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setConfirming(false)} className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border bg-card">
              {t('common.cancel')}
            </button>
            <button
              onClick={() => { onDelete(spot); setConfirming(false); }}
              disabled={deleting}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-destructive text-white disabled:opacity-50">
              {inItinerary ? t('profile.deleteAnyway') : t('common.delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado vacío de la colección
// ─────────────────────────────────────────────────────────────────────────────
function EmptyCollection({ onFocusSearch }) {
  const { t } = useTranslation();
  return (
    <div className="bg-card border border-border rounded-2xl text-center py-9 px-6">
      <div className="w-11 h-11 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
        <MapPin className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold text-foreground mb-1">{t('profile.emptyTitle')}</p>
      <p className="text-xs text-muted-foreground mb-4">{t('profile.emptyHint')}</p>
      <button onClick={onFocusSearch} className="bg-primary text-white text-xs font-semibold px-4 py-2 rounded-full">
        {t('profile.searchCta')}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ficha de detalle de un spot — hasta ahora tocar una fila no hacía nada.
// Muestra foto, dirección, notas y enlace si los hay, y un acceso directo a
// Google Maps (por coordenadas si existen, si no por dirección de texto).
// ─────────────────────────────────────────────────────────────────────────────
function SpotDetailSheet({ spot, onClose }) {
  const { t } = useTranslation();
  const SpotTypeIcon = SPOT_ICONS_MAP[spot.type] || MapPin;
  // José (24 sep 2026): igual que la ficha de Spots -- con place id, la
  // cabecera es la ficha de Google (nombre, foto y estrellas reales); sin él
  // o sin conexión, la cabecera propia de siempre.
  const placeId = googlePlaceIdOf(spot);
  const coverImg = spot.photo_url || spot.image_url || null;

  const mapsUrl = placeId ? getMapsUrl(spot) : (spot.lat && spot.lng)
    ? `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`
    : (spot.address || spot.city_name)
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([spot.address, spot.city_name, spot.country].filter(Boolean).join(', '))}`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card w-full max-w-3xl rounded-t-3xl px-5 pt-3 pb-8 max-h-[85vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="spot-sheet-title">
        <div className="w-9 h-1 rounded-full bg-border mx-auto mb-4" />
        {placeId && (
          <div className="flex justify-end -mt-2 mb-1">
            <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 -m-1 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <GooglePlaceCard placeId={placeId} variant="full" className="mb-3" fallback={
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            {coverImg ? (
              <img src={coverImg} alt={spot.title} loading="lazy" className="w-14 h-14 rounded-2xl object-cover flex-shrink-0" onError={e => { e.currentTarget.style.display = 'none'; }} />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0">
                <SpotTypeIcon size={22} className="text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p id="spot-sheet-title" className="text-base font-semibold text-foreground truncate">{spot.title}</p>
                {typeof spot.rating === 'number' && (
                  <span className="inline-flex items-center gap-0.5 text-sm text-foreground font-medium shrink-0">
                    <Star className="w-3.5 h-3.5 fill-current text-amber-400" />{spot.rating.toFixed(1)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">{[spot.city_name, spot.country].filter(Boolean).join(', ')}</p>
            </div>
          </div>
          {!placeId && (
            <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 -m-1 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        } />

        {!placeId && spot.address && <p className="text-sm text-foreground mb-3">{spot.address}</p>}
        {spot.notes && (
          <p className="text-sm text-muted-foreground bg-secondary/60 rounded-xl px-3 py-2.5 mb-3">{spot.notes}</p>
        )}

        <div className="flex flex-col gap-2 mt-2">
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-primary text-white text-sm font-semibold rounded-full py-3">
              <Navigation className="w-4 h-4" /> {t('profile.openInMaps')}
            </a>
          )}
          {/* spot.link es texto libre que escribe quien crea el spot — nunca
              se renderiza como href sin comprobar antes que es http(s), para
              cerrar el DOM XSS vía esquema URI (ver isSafeHttpUrl). */}
          {spot.link && isSafeHttpUrl(spot.link) && (
            <a href={spot.link} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-card border border-border text-foreground text-sm font-semibold rounded-full py-3">
              <ExternalLink className="w-4 h-4" /> {t('profile.openLink')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}


function UnifiedSearchResults({ query, mineMatches, googleResults, googleLoading, allTitles, savedPlaceIds, onDeleteMine, deletingId, onSaveNew, savingPlaceId, findTripName, onOpenSheet }) {
  const { t } = useTranslation();
  const hasAny = mineMatches.length > 0 || googleResults.length > 0;

  return (
    <div>
      <p className="text-[11px] text-muted-foreground px-1 mb-2">{t('profile.searchHint')}</p>
      {!hasAny && !googleLoading ? (
        <div className="bg-card border border-border rounded-2xl text-center py-8">
          <p className="text-sm text-muted-foreground">{t('profile.noResultsFor', { query })}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
          {mineMatches.map(spot => (
            <CollectionRow
              key={`${spot.owner}-${spot.id}`}
              spot={spot}
              tripName={spot.owner === 'mine' ? findTripName(spot.trip_id) : null}
              onDelete={onDeleteMine}
              deleting={deletingId === spot.id}
              onOpenSheet={onOpenSheet}
            />
          ))}
          {googleResults.map(place => {
            const dup = (place._placeId && savedPlaceIds.has(place._placeId))
              || allTitles.has(place.title.toLowerCase().trim());
            const PlaceIcon = SPOT_ICONS_MAP[place.type] || MapPin;
            return (
              <div key={place.id} className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                  <PlaceIcon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{place.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <span className="truncate">{place.subtitle}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 border ${
                      dup
                        ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900/50'
                        : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50'
                    }`}>
                      {dup ? t('profile.alreadyAdded') : t('profile.newFromGoogle')}
                    </span>
                  </p>
                </div>
                {dup ? (
                  <Star className="w-4 h-4 text-green-600 flex-shrink-0" />
                ) : (
                  <button
                    aria-label={t('profile.saveSpot', { title: place.title })}
                    onClick={() => onSaveNew(place)}
                    disabled={savingPlaceId === place.id}
                    className="w-9 h-9 rounded-full bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/50 flex items-center justify-center flex-shrink-0 disabled:opacity-50">
                    {savingPlaceId === place.id ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Bookmark className="w-4 h-4 text-primary" />}
                  </button>
                )}
              </div>
            );
          })}
          {googleLoading && (
            <div className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto" /></div>
          )}
        </div>
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

  const { data: mySpotsRaw = [] } = useQuery({
    queryKey: ['mySpots', user?.email],
    queryFn: async () => {
      const all = await base44.entities.Spot.filter({ created_by: user.email });
      // Solo cuenta spots creados explícitamente vía el formulario "Crear spot"
      // (source === 'manual').
      return all.filter(s => s.source === 'manual');
    },
    enabled: !!user?.email,
    staleTime: 60000,
  });

  const { data: savedSpotsRaw = [] } = useQuery({
    queryKey: ['savedSpots', user?.id],
    queryFn: () => base44.entities.SavedSpot.filter({ user_id: user.id }),
    enabled: !!user?.id,
    staleTime: 60000,
  });

  const { data: myTrips = [] } = useQuery({
    queryKey: ['myTrips', user?.id, user?.email],
    queryFn: async () => {
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

  const countriesCount = useMemo(() => {
    const fromCities = new Set(myTripCities.map(c => c.country).filter(Boolean));
    const fromSpots = new Set(mySpotsRaw.map(s => s.country).filter(Boolean));
    return new Set([...fromCities, ...fromSpots]).size;
  }, [myTripCities, mySpotsRaw]);

  const findTripName = (tripId) => {
    const trip = myTrips.find(tr => tr.id === tripId);
    return trip?.destination || trip?.name || null;
  };

  // ── Próximo viaje: activo → el próximo por empezar (mismo criterio que el
  // "hero" de TripsList.jsx, reutilizando getTripStatus) ──
  const nextTrip = useMemo(() => {
    const withStatus = myTrips.map(tr => ({ trip: tr, status: getTripStatus(tr) }));
    const active = withStatus.filter(x => x.status?.type === 'active');
    if (active.length) return active[0].trip;
    const upcoming = withStatus
      .filter(x => x.status?.type === 'upcoming')
      .sort((a, b) => a.status.days - b.status.days);
    return upcoming[0]?.trip || null;
  }, [myTrips]);

  const nextTripCountries = useMemo(() => {
    if (!nextTrip) return [];
    return [normalizeCountry(nextTrip.country || ''), normalizeCountry(nextTrip.destination || '')].filter(Boolean);
  }, [nextTrip]);

  const { data: nextTripSpots = [] } = useQuery({
    queryKey: ['nextTripSpots', nextTrip?.id],
    queryFn: () => base44.entities.Spot.filter({ trip_id: nextTrip.id }),
    enabled: !!nextTrip?.id,
    staleTime: 30000,
  });

  const nextTripCities = useMemo(() => myTripCities.filter(c => c.trip_id === nextTrip?.id), [myTripCities, nextTrip]);

  // José (14 sep 2026): ya hay coordenadas reales disponibles (CityInput
  // ahora las resuelve vía Google Places, ver src/lib/cityPlaces.js) --
  // esto sustituye la comparación por nombre de ciudad de ayer por un radio
  // geográfico real. Fórmula de Haversine, sin librería nueva.
  //
  // FALLBACK explícito, a propósito: si el spot guardado o NINGUNA ciudad
  // del viaje tiene coordenadas todavía (registros de antes de este cambio,
  // o escritos a mano sin elegir sugerencia de Google), se cae a comparar
  // por nombre de ciudad normalizado -- exactamente el comportamiento de
  // ayer, no un error ni un "no coincide nunca".
  const MATCH_RADIUS_KM = 50;
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  const stripDiacritics = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const nextTripCityNames = useMemo(() =>
    new Set(nextTripCities.map(c => stripDiacritics(c.name)).filter(Boolean)),
  [nextTripCities]);
  const nextTripCityCoords = useMemo(() =>
    nextTripCities.filter(c => typeof c.lat === 'number' && typeof c.lng === 'number'),
  [nextTripCities]);

  function isNearNextTrip(spot) {
    if (typeof spot.lat === 'number' && typeof spot.lng === 'number' && nextTripCityCoords.length > 0) {
      return nextTripCityCoords.some(c => haversineKm(spot.lat, spot.lng, c.lat, c.lng) <= MATCH_RADIUS_KM);
    }
    // Sin coordenadas en alguno de los dos lados -- respaldo por nombre de
    // ciudad, igual que ayer.
    return !!(spot.city_name && nextTripCityNames.has(stripDiacritics(spot.city_name)));
  }

  // Spots guardados cerca del próximo viaje (radio real por coordenadas
  // cuando hay, nombre de ciudad si no) y que todavía no se han importado
  // (mismo criterio de duplicado por título que usa importSavedSpot en
  // Restaurants.jsx).
  const pendingImportMatches = useMemo(() => {
    if (!nextTrip || (!nextTripCityNames.size && !nextTripCityCoords.length)) return [];
    return savedSpotsRaw.filter(s =>
      isNearNextTrip(s) &&
      !nextTripSpots.some(sp => sp.title?.toLowerCase().trim() === s.title?.toLowerCase().trim())
    );
  }, [savedSpotsRaw, nextTrip, nextTripCityNames, nextTripCityCoords, nextTripSpots]);

  const importMutation = useMutation({
    mutationFn: async () => {
      for (const s of pendingImportMatches) {
        // José (23 sep 2026): ciudad real del viaje (mismo nombre o la más
        // cercana a <= 50 km), mismo criterio que el panel de Spots -- ver
        // src/lib/tripCityMatch.js. Antes caía a la primera ciudad del viaje.
        const targetCity = matchTripCity(s, nextTripCities) || nextTripCities[0] || null;
        // Crea un Spot NUEVO en el viaje destino — nunca borra ni convierte el
        // SavedSpot original (mismo comportamiento que importSavedSpot en
        // Restaurants.jsx, source:'saved_import').
        await base44.entities.Spot.create({
          trip_id: nextTrip.id,
          city_id: targetCity?.id || undefined,
          city_name: targetCity?.name || s.city_name || '',
          country: normalizeCountry(s.country || ''),
          title: s.title,
          type: s.type || 'custom',
          address: s.address || '',
          lat: s.lat, lng: s.lng,
          notes: s.notes || '',
          image_url: s.image_url || null,
          visibility: 'trip_members',
          visited: false,
          created_by: user?.email,
          created_by_user_id: user?.id,
          source: 'saved_import',
          // José (22 sep 2026): "Permission denied for create operation on
          // Spot entity" -- el rls de create de Spot exige que
          // data.trip_members incluya al usuario. Este create nunca lo
          // mandaba (a diferencia de createMutation en Restaurants.jsx, que
          // sí lo inyecta siempre) -- por eso la función de importar nunca
          // funcionó, no es una regresión.
          trip_members: nextTrip?.members || [],
          // José (23 sep 2026): el rating ya no se guarda (términos EEA de
          // Google). Se guarda solo el place id; la ficha de Places UI Kit
          // enseña las estrellas en vivo dentro del viaje.
          ...(s.google_place_id ? { osm_id: s.google_place_id, place_refreshed_at: s.place_refreshed_at || null, title_is_own: !!s.title_is_own } : {}),
        });
      }
    },
    onSuccess: () => {
      const trip = nextTrip?.destination || nextTrip?.name || '';
      toast({ title: t('profile.importSuccess', { count: pendingImportMatches.length, trip }) });
      queryClient.invalidateQueries({ queryKey: ['nextTripSpots', nextTrip?.id] });
    },
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  // ── Colección unificada (guardados + creados) ──
  const [collectionFilter, setCollectionFilter] = useState('saved'); // saved | mine
  const [showSpotTripPicker, setShowSpotTripPicker] = useState(false);
  const [openSpot, setOpenSpot] = useState(null);
  const [countryFilter, setCountryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [googleResults, setGoogleResults] = useState([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [savingPlaceId, setSavingPlaceId] = useState(null);
  const searchInputRef = useRef(null);
  const searchTimerRef = useRef(null);
  const searchAbortRef = useRef(null);

  const allCollection = useMemo(() => [
    ...savedSpotsRaw.map(s => ({ ...s, owner: 'saved' })),
    ...mySpotsRaw.map(s => ({ ...s, owner: 'mine' })),
  ], [savedSpotsRaw, mySpotsRaw]);

  const allTitlesLower = useMemo(
    () => new Set(allCollection.map(s => (s.title || '').toLowerCase().trim())),
    [allCollection]
  );
  // Prioritario sobre allTitlesLower: Autocomplete (New) y Place Details
  // (New) no garantizan el mismo texto de nombre para el mismo sitio real,
  // así que comparar solo por título daba falsos negativos ("ya lo tienes"
  // no se detectaba aunque el usuario acabara de guardarlo). El place_id de
  // Google es estable entre los dos endpoints.
  const savedPlaceIds = useMemo(
    () => new Set(savedSpotsRaw.map(s => s.google_place_id).filter(Boolean)),
    [savedSpotsRaw]
  );

  // Buscador de Google — debounce 600ms, mínimo 3 caracteres, igual que
  // Restaurants.jsx (searchPlaces/700ms). Se corta si se limpia el texto.
  useEffect(() => {
    clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim() || searchQuery.trim().length < 3) { setGoogleResults([]); return undefined; }
    searchTimerRef.current = setTimeout(async () => {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      searchAbortRef.current = new AbortController();
      setGoogleLoading(true);
      try {
        const results = await searchNewPlaces(searchQuery, searchAbortRef.current.signal);
        setGoogleResults(results);
      } catch (e) {
        if (e?.name !== 'AbortError') setGoogleResults([]);
      } finally {
        setGoogleLoading(false);
      }
    }, 600);
    return () => clearTimeout(searchTimerRef.current);
  }, [searchQuery]);

  // El lado "propio" del buscador es puro filtrado en JS sobre datos que ya
  // están cargados (sin llamada de red) — mismo patrón que usa Restaurants.jsx
  // para autocompletar direcciones, pero sin ningún coste porque no toca
  // Google en absoluto.
  const searchMineMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allCollection.filter(s =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.city_name || '').toLowerCase().includes(q) ||
      (s.country || '').toLowerCase().includes(q)
    );
  }, [allCollection, searchQuery]);

  const deleteMutation = useMutation({
    mutationFn: async (spot) => {
      setDeletingId(spot.id);
      if (spot.owner === 'mine') await base44.entities.Spot.delete(spot.id);
      else await base44.entities.SavedSpot.delete(spot.id);
    },
    onSettled: () => setDeletingId(null),
    onSuccess: (_, spot) => {
      queryClient.invalidateQueries({ queryKey: [spot.owner === 'mine' ? 'mySpots' : 'savedSpots'] });
    },
    // Mismo fix que en Restaurants.jsx: un "not found" del backend significa
    // que el registro ya no existe ahí — quitarlo de la caché local en vez
    // de dejarlo atascado mostrando error cada vez que se intenta borrar.
    onError: (e, spot) => {
      const msg = e?.message || '';
      if (/not found/i.test(msg)) {
        const key = spot.owner === 'mine' ? 'mySpots' : 'savedSpots';
        queryClient.setQueryData([key, spot.owner === 'mine' ? user?.email : user?.id], (old) => (Array.isArray(old) ? old.filter(s => s.id !== spot.id) : old));
        return;
      }
      toast({ title: t('common.saveError'), description: msg || t('common.tryAgain'), variant: 'destructive' });
    },
  });

  const saveNewPlaceMutation = useMutation({
    mutationFn: async (place) => {
      setSavingPlaceId(place.id);
      const details = await fetchPlaceDetails(place._placeId);
      await base44.entities.SavedSpot.create({
        user_id: user.id,
        // José (23 sep 2026): nombre = lo que escribió el usuario (contenido
        // suyo); el oficial lo enseña la ficha de Google en vivo. Sin
        // dirección de Google guardada (términos EEA).
        title: searchQuery.trim() || place.title,
        title_is_own: true,
        type: details?.type || place.type || 'custom',
        address: '',
        city_name: details?.city_name || (place.subtitle || '').split(',')[0]?.trim() || '',
        country: normalizeCountry(details?.country || ''),
        lat: details?.lat || null,
        lng: details?.lng || null,
        // José (23 sep 2026): ya no se guarda la foto de Google (y con ella
        // tu API key dentro de la URL) -- términos EEA de Google Maps Platform.
        google_place_id: place._placeId || null,
        // Coordenadas recién pedidas a Google: válidas 30 días (ver refreshPlaceCoordinates).
        ...(details?.lat != null ? { place_refreshed_at: new Date().toISOString() } : {}),
      });
    },
    onSettled: () => setSavingPlaceId(null),
    onSuccess: () => {
      toast({ title: t('profile.savedToCollection') });
      queryClient.invalidateQueries({ queryKey: ['savedSpots', user?.id] });
    },
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const ownerFiltered = useMemo(
    () => allCollection.filter(s => collectionFilter === 'all' || s.owner === collectionFilter),
    [allCollection, collectionFilter]
  );

  // José (14 sep 2026): antes esto era un filtro en dos niveles
  // (continente → país dentro de ese continente) -- "debería ser por país,
  // no por continente", así que se quita el nivel intermedio y los chips
  // van directos a país. Mismo criterio de "se oculta solo si no hace
  // falta" que ya tenía el continente: con un único país entre tus
  // guardados/creados, no se muestra ningún chip.
  const countryGroups = useMemo(() => {
    const g = {};
    ownerFiltered.forEach(s => {
      const c = normalizeCountry(s.country || '') || 'Otros';
      g[c] = (g[c] || 0) + 1;
    });
    return g;
  }, [ownerFiltered]);

  const finalList = useMemo(() => ownerFiltered
    .filter(s => countryFilter === 'all' || normalizeCountry(s.country || '') === countryFilter),
  [ownerFiltered, countryFilter]);

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
        <div className="max-w-3xl mx-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-0">
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('TripsList')}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
              {t('profile.myTrips')}
            </Link>
            <Link to={createPageUrl('Settings')}
              className="flex items-center gap-1.5 text-primary text-sm font-medium hover:text-primary/80 transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              {t('settings.title')}
            </Link>
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-4">{t('profile.title')}</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-5 pb-24 space-y-4">

        {/* ── Identidad compacta ── */}
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full overflow-hidden border border-border flex-shrink-0 flex items-center justify-center bg-primary text-white text-lg font-medium">
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt={displayName} className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />
              : initials}
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

        {/* ── Stats, en su propia franja ── */}
        <div className="flex border-y border-border py-3">
          {[
            { value: tripsCount, label: t('profile.trips') },
            { value: allCollection.length, label: t('profile.mySpots') },
            { value: countriesCount, label: t('profile.countries') },
          ].map((stat, i) => (
            <div key={stat.label} className={`flex-1 text-center ${i > 0 ? 'border-l border-border' : ''}`}>
              <p className="text-base font-semibold text-foreground">{stat.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* ── Aviso de importación — solo si hay coincidencias reales pendientes ── */}
        {nextTrip && pendingImportMatches.length > 0 && (
          <div className="bg-accent border border-orange-200 dark:border-orange-900/50 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-card flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-accent-foreground" />
            </div>
            <p className="text-xs font-semibold text-accent-foreground leading-snug flex-1">
              {t('profile.importBanner', {
                count: pendingImportMatches.length,
                country: getCountryLabel(nextTripCountries[0], i18n.language),
                trip: nextTrip.destination || nextTrip.name,
              })}
            </p>
            <button
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
              className="bg-primary text-white text-xs font-semibold px-3 py-2 rounded-full flex-shrink-0 disabled:opacity-50">
              {importMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('profile.importBtn')}
            </button>
          </div>
        )}

        {/* ── Mi colección ── */}
        <div>
          <h2 className="text-sm font-bold text-foreground mb-2.5">{t('profile.myCollection')}</h2>

          {/* Buscador único: colección propia + sitios nuevos de Google, sin distinción de pantalla */}
          <div className="bg-card border border-border rounded-full px-3.5 py-2.5 flex items-center gap-2 mb-3">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label={t('profile.unifiedSearchPlaceholder')}
              placeholder={t('profile.unifiedSearchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder-muted-foreground"
            />
            {searchQuery && (
              <button aria-label={t('common.clear')} onClick={() => setSearchQuery('')} className="flex-shrink-0 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {searchQuery.trim() ? (
            <UnifiedSearchResults
              query={searchQuery}
              mineMatches={searchMineMatches}
              googleResults={googleResults}
              googleLoading={googleLoading}
              allTitles={allTitlesLower}
              savedPlaceIds={savedPlaceIds}
              onDeleteMine={spot => deleteMutation.mutate(spot)}
              deletingId={deletingId}
              onSaveNew={place => saveNewPlaceMutation.mutate(place)}
              savingPlaceId={savingPlaceId}
              findTripName={findTripName}
              onOpenSheet={setOpenSpot}
            />
          ) : allCollection.length === 0 ? (
            <EmptyCollection onFocusSearch={() => searchInputRef.current?.focus()} />
          ) : (
            <>
              {/* José (15 sep 2026): "Todos, Guardados y Creados no tiene
                  sentido, que sea solo Guardados y Creados. Además el
                  sistema para navegar de una pestaña a otra es incorrecto,
                  no sigue el formato Ō -- debería ser igual que en Gastos"
                  -- mismo componente OTabBar que ya usa Expenses.jsx, en
                  vez de las pastillas hechas a mano de aquí. */}
              <OTabBar
                tabs={[
                  { key: 'saved', label: `${t('profile.saved')} · ${savedSpotsRaw.length}` },
                  { key: 'mine', label: `${t('profile.created')} · ${mySpotsRaw.length}` },
                ]}
                activeKey={collectionFilter === 'all' ? 'saved' : collectionFilter}
                onChange={(key) => { setCollectionFilter(key); setCountryFilter('all'); }}
              />
              <div className="mb-3" />

              {Object.keys(countryGroups).length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
                  <button onClick={() => setCountryFilter('all')}
                    className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${countryFilter === 'all' ? 'bg-primary text-white border-primary' : 'bg-background border-border text-muted-foreground'}`}>
                    {t('common.all')} · {ownerFiltered.length}
                  </button>
                  {Object.entries(countryGroups).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                    <button key={c} onClick={() => setCountryFilter(c)}
                      className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${countryFilter === c ? 'bg-primary text-white border-primary' : 'bg-background border-border text-muted-foreground'}`}>
                      {countryFlag(c)} {getCountryLabel(c, i18n.language)} · {n}
                    </button>
                  ))}
                </div>
              )}
              {finalList.length === 0 ? (
                collectionFilter === 'mine' ? (
                  // José (15 sep 2026): un spot "creado" es lo contrario de
                  // uno guardado -- no está en ningún buscador, lo conoces
                  // tú. El hueco vacío tenía que empujar a esa idea, no ser
                  // un genérico "nada por aquí".
                  <div className="bg-card border border-dashed border-border rounded-2xl text-center py-8 px-5">
                    <p className="text-sm font-semibold text-foreground mb-1.5">{t('profile.createdEmptyTitle')}</p>
                    <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{t('profile.createdEmptyBody')}</p>
                    {/* José (16 sep 2026): "manda a TripsList, no actúa como
                        en Spots" -- tenía razón, un spot necesita un viaje
                        al que pertenecer y mandar a la lista general sin
                        más no es "crear". Si tiene viajes, elige uno aquí
                        mismo y va directo a esa pantalla de Spots lista
                        para buscar/crear; si no tiene ninguno, ahí sí hace
                        falta crear un viaje primero. */}
                    {myTrips.length > 0 ? (
                      <div className="relative inline-block">
                        <button onClick={() => setShowSpotTripPicker(v => !v)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-full">
                          <CirclePlus className="w-3.5 h-3.5" />{t('profile.createSpotCta')}
                        </button>
                        {showSpotTripPicker && (
                          <div className="absolute z-20 top-full mt-1.5 left-1/2 -translate-x-1/2 w-52 bg-card border border-border rounded-xl shadow-lg overflow-hidden text-left">
                            {myTrips.map(tr => (
                              <Link key={tr.id} to={createPageUrl('Restaurants') + `?trip_id=${tr.id}`}
                                className="block px-3 py-2 text-xs text-foreground hover:bg-secondary/40 border-b border-border last:border-0">
                                {tr.name}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Link to={createPageUrl('TripsList')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-full">
                        <CirclePlus className="w-3.5 h-3.5" />{t('profile.createTripFirstCta')}
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="bg-card border border-border rounded-2xl text-center py-8">
                    <p className="text-sm text-muted-foreground">{t('profile.emptyHere')}</p>
                  </div>
                )
              ) : (
                <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
                  {finalList.map(spot => (
                    <CollectionRow
                      key={`${spot.owner}-${spot.id}`}
                      spot={spot}
                      tripName={spot.owner === 'mine' ? findTripName(spot.trip_id) : null}
                      onDelete={s => deleteMutation.mutate(s)}
                      deleting={deletingId === spot.id}
                      onOpenSheet={setOpenSpot}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

      </div>

      {openSpot && (
        <SpotDetailSheet spot={openSpot} onClose={() => setOpenSpot(null)} />
      )}
    </div>
  );
}
