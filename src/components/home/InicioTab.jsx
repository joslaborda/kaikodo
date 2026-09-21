import { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Users, Car, FileText, Hotel, TrainFront } from 'lucide-react';
import { BusFront, PlaneIcon } from '@/lib/icons';
import { ChevronRight } from 'lucide-react';
import { getCountryMeta } from '@/lib/countryConfig';
import { useTripCoverImage } from '@/lib/tripImage';
import { daysUntil } from '@/lib/tripDays';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import DayCard from './DayCard';
import MemberAvatarRow from './MemberAvatarRow';
import PDFViewer from '@/components/PDFViewer';
import { resolveDocViewUrl } from '@/lib/privateFiles';
import { scheduleTicketReminder, cancelTicketReminder, scheduleSpotReminder } from '@/lib/localReminders';
import { notify, resolveUserIds } from '@/lib/notifications';
import { normalizeEmail } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { isStaySpot, getCityHotel } from '@/lib/cityStay';
import { isDocForUser, isDocInMyRoute } from '@/lib/docHolders';

export default function InicioTab({ trip, cities, documents, packingItems, profiles, tripId, onInvite, currentUserEmail }) {
  const { t } = useTranslation();
  const [viewFile, setViewFile] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const todayStr  = format(new Date(), 'yyyy-MM-dd');
  const tripStart = trip?.start_date || '';
  const daysLeft  = tripStart ? daysUntil(tripStart) : null;
  const isDeparture = daysLeft === 0;

  // Recalcula qué documento está destacado cada minuto -- si no, un doc
  // podía quedarse destacado (o dejar de estarlo) hasta el próximo refetch,
  // en vez de en el minuto exacto en que entra o sale de su ventana.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const sortedCities = useMemo(() =>
    [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
    [cities]
  );

  // José (15 sep 2026): "la página Salida se ve muy pobre, debería mostrar
  // las mismas cosas que Hoy también además -- el botón de añadir
  // alojamiento, el mapa si hay spots, los docs" -- Salida nunca pedía
  // Spot/ItineraryDay ni usaba DayCard (el mismo componente que ya
  // resuelve todo eso en TodayTab.jsx), así que no tenía forma de
  // mostrarlo. Mismas queries y handlers que TodayTab, aplicados aquí al
  // día de salida.
  const queryClient = useQueryClient();
  const { data: allSpots = [] } = useQuery({
    queryKey: ['spots', tripId],
    queryFn: () => base44.entities.Spot.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 30000, refetchOnMount: 'always',
  });
  const { data: itineraryDays = [] } = useQuery({
    queryKey: ['itineraryDays', tripId],
    queryFn: () => base44.entities.ItineraryDay.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 60000,
  });
  const departureCity = sortedCities[0];
  const hotelForDepartureCity = departureCity
    ? getCityHotel(allSpots, departureCity.id)
    : null;
  const departureSpots = departureCity
    ? allSpots.filter(s => !isStaySpot(s) && s.city_id === departureCity.id && s.assigned_date === todayStr)
        .sort((a, b) => (a.day_order ?? 999) - (b.day_order ?? 999))
    : [];

  const handleReorderSpots = async (newOrder) => {
    await Promise.all(newOrder.map((spot, idx) =>
      base44.entities.Spot.update(spot.id, { day_order: idx })
    ));
    queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
  };

  // Mismo handler que TodayTab.jsx -- ver ahí los comentarios originales
  // sobre por qué hace falta limpiar day_order y reprogramar recordatorios.
  const handleUpdateItemTime = async (item, time) => {
    const timeIsChanging = (time || '') !== (item.time || '');
    if (item._kind === 'doc') {
      const oldTime = item.time || '';
      await base44.entities.Ticket.update(item.id, { time, ...(timeIsChanging ? { day_order: null } : {}) });
      queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      if (timeIsChanging) {
        cancelTicketReminder(item.id);
        // Solo suena en el móvil de quien va a usar el documento.
        if (isDocForUser(item, currentUserEmail)) scheduleTicketReminder({ ...item, time, trip_id: item.trip_id || tripId });
      }
      if ((time || '') !== oldTime && time && item.visibility !== 'personal') {
        const sharedWith = item.visibility === 'selected_users'
          ? (item.shared_with || [])
          : (trip?.members || []).filter(e => normalizeEmail(e) !== normalizeEmail(currentUserEmail));
        const targets = sharedWith.filter(e => normalizeEmail(e) !== normalizeEmail(currentUserEmail));
        if (targets.length) {
          const myProfile = (profiles || []).find(p => normalizeEmail(p.email) === normalizeEmail(currentUserEmail));
          resolveUserIds(targets).then(resolved => {
            resolved.forEach(({ userId }) => notify({
              userId, type: 'doc_time', actor: myProfile, tripId, tripName: trip?.name,
              refId: item.id, refTitle: item.name || t('documents.docFallback'),
              refExtra: { time, endTime: item.end_time || null },
            }));
          });
        }
      }
    } else if (item._kind === 'spot') {
      await base44.entities.Spot.update(item.id, { assigned_time: time, ...(timeIsChanging ? { day_order: null } : {}) });
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      if (timeIsChanging) {
        scheduleSpotReminder({ ...item, assigned_time: time });
      }
    }
  };

  const TRANSPORT_TYPES = ['flight', 'train', 'bus', 'car'];
  const todayDocs = documents.filter(d => {
    const docDate = d.date || d.valid_from || d.start_date;
    return docDate === todayStr && isDocInMyRoute(d, currentUserEmail, trip?.members || []);
  }).sort((a, b) => {
    // Ticket.jsonc guarda el tipo de documento en `category` (ver
    // DocumentForm.jsx), no en `type` — con `.type` (undefined en todo
    // documento real) este ordenado por transporte primero nunca funcionaba,
    // y las dos comparaciones de abajo (icono y etiqueta "Vuelo/Tren/...")
    // caían siempre al fallback "documento".
    const aT = TRANSPORT_TYPES.indexOf(a.category);
    const bT = TRANSPORT_TYPES.indexOf(b.category);
    if (aT !== bT) return (aT === -1 ? 99 : aT) - (bT === -1 ? 99 : bT);
    return (a.time || '').localeCompare(b.time || '');
  });

  // José (21 sep 2026): "cuando abro la app me interesa que salte MI billete,
  // no el de Carlos" — si alguien sube 10 billetes individuales para un
  // grupo de 10, a cada uno le saltaban los 10. La tarjeta de arriba
  // (destacado + filas) usa solo los documentos que YO voy a usar
  // (Ticket.used_by, ver src/lib/docHolders.js); los del resto del grupo
  // siguen visibles en la tarjeta del día de abajo, donde toca buscarlos, pero
  // ya no compiten por ser "el próximo" de esta persona.
  const myDocs = todayDocs.filter(d => isDocForUser(d, currentUserEmail));

  // Destacado del día: entra en ventana 30min antes de su hora, sigue
  // activo hasta que pasa su margen de gracia (2h transporte, 1h el resto).
  // Si varios están en ventana a la vez, gana el más reciente -- así un
  // tren de hace rato no tapa una entrada que ya ha empezado. Mismo
  // criterio que DayCard.jsx (Hoy/Mañana), aplicado aquí solo a documentos
  // (esta pestaña no mezcla spots/notas).
  const featuredDoc = useMemo(() => {
    const graceOf = (cat) => TRANSPORT_TYPES.includes(cat) ? 120 : 60;
    const toMin = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const candidates = myDocs.filter(d => d.time);
    const active = candidates.filter(c => {
      const start = toMin(c.time);
      return nowMin >= start - 30 && nowMin < start + graceOf(c.category);
    });
    if (active.length) return active.reduce((a, b) => toMin(b.time) > toMin(a.time) ? b : a);
    return candidates.filter(c => toMin(c.time) > nowMin).sort((a, b) => toMin(a.time) - toMin(b.time))[0] || myDocs[0] || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayDocs, tick, currentUserEmail]);

  const restDocs = myDocs.filter(d => d.id !== featuredDoc?.id);

  const firstDoc = featuredDoc;
  const isTransportDoc = firstDoc && TRANSPORT_TYPES.includes(firstDoc.category);

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  let countdown = null;
  if (firstDoc?.time) {
    const [h, m] = firstDoc.time.split(':').map(Number);
    const diff = (h * 60 + m) - nowMinutes;
    if (diff > 0 && diff <= 480) {
      // Transporte usa el fragmento en minúscula porque va detrás de "Sale"
      // ("Sale en 25min"). El resto (entradas, eventos...) no "sale" de
      // ningún sitio -- antes decía "Empieza en 25min", pero "empieza" no
      // pega con todas las categorías (un seguro no "empieza"); se deja en
      // el fragmento solo, capitalizado ("En 25min"), sin verbo.
      const key = diff <= 60 ? 'inMinutes' : 'inHours';
      countdown = t(`home.inicio.${isTransportDoc ? key : key + 'Cap'}`, { count: diff, hours: Math.floor(diff / 60), minutes: diff % 60 > 0 ? (diff % 60) + 'min' : '' }).trim();
    }
  }

  const DOC_ICON = {
    flight: (props) => <PlaneIcon size={20} {...props} />,
    train:  (props) => <TrainFront size={20} {...props} />,
    bus:    (props) => <BusFront size={20} {...props} />,
    hotel:  (props) => <Hotel size={20} {...props} />,
    car:    (props) => <Car size={20} {...props} />,
    other:  (props) => <FileText size={20} {...props} />,
  };

  // La propia pantalla de Maleta (Utilities.jsx) excluye la categoría
  // "souvenir" del total/%, pero aquí se contaba con packingItems en crudo
  // — el % de Home podía no coincidir con el que ves al entrar en Maleta
  // (y daba la sensación de que actualizar la maleta "no cambiaba nada").
  const packingItemsForPct = packingItems.filter(i => i.category !== 'souvenir');
  const packedCount = packingItemsForPct.filter(i => i.packed).length;
  const packedPct   = packingItemsForPct.length ? Math.round(packedCount / packingItemsForPct.length * 100) : 0;

  // José (14 sep 2026): Maleta no debe verse una vez el viaje ya ha
  // empezado -- si hoy hay un billete de transporte (vuelo/tren/bus/coche)
  // cuya hora de salida ya pasó, se considera que el viaje ya está en
  // marcha y se oculta (se sigue pudiendo editar desde Utilidades). Sin
  // ningún billete con hora conocida no hay forma de saberlo, así que se
  // mantiene visible el resto del día de salida como hasta ahora.
  const hasDepartedTransportToday = myDocs.some(d => {
    if (!TRANSPORT_TYPES.includes(d.category) || !d.time) return false;
    const [h, m] = d.time.split(':').map(Number);
    return (h * 60 + m) <= nowMinutes;
  });

  const destName   = sortedCities.length > 0 ? sortedCities.map(c => c.name).join(' · ') : trip?.destination || '';
  const firstCity  = sortedCities[0];
  const countryMeta = getCountryMeta(firstCity?.country || trip?.country || '');
  // Con un solo destino, el titular muestra la ciudad -- "España te espera"
  // no tiene sentido cuando el destino ya es un único sitio conocido (y
  // menos si el viajero es de ese propio país). Con varias ciudades se
  // mantiene el país, porque listarlas todas en el titular no cabe bien.
  const isSingleCity = sortedCities.length === 1;
  const heroHeadline = isSingleCity
    ? (firstCity?.name || firstCity?.country || trip?.destination || trip?.name)
    : (firstCity?.country || trip?.destination || trip?.name);
  const heroSubtitle = isSingleCity ? (firstCity?.country || '') : destName;

  const coverImage = useTripCoverImage(trip, cities);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl overflow-hidden relative" style={{ minHeight: 160, background: 'var(--kodo-hero-bg)' }}>
        <img src={coverImage} alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={e => {
            // Mismo fallback que TripCard/HeroTripCard: si la foto no carga,
            // se queda solo el color de fondo + degradado (nunca un hueco roto).
            e.currentTarget.style.display = 'none';
          }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.8) 0%, rgba(0,0,0,.3) 100%)' }} />
        {countryMeta?.flag && (
          <div style={{ position: 'absolute', top: 14, right: 16, fontSize: 32, zIndex: 1 }}>{countryMeta.flag}</div>
        )}
        {/* José (18 sep 2026, en vivo saliendo hacia León): "Hoy es el día"
            no se leía, y España (subtítulo) tampoco -- el degradado se
            queda casi transparente hacia abajo (15% negro) y con fotos
            claras el texto blanco/naranja pierde el contraste. text-shadow
            es la forma estándar de garantizar legibilidad de texto sobre
            una foto variable sin depender de lo oscura que sea esa foto en
            concreto -- las tres líneas lo llevan ahora. */}
        <div style={{ position: 'relative', zIndex: 1, padding: '16px 16px 18px' }}>
          {/* José (21 sep 2026): el eyebrow en naranja claro sobre la foto no se
              leía ni con text-shadow — el contraste depende de la foto. Ahora
              es una píldora sólida (primary + texto blanco), legible sobre
              cualquier imagen y en la misma familia rounded-full del resto de
              la app. */}
          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, color: '#fff', background: 'hsl(var(--primary))', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10, padding: '4px 10px', borderRadius: 999 }}>
            {isDeparture ? t('home.departure.today') : t('home.departure.tomorrow')}
          </span>
          <p style={{ fontSize: 22, fontWeight: 600, color: 'white', lineHeight: 1.2, marginBottom: 6, textShadow: '0 1px 6px rgba(0,0,0,.85)' }}>
            {heroHeadline}<br/>{t('home.inicio.awaits')}
          </p>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,.85)', textShadow: '0 1px 4px rgba(0,0,0,.9)' }}>{heroSubtitle}</p>
        </div>
      </div>

      {firstDoc && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {TRANSPORT_TYPES.includes(firstDoc.category)
                ? (firstDoc.category === 'flight' ? t('home.inicio.firstFlight') : firstDoc.category === 'train' ? t('home.inicio.firstTrain') : t('home.inicio.firstTransport'))
                : t('home.inicio.firstDocument')}
            </p>
            {countdown && <span className="text-xs font-medium text-primary">{t(TRANSPORT_TYPES.includes(firstDoc.category) ? 'home.inicio.departsIn' : 'home.inicio.startsIn', { countdown })}</span>}
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-xl flex-shrink-0">
              {(() => { const I = DOC_ICON[firstDoc.category] || DOC_ICON.other; return <I className="text-primary" />; })()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{firstDoc.title || firstDoc.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{firstDoc.time ? t(TRANSPORT_TYPES.includes(firstDoc.category) ? 'home.inicio.departureTime' : 'home.inicio.startTime', { time: firstDoc.time }) : t('home.inicio.noTime')}</p>
            </div>
            {firstDoc.time && <p className="text-base font-semibold text-foreground flex-shrink-0">{firstDoc.time}</p>}
          </div>
          {(firstDoc.file_url || firstDoc.file_uri) && (
            <div className="px-4 pb-3">
              <button type="button"
                onClick={async () => { const url = await resolveDocViewUrl(firstDoc); if (url) setViewFile(url); }}
                className="block w-full py-2.5 bg-primary text-white text-sm font-medium text-center rounded-full">
                {t('home.inicio.viewTicket')}
              </button>
            </div>
          )}
          {restDocs.map((doc, idx) => {
            const DocRowIcon = DOC_ICON[doc.category] || DOC_ICON.other;
            const hasFile = !!(doc.file_url || doc.file_uri);
            const isPastDoc = doc.time && (() => {
              const [h, m] = doc.time.split(':').map(Number);
              const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
              const grace = TRANSPORT_TYPES.includes(doc.category) ? 120 : 60;
              return nowMin >= (h * 60 + m) + grace;
            })();
            return (
              <button key={doc.id || idx} type="button" disabled={!hasFile || resolvingId === doc.id}
                onClick={async () => {
                  if (!hasFile) return;
                  setResolvingId(doc.id);
                  try { const url = await resolveDocViewUrl(doc); if (url) setViewFile(url); }
                  finally { setResolvingId(null); }
                }}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 border-t border-border text-left transition-colors ${hasFile ? 'hover:bg-secondary/20' : ''} ${isPastDoc ? 'opacity-50' : ''}`}>
                <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                  <DocRowIcon className="text-primary" style={{ width: 14, height: 14 }} />
                </div>
                <p className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">{doc.title || doc.name}</p>
                {doc.time && <span className="text-xs font-medium text-muted-foreground shrink-0">{doc.time}</span>}
                {hasFile && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      {/* José (15 sep 2026): mismo DayCard que ya usa Hoy -- spots del día,
          mapa con el hotel si hay uno guardado, y los botones de
          "+ Doc / + Spot / + Nota" que antes solo existían en Hoy/Mañana. */}
      {departureCity && (
        <DayCard
          label={t('common.today')}
          city={departureCity}
          docs={todayDocs}
          spots={departureSpots}
          itineraryDays={itineraryDays}
          dateStr={todayStr}
          tripId={tripId}
          defaultOpen={false}
          onReorderSpots={handleReorderSpots}
          onUpdateItemTime={handleUpdateItemTime}
          hotelSpot={hotelForDepartureCity}
          hideFeatured
          trip={trip}
          currentUserEmail={currentUserEmail}
          profiles={profiles}
        />
      )}

      {packingItemsForPct.length > 0 && !hasDepartedTransportToday && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-foreground">{t('utilities.packing.tabMaleta')}</p>
            <p className="text-sm font-medium text-primary">{packedPct}%</p>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden mb-1">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: packedPct + '%' }} />
          </div>
          <p className="text-xs text-muted-foreground">{t('home.inicio.packedReady', { packed: packedCount, total: packingItemsForPct.length })}</p>
        </div>
      )}

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4" />{t('home.travelers')}
          </p>
        </div>
        <MemberAvatarRow trip={trip} profiles={profiles} onInvite={onInvite} currentUserEmail={currentUserEmail} tripId={tripId} />
      </div>

      <PDFViewer fileUrl={viewFile} onClose={() => setViewFile(null)} />
    </div>
  );
}
