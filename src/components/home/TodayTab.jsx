import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, differenceInDays, parseISO } from 'date-fns';
import { base44 } from '@/api/base44Client';
import DayCard from './DayCard';
import MemberAvatarRow from './MemberAvatarRow';
import { useTranslation } from 'react-i18next';
import { notify, resolveUserIds } from '@/lib/notifications';
import { normalizeEmail } from '@/lib/utils';

export default function TodayTab({ trip, cities, tripId, profiles, onInvite, currentUserEmail }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const today = new Date();
  const todayStr    = format(today, 'yyyy-MM-dd');
  const tomorrowStr = format(new Date(today.getTime() + 86400000), 'yyyy-MM-dd');

  const sortedCities = useMemo(() =>
    [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
    [cities]
  );

  const todayCity = useMemo(() =>
    sortedCities.find(c => c.start_date && c.end_date && todayStr >= c.start_date && todayStr <= c.end_date) || sortedCities[0],
    [sortedCities, todayStr]
  );

  const tomorrowCity = useMemo(() =>
    sortedCities.find(c => c.start_date === tomorrowStr) ||
    sortedCities.find(c => c.start_date && c.end_date && tomorrowStr >= c.start_date && tomorrowStr <= c.end_date),
    [sortedCities, tomorrowStr]
  );

  const { data: allDocs = [] } = useQuery({
    queryKey: ['allDocs', tripId],
    queryFn: () => base44.entities.Ticket.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 60000,
  });

  const { data: allSpots = [] } = useQuery({
    queryKey: ['spots', tripId],
    queryFn: () => base44.entities.Spot.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 30000,
  });

  const { data: itineraryDays = [] } = useQuery({
    queryKey: ['itineraryDays', tripId],
    queryFn: () => base44.entities.ItineraryDay.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 60000,
  });

  const docsForDate  = (dateStr) => allDocs.filter(d => d.date === dateStr || d.valid_from === dateStr || d.start_date === dateStr);
  const spotsForDate = (cityId, dateStr) =>
    allSpots.filter(s => s.city_id === cityId && s.assigned_date === dateStr)
      .sort((a, b) => (a.day_order ?? 999) - (b.day_order ?? 999));
  // El "hotel" no es un campo propio del viaje/ciudad — se modela como un
  // Spot type:'hotel' sin assigned_date, así vale para toda la estancia en
  // esa ciudad en vez de tener que repetirlo cada día. Si el usuario nunca
  // guardó uno, hotelForCity devuelve undefined y el mini-mapa simplemente no
  // dibuja el pin del hotel (ver TodayRouteMap).
  const hotelForCity = (cityId) => allSpots.find(s => s.city_id === cityId && s.type === 'hotel');

  const handleReorder = async (newOrder) => {
    await Promise.all(newOrder.map((spot, idx) =>
      base44.entities.Spot.update(spot.id, { day_order: idx })
    ));
    queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
  };

  const dayNumber = trip?.start_date ? differenceInDays(today, parseISO(trip.start_date)) + 1 : null;
  const totalDays = (trip?.start_date && trip?.end_date)
    ? differenceInDays(parseISO(trip.end_date), parseISO(trip.start_date)) + 1
    : null;

const handleUpdateItemTime = async (item, time) => {
      // Fix: si el item ya tenia una posicion fijada por un arrastre
      // anterior (day_order), editar solo la hora desde aqui (pencil de la
      // fila en Hoy/Manana) no lo reubicaba en el timeline -- se quedaba
      // donde lo dejo el ultimo drag en vez de moverse a su hueco
      // cronologico nuevo. Se limpia el pin cuando la hora cambia de verdad.
      const timeIsChanging = (time || '') !== (item.time || '');
      if (item._kind === 'doc') {
              const oldTime = item.time || '';
              await base44.entities.Ticket.update(item.id, { time, ...(timeIsChanging ? { day_order: null } : {}) });
      queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      // Edición rápida de hora desde la fila del día (Hoy/Mañana) — mismo
      // hueco que Documents.jsx y Cities.jsx: antes no avisaba a nadie.
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
    }
  };

  return (
    <div className="space-y-3">
      {dayNumber && totalDays && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground font-medium">{t('trip.dayOf', { day: dayNumber, total: totalDays })}</span>
          <Link to={createPageUrl('Cities') + '?trip_id=' + tripId} className="text-xs text-primary font-medium">
            {t('home.viewFullRoute')}
          </Link>
        </div>
      )}

      {todayCity && (
        <DayCard
          label={t('common.today')}
          city={todayCity}
          docs={docsForDate(todayStr)}
          spots={spotsForDate(todayCity.id, todayStr)}
          itineraryDays={itineraryDays}
          dateStr={todayStr}
          tripId={tripId}
          defaultOpen={true}
          onReorderSpots={handleReorder}
          onUpdateItemTime={handleUpdateItemTime}
          hotelSpot={hotelForCity(todayCity.id)}
          trip={trip}
          currentUserEmail={currentUserEmail}
          profiles={profiles}
        />
      )}

      {tomorrowCity && tomorrowCity.id !== todayCity?.id && (
        <DayCard
          label={t('common.tomorrow')}
          city={tomorrowCity}
          docs={docsForDate(tomorrowStr)}
          spots={spotsForDate(tomorrowCity.id, tomorrowStr)}
          itineraryDays={itineraryDays}
          dateStr={tomorrowStr}
          tripId={tripId}
          defaultOpen={false}
          onReorderSpots={handleReorder}
          onUpdateItemTime={handleUpdateItemTime}
          hotelSpot={hotelForCity(tomorrowCity.id)}
          trip={trip}
          currentUserEmail={currentUserEmail}
          profiles={profiles}
        />
      )}

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <MemberAvatarRow trip={trip} profiles={profiles} onInvite={onInvite} currentUserEmail={currentUserEmail} />
      </div>
    </div>
  );
}
