import { PlaneIcon } from '@/lib/icons';
import Logo from '@/components/Logo';
import { useMemo, useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import NotificationBell from '@/components/notifications/NotificationBell';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Map, Plus, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import TripCard, { HeroTripCard, getTripStatus } from '@/components/trip/TripCard';
import { applyCityDates } from '@/lib/tripDates';
import NewTripModal from '@/components/trip/NewTripModal';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import CreateProfileModal from '@/components/social/CreateProfileModal';
import { createPageUrl } from '@/utils';
import { normalizeCountry } from '@/lib/countryConfig';
import { matchTripCity } from '@/lib/tripCityMatch';
import { sendTripInvite } from '@/lib/invites';
import { normalizeEmail } from '@/lib/utils';
import { computeEditors } from '@/lib/syncTripMembers';
import { useTranslation } from 'react-i18next';

function getGreeting(t) {
  const h = new Date().getHours();
  if (h < 13) return t('tripslist.goodMorning');
  if (h < 21) return t('tripslist.goodAfternoon');
  return t('tripslist.goodEvening');
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ onCreateTrip }) {
  const { t } = useTranslation();
  return (
    <div className="border border-dashed border-border rounded-2xl p-8 text-center bg-card">
      <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-3"><PlaneIcon className="w-7 h-7 text-muted-foreground/50" /></div>
      <p className="text-sm font-medium text-foreground mb-1">{t('tripslist.whereAreWeGoing')}</p>
      <p className="text-xs text-muted-foreground mb-5">{t('tripslist.noTripsSubtitle')}</p>
      <button onClick={onCreateTrip}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm rounded-full font-medium hover:bg-primary/90 transition-colors">
        <Plus className="w-4 h-4" />{t('tripslist.newTrip')}
      </button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TripsList() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen]           = useState(false);
  const [newTripPopup, setNewTripPopup]       = useState(null); // { trip, cities, spots, country }
  const [importingSaved, setImportingSaved]   = useState(false);
  const [showPast, setShowPast] = useState(false);
  // CreateProfileModal crea el perfil e invalida la query de `myProfile` para
  // pasar a las slides de "tour" (2-5) — pero esa misma invalidación hace que
  // `needsOnboarding` (que depende de myProfile === null) pase a false casi
  // al instante, desmontando el modal entero antes de que el usuario llegue
  // a verlas. Este flag local separa "ya se completó el onboarding" de "ya
  // existe el perfil en caché", para que el modal no desaparezca solo.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // AuthContext nunca expuso una clave "isLoading" (solo isLoadingAuth /
  // isLoadingPublicSettings) — desestructurarla así dejaba userLoading
  // siempre en undefined, así que el gate de carga de abajo (isLoading ||
  // userLoading) no bloqueaba nada realmente ligado al estado de auth: podía
  // parpadear el estado vacío ("crea tu primer viaje") en cada arranque
  // aunque el usuario sí tuviera viajes, hasta que la sesión terminaba de
  // resolverse.
  const { user, isLoadingAuth } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const { data: myProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['myProfile', user?.id],
    queryFn: async () => {
      const r = await base44.entities.UserProfile.filter({ user_id: user.id });
      return r[0] || null;
    },
    enabled: !!user?.id && user?.is_verified === true,
    staleTime: 60000,
  });

  const { data: trips = [], isLoading } = useQuery({
    queryKey: ['trips', user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      // Antes cualquiera de los dos catch {} tragaba el error y dejaba esa
      // mitad como [] silenciosamente — un fallo de red puntual hacía que el
      // usuario viera "crea tu primer viaje" como si no tuviera ninguno, sin
      // ningún aviso. Se avisa con un toast si alguna de las dos falla, pero
      // se sigue devolviendo lo que sí se pudo cargar (mejor una lista
      // parcial que una pantalla de error).
      let hadError = false;
      // Fetch trips created by user
      let myTrips = [];
      try { myTrips = await base44.entities.Trip.filter({ created_by: user.email }); } catch { hadError = true; }
      // Fetch trips where user is a member — filtrado server-side con $elemMatch.
      // trip.members está guardado en minúsculas; user.email tal cual viene
      // del proveedor de auth no siempre lo está — antes esto usaba el email
      // en crudo, así que un invitado (no el creador) con un email de
      // distinto casing simplemente no veía ese viaje en "Mis viajes".
      const myEmailNorm = normalizeEmail(user.email);
      let memberTrips = [];
      try {
        const all = await base44.entities.Trip.filter(
          { members: { $elemMatch: { $eq: myEmailNorm } } },
          '-created_date'
        );
        memberTrips = all.filter(tr => normalizeEmail(tr.created_by) !== myEmailNorm);
      } catch { hadError = true; }
      if (hadError) {
        toast({ title: t('common.error'), description: t('common.tryAgain'), variant: 'destructive' });
      }
      const seen = new Set(myTrips.map(tr => tr.id));
      return [...myTrips, ...memberTrips.filter(tr => !seen.has(tr.id))]
        .sort((a,b) => new Date(b.created_date||0) - new Date(a.created_date||0));
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  // Only fetch cities for the user's own trips, not all cities globally
  const { data: allCities = [] } = useQuery({
    queryKey: ['allCities', trips.map(tr => tr.id).join(',')],
    queryFn: async () => {
      if (!trips.length) return [];
      const tripIds = trips.map(tr => tr.id);
      const results = await Promise.all(
        tripIds.map(id => base44.entities.City.filter({ trip_id: id }).catch(() => []))
      );
      return results.flat();
    },
    enabled: trips.length > 0,
    staleTime: 60000,
  });

  const createMutation = useMutation({
    mutationFn: async ({ formData, stops, stopCountries = [], stopCoords = [], allocations, invitees = [] }) => {
      // UserProfile.email siempre se guarda en minúsculas (migración en
      // App.jsx), pero user.email viene tal cual del proveedor de auth — si
      // aquí se guarda sin normalizar, el propio creador del viaje queda con
      // una entrada en trip.members que nunca hace match con su UserProfile,
      // y su avatar en el propio viaje que acaba de crear muestra el email en
      // crudo en vez de su nombre.
      const email = normalizeEmail(user?.email);

      // Auto-detect best base currency from creator's home_currency
      let baseCurrency = formData.currency || 'EUR';
      let myProfile = null;
      try {
        const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
        myProfile = profiles[0];
        if (myProfile?.home_currency && !formData.currencyTouched) {
          baseCurrency = myProfile.home_currency;
        }
      } catch {}

      // José (24 sep 2026): las fechas del viaje salen de las paradas y
      // pueden no existir aún ("fechas por confirmar"): no se mandan vacías.
      const { start_date: tripStart, end_date: tripEnd, ...restForm } = formData;
      const trip = await base44.entities.Trip.create({
        ...restForm,
        ...(tripStart ? { start_date: tripStart } : {}),
        ...(tripEnd ? { end_date: tripEnd } : {}),
        currency: baseCurrency,
        base_currency: baseCurrency,
        members: email ? [email] : [],
        roles: email ? { [email]: 'admin' } : {},
        // admins mantiene una copia en array de quién tiene role 'admin' en
        // `roles` — el rls de Trip.update ahora exige estar en este array
        // (ver el comentario en Trip.jsonc), así que tiene que fijarse aquí
        // desde el primer momento, igual que roles.
        admins: email ? [email] : [],
      });
      const createdCities = [];
      for (let i = 0; i < stops.length; i++) {
        const dates = allocations[i] || {};
        const createdCity = await base44.entities.City.create({
          trip_id: trip.id, name: stops[i],
          country: normalizeCountry(stopCountries[i] || formData.country || ''),
          // José (14 sep 2026): coordenadas reales si CityInput las
          // resolvió vía Google Places -- ver el comentario largo en
          // cityPlaces.js. undefined si esa parada se escribió a mano sin
          // elegir sugerencia; Base44 simplemente no guarda el campo en
          // ese caso, no revienta nada.
          lat: stopCoords[i]?.lat,
          lng: stopCoords[i]?.lng,
          // Place id (lo único de Google que se guarda sin límite) para
          // refrescar las coordenadas antes de 30 días (refreshPlaceCoordinates).
          place_id: stopCoords[i]?.placeId,
          place_refreshed_at: stopCoords[i]?.lat != null ? new Date().toISOString() : undefined,
          order: i,
          ...(dates.start_date ? { start_date: dates.start_date } : {}),
          ...(dates.end_date ? { end_date: dates.end_date } : {}),
          trip_members: trip.members || [],
          trip_editors: computeEditors(trip.members || [], trip),
        });
        if (createdCity) createdCities.push(createdCity);
      }

      // Invitaciones preparadas en el formulario (NewTripInvitees): mismo
      // camino que Ajustes del viaje (sendTripInvite). Una que falle no
      // tumba la creación del viaje: se cuenta y se avisa.
      let invitesSent = 0, invitesFailed = 0;
      const inviterName = myProfile?.display_name || myProfile?.username || email;
      for (const inv of invitees) {
        try {
          await sendTripInvite({
            tripId: trip.id,
            email: inv.targetUserId ? undefined : inv.email,
            targetUserId: inv.targetUserId,
            role: inv.role || 'editor',
            tripName: trip.name,
            inviterEmail: email,
            inviterName,
          });
          invitesSent++;
        } catch (e) {
          console.warn('[TripsList] invitación fallida al crear viaje:', e);
          invitesFailed++;
        }
      }
      return { trip, cities: createdCities, invitesSent, invitesFailed };
    },
    onSuccess: async ({ trip, cities, invitesSent = 0, invitesFailed = 0 }) => {
      queryClient.invalidateQueries({ queryKey: ['trips', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['allCities'] });
      setDialogOpen(false);
      if (invitesSent > 0) toast({ title: t('newTripInvites.sentToast', { count: invitesSent }) });
      if (invitesFailed > 0) toast({ title: t('newTripInvites.failedToast', { count: invitesFailed }), description: t('newTripInvites.failedDesc'), variant: 'destructive' });
      // Buscar en la wishlist personal del usuario si tiene spots guardados para este destino
      try {
        // Todos los países del viaje (multi-país incluido), no solo el primero.
        const countries = [...new Set([
          normalizeCountry(trip.country || ''),
          ...cities.map(c => normalizeCountry(c.country || '')),
        ].filter(Boolean))];
        if (!countries.length || !user?.id) return;
        const mySaved = await base44.entities.SavedSpot.filter({ user_id: user.id });
        // José (24 sep 2026): mismo criterio que Perfil y Spots
        // (src/lib/tripCityMatch.js) -- solo cuenta lo que de verdad cae en
        // una ciudad del viaje. Antes contaba todo el país y el popup
        // prometía spots que luego no se podían importar.
        const matching = mySaved.filter(s =>
          s.country && countries.includes(normalizeCountry(s.country)) && !!matchTripCity(s, cities));
        if (matching.length > 0) {
          setNewTripPopup({ trip, cities, spots: matching, country: countries[0] });
        }
      } catch {
        // silencioso — el popup es una mejora, no crítico
      }
    },
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  // José (24 sep 2026): "Importar" del popup de viaje nuevo no importaba
  // nada -- solo llevaba a Spots con un panel donde había que volver a
  // pulsar "+" en cada spot, y ese panel dependía de un parámetro de la URL:
  // al volver a Spots ya no estaba y parecía que el spot había desaparecido.
  // Ahora el botón importa de verdad (mismos campos que el import de Perfil
  // y Spots: Spot NUEVO en el viaje, el SavedSpot original no se toca) y
  // después lleva a Spots.
  const importSavedIntoNewTrip = async () => {
    if (!newTripPopup || importingSaved) return;
    const { trip, cities, spots } = newTripPopup;
    setImportingSaved(true);
    let imported = 0;
    try {
      for (const s of spots) {
        const targetCity = matchTripCity(s, cities);
        if (!targetCity) continue;
        await base44.entities.Spot.create({
          trip_id: trip.id,
          city_id: targetCity.id,
          city_name: targetCity.name,
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
          // El rls de create de Spot exige que trip_members incluya al usuario.
          trip_members: trip.members || [],
          // Términos EEA de Google: solo el place id; la ficha de UI Kit
          // enseña nombre/estrellas en vivo dentro del viaje.
          ...(s.google_place_id ? { osm_id: s.google_place_id, place_refreshed_at: s.place_refreshed_at || null, title_is_own: !!s.title_is_own } : {}),
        });
        imported++;
      }
      toast({ title: t('profile.importSuccess', { count: imported, trip: trip.destination || trip.name || '' }) });
      queryClient.invalidateQueries({ queryKey: ['spots', trip.id] });
      setNewTripPopup(null);
      navigate(createPageUrl('Restaurants') + '?trip_id=' + trip.id);
    } catch (e) {
      // Los que ya se crearon se quedan: se avisa y se refresca igualmente.
      if (imported > 0) queryClient.invalidateQueries({ queryKey: ['spots', trip.id] });
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    } finally {
      setImportingSaved(false);
    }
  };

  // Classify trips
  const { heroTrips, heroCitiesById, upcomingTrips, pastTrips, singleActiveTripId, heroIsPastFallback } = useMemo(() => {
    // Fechas efectivas: si el viaje tiene paradas con fechas, mandan las de las
    // paradas (tripDates.js) — el estado activo/finalizado no depende de una
    // copia que puede haberse quedado atrás.
    const withStatus = trips.map(tr => {
      const cs = allCities.filter(c => c.trip_id === tr.id);
      const eff = applyCityDates(tr, cs);
      return { t: eff, cities: cs, status: getTripStatus(eff) };
    });

    const active   = withStatus.filter(x => x.status?.type === 'active');
    // José (24 sep 2026): un viaje con "fechas por confirmar" (sin fechas
    // todavía) es un viaje FUTURO: va al final de Próximos, no a Pasados.
    const upcoming = [
      ...withStatus.filter(x => x.status?.type === 'upcoming').sort((a,b) => a.status.days - b.status.days),
      ...withStatus.filter(x => !x.status && !x.t.start_date),
    ];
    const past     = withStatus.filter(x => x.status?.type === 'past' || (!x.status && x.t.start_date))
      // José (16 sep 2026): "Londres sale encima de Dublín pero Londres fue
      // antes" -- Pasados nunca se ordenaba, se quedaba con el orden en
      // que llegaban de la API (ni por fecha ni por nada). Se ordena por
      // fecha de fin real, el más reciente primero -- no depende de
      // interpretar el signo de status.days (que es para el contador de
      // "faltan/hace X días", no pensado para ordenar una lista).
      .sort((a, b) => (b.t.end_date || b.t.start_date || '').localeCompare(a.t.end_date || a.t.start_date || ''));

    // José (14 sep 2026): antes solo el PRIMER viaje activo se trataba como
    // hero -- si había un segundo viaje activo a la vez (posible, nada
    // impide solapar fechas entre dos viajes, ver comentario del
    // auto-redirect más abajo) no encajaba en ninguna lista y desaparecía
    // de la pantalla sin más. Ahora TODOS los activos son hero con el
    // mismo peso visual -- José: "si hay 2 viajes activos, los dos deberían
    // tener el mismo peso [...] los dos igual que el de arriba".
    // Sin ningún activo, el hero sigue siendo el próximo más cercano (uno
    // solo, como antes) o, en su defecto, no hay hero y se muestra el CTA
    // de "todos finalizados".
    let heroes = [];
    if (active.length > 0) heroes = active;
    else if (upcoming.length > 0) heroes = [upcoming[0]];

    const heroIds = new Set(heroes.map(x => x.t.id));
    const upcomingRest = upcoming.filter(x => !heroIds.has(x.t.id));
    const heroCitiesById = {};
    heroes.forEach(x => { heroCitiesById[x.t.id] = x.cities; });

    return {
      heroTrips:    heroes.map(x => x.t),
      heroCitiesById,
      upcomingTrips: upcomingRest,
      pastTrips:    past,
      // Solo con exactamente UN viaje activo tiene sentido saltar
      // directamente a él al abrir la app -- con 0 o 2+ (raro, pero
      // posible con varios viajes solapados) no hay a cuál ir sin
      // preguntar, así que se deja null y TripsList se muestra normal.
      singleActiveTripId: active.length === 1 ? active[0].t.id : null,
      // José (14 sep 2026): cuando no hay ningún hero (nada activo ni
      // próximo) es precisamente el momento en que "Nuevo viaje" debería
      // ser LA acción principal de la pantalla -- CTA arriba en vez de
      // tarjeta hero, con su propio texto, igual que EmptyState (0 viajes).
      heroIsPastFallback: heroes.length === 0 && past.length > 0,
    };
  }, [trips, allCities]);

  // José (14 sep 2026): si hay exactamente un viaje activo, entrar
  // directamente a su Home al ABRIR la app, saltándose esta pantalla --
  // pero solo al aterrizar en "/" (arranque real de la app), nunca cuando
  // el usuario navega aquí a propósito desde "Mis viajes" (que usa la ruta
  // explícita /TripsList, ver Layout.jsx), o quedaría atrapado sin poder
  // volver nunca a la lista. Una vez por sesión (sessionStorage, se
  // resetea al matar y reabrir la app de verdad) para no re-saltar si el
  // usuario vuelve aquí más tarde con el botón atrás del navegador.
  const autoRedirectedRef = useRef(false);
  useEffect(() => {
    if (autoRedirectedRef.current) return;
    if (location.pathname !== '/') return;
    if (!singleActiveTripId) return;
    if (sessionStorage.getItem('kodo_auto_redirect_done') === '1') return;
    autoRedirectedRef.current = true;
    sessionStorage.setItem('kodo_auto_redirect_done', '1');
    navigate(createPageUrl(`Home?trip_id=${singleActiveTripId}`), { replace: true });
  }, [singleActiveTripId, location.pathname, navigate]);

  const needsOnboarding = user?.is_verified === true && !profileLoading && myProfile === null;
  const firstName = myProfile?.display_name?.split(' ')[0] || user?.full_name?.split(' ')[0] || '';

  // `onboardingDismissed` (arriba) solo evita que el modal reaparezca DESPUÉS
  // de onComplete — pero `needsOnboarding` se calcula a partir de
  // `myProfile === null`, y CreateProfileModal crea el perfil a mitad del
  // tour (slide 1→2, antes de las 4 slides de "Grupo/Preparativos/Gastos/
  // Hoy"). En cuanto se crea, needsOnboarding pasa a false y `needsOnboarding
  // && !onboardingDismissed` ya da false aunque onboardingDismissed siga
  // siendo false — el modal se desmontaba solo y esas 4 slides no las veía
  // nadie. Este "latch" separa "hizo falta enseñar el onboarding alguna vez
  // en esta sesión" de "myProfile sigue siendo null ahora mismo", así el
  // modal no desaparece hasta que el propio usuario llega al final (onComplete).
  const onboardingStartedRef = useRef(false);
  if (needsOnboarding) onboardingStartedRef.current = true;
  const showOnboarding = onboardingStartedRef.current && !onboardingDismissed;

  // Loading
  if (isLoading || isLoadingAuth) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">{t('tripslist.loading')}</p>
      </div>
    </div>
  );



  const pastCount = pastTrips.length;

  return (
    <div className="min-h-screen bg-background">
      {showOnboarding && (
        <CreateProfileModal user={user} open={true} onComplete={() => setOnboardingDismissed(true)} />
      )}

      {/* ── Header ── */}
      <div className="bg-background border-b border-border sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Logo className="h-6 w-auto text-foreground" style={{ display: 'block' }} />
                <span className="text-[10px] font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5 leading-none">{t('common.beta')}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Travel your way</p>
              {firstName && (
                <p className="text-sm text-muted-foreground mt-2">{getGreeting(t)}, {firstName}</p>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <NotificationBell userId={user?.id} userEmail={user?.email} />

              {/* Avatar → directo a perfil */}
              <Link to={createPageUrl('Profile')}>
                <div className="w-9 h-9 rounded-full overflow-hidden border border-border flex items-center justify-center bg-primary text-white text-sm font-medium flex-shrink-0">
                  {myProfile?.avatar_url
                    ? <img src={myProfile.avatar_url} alt="avatar" className="w-full h-full object-cover"/>
                    : (firstName?.[0]?.toUpperCase() || '?')
                  }
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-3xl mx-auto px-4 py-5 pb-24 space-y-4">
        {trips.length === 0 ? (
          <EmptyState onCreateTrip={() => setDialogOpen(true)} />
        ) : (
          <>
            {heroIsPastFallback ? (
              // Sin nada activo ni próximo: el CTA de "nuevo viaje" pasa a
              // ser lo primero que se ve (mismo tratamiento que EmptyState,
              // con su propio texto), en vez de la tarjeta del último viaje
              // ya acabado -- José: "el botón nuevo viaje debería estar
              // arriba parecido al de ningún viaje con texto actualizado".
              <div className="border border-dashed border-border rounded-2xl p-8 text-center bg-card">
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-3"><PlaneIcon className="w-7 h-7 text-muted-foreground/50" /></div>
                <p className="text-sm font-medium text-foreground mb-1">{t('tripslist.allFinishedTitle')}</p>
                <p className="text-xs text-muted-foreground mb-5">{t('tripslist.allFinishedSubtitle')}</p>
                <button onClick={() => setDialogOpen(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm rounded-full font-medium hover:bg-primary/90 transition-colors">
                  <Plus className="w-4 h-4" />{t('tripslist.newTrip')}
                </button>
              </div>
            ) : (
              <>
                {/* Hero(es) -- José (14 sep 2026): con 2+ viajes activos a la
                    vez (posible, nada impide solapar fechas) los dos se
                    muestran con el mismo peso visual, ninguno "gana" sobre
                    el otro. Con 0 o 1 activo es un solo hero, como antes. */}
                {heroTrips.map(trip => (
                  <HeroTripCard key={trip.id} trip={trip} cities={heroCitiesById[trip.id] || []} />
                ))}

                {/* Upcoming (excluding hero) */}
                {upcomingTrips.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">{t('tripslist.upcoming')}</p>
                    {upcomingTrips.map(({ t, cities }) => (
                      <TripCard key={t.id} trip={t} cities={cities} />
                    ))}
                  </div>
                )}

                {/* New trip button -- José (14 sep 2026): "no me gusta que
                    el botón cambie, debería estar siempre como el de todos
                    finalizados" -- pastilla sólida siempre, ya no discontinua
                    en ningún caso. */}
                <button onClick={() => setDialogOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full text-sm text-white font-medium bg-primary hover:bg-primary/90 transition-colors">
                  <Plus className="w-4 h-4" />{t('tripslist.newTrip')}
                </button>
              </>
            )}

            {/* Past trips — José (14 sep 2026): "debería ser igual en
                próximos y finalizados [...] que salgan debajo todos, con un
                desplegar y compactar" -- mismo tratamiento de sección
                (etiqueta + lista) que "Próximos" en vez del recuadro con
                icono de archivo, con un simple enlace de texto para
                desplegar/ocultar. */}
            {pastCount > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('tripslist.past')}</p>
                  <button onClick={() => setShowPast(p => !p)} className="text-xs font-medium text-primary">
                    {showPast ? t('tripslist.hidePast') : t('tripslist.viewAllPast', { count: pastCount })}
                  </button>
                </div>
                {showPast && pastTrips.map(({ t, cities }) => (
                  <TripCard key={t.id} trip={t} cities={cities} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <NewTripModal
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={data => createMutation.mutate(data)}
        isPending={createMutation.isPending}
      />

      {/* ── Post-creation spot discovery popup ─────────────────────── */}
      {newTripPopup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 pb-[80px]"
          onClick={() => { if (!importingSaved) setNewTripPopup(null); }}>
          <div className="bg-card w-full max-w-lg rounded-t-3xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="pt-3 pb-0 flex justify-center">
              <div className="w-9 h-1 rounded-full bg-border" />
            </div>
            <div className="px-5 py-5">
              <Map className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-base font-medium text-foreground mb-1">
                {t('tripslist.savedSpots', { count: newTripPopup.spots.length, country: newTripPopup.country })}
              </p>
              <p className="text-sm text-muted-foreground mb-5">
                {t('tripslist.importSpots')}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setNewTripPopup(null)}
                  disabled={importingSaved}
                  className="flex-1 py-3 bg-secondary border border-border rounded-full text-sm text-muted-foreground disabled:opacity-50"
                >
                  {t('tripslist.notNow')}
                </button>
                <button
                  onClick={importSavedIntoNewTrip}
                  disabled={importingSaved}
                  className="flex-1 py-3 bg-primary text-white rounded-full text-sm font-semibold text-center inline-flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {importingSaved && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('tripslist.importNow')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}