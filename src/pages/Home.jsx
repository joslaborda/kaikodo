import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { leaveTrip } from '@/lib/tripMembers';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowRight, Calendar, MapPin, Settings } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { PlaneIcon } from '@/lib/icons';
import { useTripContext } from '@/hooks/useTripContext';
import { daysUntil } from '@/lib/tripDays';
import { parseServerDate } from '@/lib/parseServerDate';
import { normalizeEmail } from '@/lib/utils';
import { searchUserProfiles } from '@/lib/userProfiles';
import NotificationBell from '@/components/notifications/NotificationBell';
import DeleteTripModal from '@/components/trip/DeleteTripModal';
import LeaveTripModal from '@/components/trip/LeaveTripModal';
import TripAlerts from '@/components/trip/TripAlerts';
import OTabBar from '@/components/trip/OTabBar';
import PreTripTab from '@/components/home/PreTripTab';
import InicioTab from '@/components/home/InicioTab';
import TodayTab from '@/components/home/TodayTab';
import TomorrowTab from '@/components/home/TomorrowTab';
import FinishedTab from '@/components/home/FinishedTab';
import ChatTab from '@/components/home/ChatTab';
import { syncTicketRemindersForUser } from '@/lib/localReminders';
import { isDocForUser } from '@/lib/docHolders';
import { prefetchTicketFiles } from '@/lib/privateFiles';
import { cityDateSpan, syncTripFromCities, applyCityDates } from '@/lib/tripDates';
import InviteModal from '@/components/home/InviteModal';
import SettingsDialog from '@/components/home/SettingsDialog';

import { useTripDocs } from '@/hooks/useTripDocs';
if (typeof document !== 'undefined' && !document.getElementById('kodo-tab-slide-style')) {
  const st = document.createElement('style');
  st.id = 'kodo-tab-slide-style';
  st.textContent = `
    @keyframes slideInRight { from { transform: translateX(32px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideInLeft  { from { transform: translateX(-32px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    /* 21 sep 2026: antes fill-mode both — al acabar la animación se quedaba un
       transform permanente en el contenedor, y un position fixed dentro de un
       ancestro con transform se ancla a ESE ancestro, no a la pantalla. Efecto en
       Home: las hojas inferiores (detalle de un billete, etc.) no quedaban pegadas
       al borde inferior y la página de detrás seguía haciendo scroll. Con
       backwards el final de la animación (translateX(0)) es el estado natural y
       no deja ningún transform. */
    .kodo-slide-right { animation: slideInRight 0.2s cubic-bezier(.25,.46,.45,.94) backwards; }
    .kodo-slide-left  { animation: slideInLeft  0.2s cubic-bezier(.25,.46,.45,.94) backwards; }
  `;
  document.head.appendChild(st);
}

// Clave de localStorage para el "último visto" del chat, por viaje — antes
// chatLastRead se inicializaba a `new Date()` (el instante en que se monta
// Home), así que cualquier mensaje llegado mientras la app estaba cerrada
// quedaba "leído" de oficio en cuanto abrías la app: nunca se contaba como
// no leído y la pestaña Chat jamás mostraba la burbuja de aviso, aunque
// OTabBar sí sabe pintarla (badge > 0). Persistiendo el timestamp real de
// la última vez que el usuario abrió el chat (por viaje) se puede saber de
// verdad si hay mensajes nuevos desde entonces.
const chatReadStorageKey = (tripId) => `kaikodo_chat_last_read_${tripId}`;

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? undefined : es;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [tripId, setTripId] = useState(null);
  const [tab, setTab] = useState(() => 'inicio');
  const tabRef = useRef('inicio');
  const [tabDir, setTabDir] = useState(1);
  const [urgentCount, setUrgentCount] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [chatLastRead, setChatLastReadState] = useState(() => new Date(0));
  // Se consulta desde dos sitios (el deep-link de ?tab=... y el efecto de
  // "tab inteligente" según fecha del viaje): sin esta ref, cuando llegas
  // desde una notificación de chat con ?tab=chat, el efecto de tab
  // inteligente se dispara justo después al cargar el viaje y pisa el tab
  // que acabamos de fijar, devolviéndote a Pre-viaje/Hoy sin que llegues a
  // ver el chat.
  const deepLinkTabRef = useRef(null);

  // Marca el chat como visto AHORA y lo persiste para este viaje — se llama
  // tanto al cambiar de pestaña a mano como al entrar directo desde una
  // notificación de chat.
  const markChatRead = (tid) => {
    const now = new Date();
    setChatLastReadState(now);
    if (tid) {
      try { localStorage.setItem(chatReadStorageKey(tid), now.toISOString()); } catch {}
    }
  };

  const handleTabChange = (key) => {
    const tabOrder = ['previaje','inicio','hoy','manana','resumen','chat'];
    setTabDir(tabOrder.indexOf(key) >= tabOrder.indexOf(tabRef.current) ? 1 : -1);
    tabRef.current = key;
    setTab(key);
    if (key === 'chat') markChatRead(tripId);
  };
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  // Antes este efecto solo dependía de [navigate], así que leía
  // window.location.search UNA VEZ al montar — el resto de pantallas
  // (Documentos, Restaurantes, Gastos, Fotos, Traductor, Utilidades) usan
  // useSearchParams(), que sí recalcula en cada render. Con navegación
  // normal (Mis viajes → Inicio) no se notaba porque el componente se
  // remonta, pero es fragilidad ante cualquier cambio futuro (enlaces
  // directos, selector rápido de viaje) que cambie el trip_id sin desmontar
  // Home. Añadir location.search como dependencia hace que se recalcule
  // cada vez que cambia la URL, igual que el resto de la app.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('trip_id');
    if (!id || id === 'null' || id === 'default') {
      navigate(createPageUrl('TripsList'), { replace: true });
      return;
    }
    setTripId(id);
    // Cities.jsx enlaza aquí con ?open_settings=true para "+ Ciudad" (añadir
    // ciudad vive dentro del diálogo de ajustes del viaje, no tiene pantalla
    // propia) — sin esto el enlace aterrizaba en Inicio sin abrir nada.
    if (params.get('open_settings') === 'true') {
      setSettingsOpen(true);
    }
    // Deep link a una pestaña concreta (usado por NotificationBell, p. ej.
    // ?tab=chat al tocar una notificación de mensaje). Se aplica ya mismo —
    // el efecto de "tab inteligente" de abajo respeta este valor la primera
    // vez que se dispare tras esto, ver deepLinkTabRef.
    const wantedTab = params.get('tab');
    if (wantedTab) {
      deepLinkTabRef.current = wantedTab;
      tabRef.current = wantedTab;
      setTab(wantedTab);
      if (wantedTab === 'chat') markChatRead(id);
    }
    window.scrollTo(0, 0);
  }, [navigate, location.search]);

  // Carga el "último leído" del chat persistido para este viaje concreto —
  // solo al cambiar de viaje, no en cada render.
  useEffect(() => {
    if (!tripId) return;
    try {
      const stored = localStorage.getItem(chatReadStorageKey(tripId));
      setChatLastReadState(stored ? new Date(stored) : new Date(0));
    } catch {
      setChatLastReadState(new Date(0));
    }
  }, [tripId]);

  // Antes sin staleTime propio (heredaba el default global de 5 min) y sin
  // refetchOnMount — Home es la pantalla de entrada a un viaje compartido:
  // si otro viajero (p. ej. Carlos) cambia las fechas o la ciudad mientras
  // tú tenías la app cerrada o en otra pantalla, tu caché local de este
  // viaje podía seguir "fresca" para react-query hasta 5 minutos aunque
  // fuera ya incorrecta — de ahí el "quedan 300 días" con fechas viejas y
  // la foto de portada (derivada de trip/cities, no un campo aparte — ver
  // src/lib/tripImage.js) sin actualizar. refetchOnMount: 'always' fuerza
  // comprobar la verdad del servidor cada vez que se entra a un viaje,
  // sin esperar a que venza el staleTime.
  const { data: cities = [] } = useQuery({ queryKey: ['cities', tripId], queryFn: () => base44.entities.City.filter({ trip_id: tripId }, 'order'), enabled: !!tripId, staleTime: 30000 });
  const { data: tripRaw, isLoading } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => tripId ? base44.entities.Trip.get(tripId) : null,
    enabled: !!tripId, staleTime: 30000, refetchOnMount: 'always',

  });
  // Las fechas del viaje son las de sus paradas (tripDates.js). Un Editor que
  // cambia una parada no puede actualizar el Trip (solo admin), así que la
  // copia guardada puede ir atrasada: Home, las pestañas Hoy/Mañana y todo lo
  // que cuelga de `trip` usan siempre las fechas efectivas.
  const trip = useMemo(() => applyCityDates(tripRaw, cities), [tripRaw, cities]);

  // Tab inicial inteligente según estado del viaje
  useEffect(() => {
    if (!trip?.start_date) return;
    // Si acabamos de llegar con un deep link explícito (p. ej. desde una
    // notificación de chat con ?tab=chat), se respeta esa pestaña una única
    // vez en vez de pisarla con el cálculo automático de abajo.
    if (deepLinkTabRef.current) {
      deepLinkTabRef.current = null;
      return;
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const start = new Date(trip.start_date + 'T00:00:00');
    const end = trip.end_date ? new Date(trip.end_date + 'T00:00:00') : null;
    let next;
    if (today < start) next = 'previaje';
    else if (end && today > end) next = 'resumen';
    else next = 'hoy';
    tabRef.current = next;
    setTab(next);
  }, [trip?.start_date, trip?.end_date]);

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.Trip.delete(tripId),
    onSuccess: () => { setDeleteOpen(false); navigate(createPageUrl('TripsList'), { replace: true }); },
    onError: () => toast({ title: t('trip.deleteError'), description: t('common.tryAgain'), variant: 'destructive' }),
  });

  // Solo el admin podía quitar a otros miembros (y ni siquiera podía
  // quitarse a sí mismo) — un miembro normal que quisiera dejar el viaje no
  // tenía ninguna forma de hacerlo salvo pedirle al admin que lo expulasara.
  // leaveTrip() ya existía en el backend (base44/functions/leaveTrip), solo
  // faltaba esta mutación para exponerlo desde Ajustes.
  const leaveMutation = useMutation({
    mutationFn: () => leaveTrip(tripId),
    onSuccess: () => { setLeaveOpen(false); navigate(createPageUrl('TripsList'), { replace: true }); },
    onError: (e) => toast({ title: t('trip.leaveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  // currentUser.email viene tal cual de base44.auth.me(), sin pasar por
  // normalizeEmail() — mientras que trip.roles/trip.created_by SÍ se guardan
  // siempre en minúsculas (TripsList.jsx). Sin normalizar aquí, el propio
  // creador del viaje podía dejar de verse como admin (perdiendo acceso a
  // Ajustes/borrar viaje) si su proveedor de auth devolvía el email con
  // mayúsculas distintas a como quedó guardado — auditoría 1.1.
  const currentUserEmail = normalizeEmail(currentUser?.email);
  const currentUserId = currentUser?.id;
  const roles = trip?.roles || {};
  // Antes `!trip` hacía fail-open a admin mientras el viaje no había cargado
  // (o si el backend devolvía vacío en vez de lanzar error). Con trip aún sin
  // cargar, nadie debe verse como admin.
  const isAdmin = !!trip && (roles[currentUserEmail] === 'admin' || normalizeEmail(trip?.created_by) === currentUserEmail);

  const { activeCity, activeMeta, countryRoute } = useTripContext(tripId);

  // Autocuración: si las paradas dicen otras fechas que el viaje (p. ej. se
  // editaron antes de que las fechas se calcularan solas), el admin las
  // sincroniza al entrar — una sola vez por diferencia.
  const tripSpan = cityDateSpan(cities);
  useEffect(() => {
    if (!isAdmin || !tripRaw || !tripSpan) return;
    if (tripRaw.start_date !== tripSpan.start || tripRaw.end_date !== tripSpan.end) syncTripFromCities(tripId, queryClient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, tripRaw?.start_date, tripRaw?.end_date, tripSpan?.start, tripSpan?.end]);
  const { data: expenses = [] } = useQuery({ queryKey: ['expenses', tripId], queryFn: () => base44.entities.Expense.filter({ trip_id: tripId }), enabled: !!tripId, staleTime: 30000 });
  const { data: packingItems = [] } = useQuery({ queryKey: ['packingItems', tripId], queryFn: () => base44.entities.PackingItem.filter({ trip_id: tripId }), enabled: !!tripId, staleTime: 30000 });
  // Los documentos vienen de la consulta única del viaje (useTripDocs). Aquí solo
  // se descartan los que este usuario no debe ver (el rls ya lo hace en el
  // backend; esto cubre además el caché persistido de una sesión anterior).
  const { data: allTickets = [], isSuccess: documentsLoaded } = useTripDocs(tripId, { enabled: !!currentUserEmail });
  const documents = useMemo(() => allTickets.filter(ticket => {
    const vis = ticket.visibility || 'personal';
    if (vis === 'shared') return true;
    // Quien va a usar el documento siempre lo ve (used_by).
    // José (22 sep 2026) -- auditoría: este check leía used_by a mano y no
    // entendía el marcador '*' (docHolders.js, "todos" -- incluye a quien
    // se una después). Un doc "de todos" con audiencia no-'shared' (p.ej.
    // "quién lo verá" plegado a solo quienes lo usan) tiene shared_with
    // fijo del momento de crearlo: alguien que se une al viaje más tarde no
    // estaba en esa lista y tampoco lo pillaba aquí -- documento invisible
    // para el nuevo miembro, justo lo que '*' existe para evitar.
    // isDocForUser ya está importado y usado más abajo (prefetch) -- aquí
    // faltaba.
    if (isDocForUser(ticket, currentUserEmail)) return true;
    if (vis === 'selected_users' && (ticket.shared_with || []).some(e => normalizeEmail(e) === currentUserEmail)) return true;
    return normalizeEmail(ticket.created_by) === currentUserEmail || ticket.user_id === currentUserId;
  }), [allTickets, currentUserEmail, currentUserId]);
  const { data: allSpots = [] } = useQuery({ queryKey: ['spots', tripId], queryFn: () => base44.entities.Spot.filter({ trip_id: tripId }), enabled: !!tripId, staleTime: 30000 });
  // Recordatorios locales de los billetes que VA A USAR ESTE móvil (used_by),
  // no solo de los que subió él — ver syncTicketRemindersForUser. Solo cuando la
  // lista ya cargó de verdad: una lista vacía por estar cargando retiraría
  // todos los avisos ya programados.
  // Los archivos de los billetes de los próximos días se guardan en el móvil para
  // poder abrirlos sin red (estación, aeropuerto, túnel) — ver lib/ticketCache.js.
  useEffect(() => {
    if (!documentsLoaded || !currentUserEmail) return;
    // Primero los billetes míos: el tope de descarga no debe gastarse en los de otros.
    prefetchTicketFiles([...documents].sort((a, b) => Number(isDocForUser(b, currentUserEmail)) - Number(isDocForUser(a, currentUserEmail))));
  }, [documents, documentsLoaded, currentUserEmail]);

  // José: la app abierta a las 23:50 seguía diciendo "Hoy" a las 00:10 (la fecha solo
  // se leía al pintar). Se vigila el cambio de día cada 30 s y al volver a primer plano.
  const [, setDayKey] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  useEffect(() => {
    const check = () => setDayKey(k => { const n = format(new Date(), 'yyyy-MM-dd'); return n === k ? k : n; });
    const id = setInterval(check, 30000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, []);

  useEffect(() => {
    if (!documentsLoaded || !tripId || !currentUserEmail) return;
    syncTicketRemindersForUser(documents, currentUserEmail, tripId, currentUserId);
  }, [documents, documentsLoaded, currentUserEmail, currentUserId, tripId]);
  const { data: tripMessages = [] } = useQuery({ queryKey: ['tripMessages', tripId], queryFn: () => base44.entities.TripMessage.filter({ trip_id: tripId }), enabled: !!tripId, staleTime: 10000, refetchInterval: 30000 });
  const tripMembers = trip?.members || [];
  const { data: profiles = [] } = useQuery({
    queryKey: ['profilesHome', tripMembers.join(',')],
    queryFn: async () => {
      if (!tripMembers.length) return [];
      // Antes se resolvía email→user_id con base44.entities.User.filter()
      // antes de poder pedir el perfil — esa llamada da SIEMPRE 403 para
      // cualquier usuario no colaborador del proyecto en Base44 ("Only
      // collaborators can view the list of users"), así que esta query
      // fallaba en silencio y `profiles` se quedaba vacío para cualquier
      // usuario normal (mismo hallazgo que en notifications.js y
      // Documents.jsx). searchUserProfiles ya acepta emails directamente
      // (ya los tenemos en trip.members) — no hace falta pasar por User.filter.
      return searchUserProfiles({ emails: tripMembers });
    },
    enabled: tripMembers.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const { data: myProfile } = useQuery({
    queryKey: ['myProfile', currentUserId],
    queryFn: async () => {
      if (!currentUserId) return null;
      const r = await base44.entities.UserProfile.filter({ user_id: currentUserId });
      return r[0] || null;
    },
    enabled: !!currentUserId, staleTime: 60000
  });

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const tripStart = trip?.start_date || '';
  const tripEnd = trip?.end_date || '';
  const tripNotStarted = tripStart && todayStr < tripStart;
  const tripFinished = tripEnd && todayStr > tripEnd;
  const tripInProgress = tripStart && tripEnd && todayStr >= tripStart && todayStr <= tripEnd;
  // Último día del viaje: no tiene sentido una pestaña "Mañana" (ya no
  // queda nada del viaje que planificar para entonces) — antes se seguía
  // mostrando Hoy/Mañana/Chat igual que cualquier otro día en curso.
  const isLastDay = tripEnd && todayStr === tripEnd;

  // Notifications
  // notifications handled by NotificationBell component

  const unreadMessages = useMemo(() => {
    return tripMessages.filter(m =>
      m.user_id !== currentUserId &&
      normalizeEmail(m.user_email) !== currentUserEmail &&
      parseServerDate(m.created_date) > chatLastRead
    ).length;
  }, [tripMessages, currentUserId, currentUserEmail, chatLastRead]);

  const sortedCities = useMemo(() =>
    [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
    [cities]
  );

  // Smart tab logic
  const daysToStart = tripStart ? daysUntil(tripStart) : null;
  const isDeparture = daysToStart === 0;       // today IS the start date
  const isDMinus1   = daysToStart === 1;       // tomorrow is start

  const homeTabs = useMemo(() => {
    if (tripFinished) {
      return [{ key: 'resumen', label: t('tabs.summary') }, { key: 'chat', label: t('tabs.chat'), badge: unreadMessages }];
    }
    if (tripInProgress && !isDeparture) {
      if (isLastDay) {
        // Último día — sin Mañana, "Hoy" pasa a llamarse "Último día".
        return [
          { key: 'hoy', label: t('tabs.lastDay'), urgent: true },
          { key: 'chat', label: t('tabs.chat'), badge: unreadMessages },
        ];
      }
      // Viaje en curso (no el primer día) — sin tab Salida
      return [
        { key: 'hoy', label: t('tabs.today'), urgent: true },
        { key: 'manana', label: t('tabs.tomorrow') },
        { key: 'chat', label: t('tabs.chat'), badge: unreadMessages },
      ];
    }
    if (isDeparture) {
      // Día de salida — Salida + Mañana (primer día en destino)
      return [
        { key: 'inicio', label: t('tabs.departure') },
        { key: 'manana', label: t('tabs.tomorrow') },
        { key: 'chat', label: t('tabs.chat'), badge: unreadMessages },
      ];
    }
    if (isDMinus1) {
      // Víspera — Pre-viaje + Salida
      return [
        { key: 'previaje', label: t('tabs.pretrip') },
        { key: 'inicio', label: t('tabs.departure') },
        { key: 'chat', label: t('tabs.chat'), badge: unreadMessages },
      ];
    }
    // Pre-viaje normal
    return [
      { key: 'previaje', label: t('tabs.pretrip') },
      { key: 'chat', label: t('tabs.chat'), badge: unreadMessages },
    ];
  }, [tripFinished, isDeparture, tripInProgress, isDMinus1, isLastDay, unreadMessages]);

  // Auto-correct tab when trip status changes
  useEffect(() => {
    if (!trip || !homeTabs.length) return;
    const validKeys = homeTabs.map(tab => tab.key);
    if (!validKeys.includes(tabRef.current)) {
      const next = validKeys[0];
      tabRef.current = next;
      setTab(next);
    }
  }, [homeTabs]);

  if (isLoading || !tripId) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4"><PlaneIcon className="w-7 h-7 text-muted-foreground/50" /></div>
        <p className="text-muted-foreground">{t('trip.loadingTrip')}</p>
      </div>
    </div>
  );

  return (
    <div className="bg-background min-h-screen">
      {/* Header — light option D */}
      <div className="bg-background sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-0">

          {/* Top row */}
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('TripsList')}>
              <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
                <ArrowRight className="w-4 h-4 rotate-180" />{t('tripslist.myTrips')}
              </button>
            </Link>
            <div className="flex items-center gap-2">
              <NotificationBell userId={currentUserId} userEmail={currentUserEmail} currentTripId={tripId} />
              <button onClick={() => setSettingsOpen(true)}
                aria-label={t('trip.settingsAria')}
                className="w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center hover:bg-secondary/60 transition-colors">
                <Settings className="w-5 h-5 text-foreground" />
              </button>
            </div>
          </div>

          {/* Trip info */}
          <h1 className="text-2xl font-semibold text-foreground mb-2">{trip?.name}</h1>
          <div className="flex flex-wrap gap-3 text-muted-foreground text-sm mb-4">
            {sortedCities.length > 0 ? (
              <span className="flex items-center gap-1 flex-wrap">
                <MapPin className="w-3.5 h-3.5 shrink-0 text-primary" />
                {sortedCities.map((city, i) => (
                  <span key={city.id} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight className="w-3 h-3 opacity-40" />}
                    {city.name}
                  </span>
                ))}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-primary" />{trip?.destination}
              </span>
            )}
            {trip?.start_date && (
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {format(parseISO(trip.start_date), 'dd MMM', { locale: dateLocale })}
                {trip.end_date && ` – ${format(parseISO(trip.end_date), 'dd MMM yyyy', { locale: dateLocale })}`}
              </span>
            )}
          </div>

          {/* Tabs — Ō system */}
          <OTabBar
            tabs={homeTabs}
            activeKey={tab}
            onChange={handleTabChange}
            urgentCount={urgentCount}
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-5 pt-5 pb-2 space-y-3">
        <TripAlerts tripId={tripId} cities={cities} trip={trip} currentUserEmail={currentUserEmail} onUrgentCount={setUrgentCount} />
        <div key={tab} className={tabDir >= 0 ? 'kodo-slide-right' : 'kodo-slide-left'}>

        {tab === 'previaje' && (
          <PreTripTab
            trip={trip} cities={sortedCities}
            packingItems={packingItems} documents={documents}
            myProfile={myProfile} profiles={profiles}
            onInvite={() => setInviteOpen(true)}
            currentUserEmail={currentUserEmail}
          />
        )}
        {tab === 'inicio' && (
          <InicioTab
            trip={trip} cities={sortedCities}
            documents={documents} packingItems={packingItems}
            profiles={profiles} tripId={tripId}
            onInvite={() => setInviteOpen(true)}
            currentUserEmail={currentUserEmail}
          />
        )}
        {tab === 'hoy' && (
          <TodayTab trip={trip} cities={sortedCities} tripId={tripId} profiles={profiles} onInvite={() => setInviteOpen(true)} currentUserEmail={currentUserEmail} />
        )}
        {tab === 'manana' && (
          <TomorrowTab trip={trip} cities={sortedCities} tripId={tripId} currentUserEmail={currentUserEmail} profiles={profiles} />
        )}

        {tab === 'resumen' && (
          <FinishedTab trip={trip} cities={sortedCities} expenses={expenses} spots={allSpots} tripId={tripId} currentUserEmail={currentUserEmail} profiles={profiles} />
        )}
        {tab === 'chat' && (
          <ChatTab
            tripId={tripId}
            currentUserEmail={currentUserEmail}
            currentUserId={currentUserId}
            myProfile={myProfile}
            tripMembers={trip?.members}
          />
        )}
      </div>

        </div>
      {/* Settings dialog */}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        trip={trip}
        cities={sortedCities}
        tripId={tripId}
        isAdmin={isAdmin}
        profiles={profiles}
        currentUserEmail={currentUserEmail}
        onDelete={() => { setSettingsOpen(false); setDeleteOpen(true); }}
        onLeave={() => { setSettingsOpen(false); setLeaveOpen(true); }}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
          queryClient.invalidateQueries({ queryKey: ['cities', tripId] });
        }}
      />

            <DeleteTripModal
        open={deleteOpen} onOpenChange={setDeleteOpen}
        tripName={trip?.name || ''}
        onConfirm={() => deleteMutation.mutate()}
        isPending={deleteMutation.isPending}
      />

      <LeaveTripModal
        open={leaveOpen} onOpenChange={setLeaveOpen}
        tripName={trip?.name || ''}
        onConfirm={() => leaveMutation.mutate()}
        isPending={leaveMutation.isPending}
      />

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        trip={trip}
        tripId={tripId}
        queryClient={queryClient}
        profiles={profiles}
        currentUserEmail={currentUserEmail}
        currentUserName={myProfile?.display_name || myProfile?.username || currentUserEmail}
      />
    </div>
  );
}
