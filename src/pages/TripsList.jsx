import { PlaneIcon } from '@/lib/icons';
import Logo from '@/components/Logo';
import { useMemo, useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import NotificationBell from '@/components/notifications/NotificationBell';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Map, Plus } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import TripCard, { HeroTripCard, getTripStatus } from '@/components/trip/TripCard';
import NewTripModal from '@/components/trip/NewTripModal';
import { Link, useNavigate } from 'react-router-dom';
import CreateProfileModal from '@/components/social/CreateProfileModal';
import { createPageUrl } from '@/utils';
import { normalizeCountry } from '@/lib/countryConfig';
import { normalizeEmail } from '@/lib/utils';
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
  const [newTripPopup, setNewTripPopup]       = useState(null); // { trip, spotCount, country }
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
    mutationFn: async ({ formData, stops, stopCountries = [], allocations }) => {
      // UserProfile.email siempre se guarda en minúsculas (migración en
      // App.jsx), pero user.email viene tal cual del proveedor de auth — si
      // aquí se guarda sin normalizar, el propio creador del viaje queda con
      // una entrada en trip.members que nunca hace match con su UserProfile,
      // y su avatar en el propio viaje que acaba de crear muestra el email en
      // crudo en vez de su nombre.
      const email = normalizeEmail(user?.email);

      // Auto-detect best base currency from creator's home_currency
      let baseCurrency = formData.currency || 'EUR';
      try {
        const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
        const myProfile = profiles[0];
        if (myProfile?.home_currency && !formData.currencyTouched) {
          baseCurrency = myProfile.home_currency;
        }
      } catch {}

      const trip = await base44.entities.Trip.create({
        ...formData,
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
      for (let i = 0; i < stops.length; i++) {
        const dates = allocations[i] || { start_date: formData.start_date, end_date: formData.end_date };
        await base44.entities.City.create({
          trip_id: trip.id, name: stops[i],
          country: normalizeCountry(stopCountries[i] || formData.country || ''),
          order: i,
          start_date: dates.start_date, end_date: dates.end_date,
          trip_members: trip.members || [],
        });
      }
      return trip;
    },
    onSuccess: async (trip) => {
      queryClient.invalidateQueries({ queryKey: ['trips', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['allCities'] });
      setDialogOpen(false);
      // Buscar en la wishlist personal del usuario si tiene spots guardados para este destino
      try {
        const countries = [
          normalizeCountry(trip.country || ''),
          normalizeCountry(trip.destination || ''),
        ].filter(Boolean);
        if (!countries.length || !user?.id) return;
        const mySaved = await base44.entities.SavedSpot.filter({ user_id: user.id });
        const matching = mySaved.filter(s => s.country && countries.includes(normalizeCountry(s.country)));
        if (matching.length > 0) {
          setNewTripPopup({ trip, spotCount: matching.length, country: countries[0] });
        }
      } catch {
        // silencioso — el popup es una mejora, no crítico
      }
    },
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  // Classify trips
  const { heroTrip, heroCities, upcomingTrips, pastTrips } = useMemo(() => {
    const withStatus = trips.map(tr => ({
      t: tr,
      cities: allCities.filter(c => c.trip_id === tr.id),
      status: getTripStatus(tr),
    }));

    const active   = withStatus.filter(x => x.status?.type === 'active');
    const upcoming = withStatus.filter(x => x.status?.type === 'upcoming')
      .sort((a,b) => a.status.days - b.status.days);
    const past     = withStatus.filter(x => x.status?.type === 'past' || !x.status);

    // Hero priority: active → soonest upcoming → most recent past
    let hero = null;
    if (active.length > 0) hero = active[0];
    else if (upcoming.length > 0) hero = upcoming[0];
    else if (past.length > 0) hero = past[0];

    // Remove hero from upcoming list
    const heroId = hero?.t?.id;
    const upcomingRest = upcoming.filter(x => x.t.id !== heroId);

    return {
      heroTrip:     hero?.t || null,
      heroCities:   hero?.cities || [],
      upcomingTrips: upcomingRest,
      pastTrips:    past,
    };
  }, [trips, allCities]);

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
            {/* Hero — always shown */}
            {heroTrip && <HeroTripCard trip={heroTrip} cities={heroCities} />}

            {/* Upcoming (excluding hero) */}
            {upcomingTrips.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">{t('tripslist.upcoming')}</p>
                {upcomingTrips.map(({ t, cities }) => (
                  <TripCard key={t.id} trip={t} cities={cities} />
                ))}
              </div>
            )}

            {/* New trip button */}
            <button onClick={() => setDialogOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-border rounded-2xl text-sm text-primary font-medium bg-card hover:bg-orange-50 dark:hover:bg-primary/10 transition-colors">
              <Plus className="w-4 h-4" />{t('tripslist.newTrip')}
            </button>

            {/* Past trips — collapsible */}
            {pastCount > 0 && (
              <div>
                <button
                  onClick={() => setShowPast(p => !p)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-card border border-border rounded-2xl text-sm text-muted-foreground hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <Archive className="w-4 h-4 text-muted-foreground" />
                    <span>{t('tripslist.pastTrips', { count: pastCount })}</span>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`transition-transform ${showPast ? 'rotate-90' : ''}`}>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
                {showPast && (
                  <div className="mt-4 flex flex-col gap-2">
                    {pastTrips.map(({ t, cities }) => (
                      <div key={t.id}>
                        <TripCard trip={t} cities={cities} />

                      </div>
                    ))}
                  </div>
                )}
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
          onClick={() => setNewTripPopup(null)}>
          <div className="bg-card w-full max-w-lg rounded-t-3xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="pt-3 pb-0 flex justify-center">
              <div className="w-9 h-1 rounded-full bg-border" />
            </div>
            <div className="px-5 py-5">
              <Map className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-base font-medium text-foreground mb-1">
                {t('tripslist.savedSpots', { count: newTripPopup.spotCount, country: newTripPopup.country })}
              </p>
              <p className="text-sm text-muted-foreground mb-5">
                {t('tripslist.importSpots')}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setNewTripPopup(null)}
                  className="flex-1 py-3 bg-secondary border border-border rounded-xl text-sm text-muted-foreground"
                >
                  {t('tripslist.notNow')}
                </button>
                <Link
                  to={createPageUrl('Restaurants') + '?trip_id=' + newTripPopup.trip.id + '&import_saved=1'}
                  onClick={() => setNewTripPopup(null)}
                  className="flex-1 py-3 bg-primary text-white rounded-full text-sm font-semibold text-center"
                >
                  {t('tripslist.importNow')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}