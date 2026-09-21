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
import { scheduleTicketReminder, cancelTicketReminder, scheduleSpotReminder } from '@/lib/localReminders';
import { isStaySpot, getCityHotel } from '@/lib/cityStay';
import { requestTicketPush, cancelTicketPush, hasServerPushFor } from '@/lib/ticketPush';
import { isDocForUser, isDocInMyRoute } from '@/lib/docHolders';

import { useTripDocs, invalidateTripDocs } from '@/hooks/useTripDocs';
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

  const { data: allDocs = [] } = useTripDocs(tripId);

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

  // Solo TU itinerario: lo que vas a usar tú + lo de todo el grupo (docHolders.js).
  const docsForDate  = (dateStr) => allDocs.filter(d => (d.date === dateStr || d.valid_from === dateStr || d.start_date === dateStr) && isDocInMyRoute(d, currentUserEmail, trip?.members || []));
  const spotsForDate = (cityId, dateStr) =>
    allSpots.filter(s => !isStaySpot(s) && s.city_id === cityId && s.assigned_date === dateStr)
      .sort((a, b) => (a.day_order ?? 999) - (b.day_order ?? 999));
  // El "hotel" no es un campo propio del viaje/ciudad — se modela como un
  // Spot type:'hotel' sin assigned_date, así vale para toda la estancia en
  // esa ciudad en vez de tener que repetirlo cada día. Si el usuario nunca
  // guardó uno, hotelForCity devuelve undefined y el mini-mapa simplemente no
  // dibuja el pin del hotel (ver TodayRouteMap).
  // José (21 sep 2026): ahora vía getCityHotel (src/lib/cityStay.js), el mismo
  // criterio para Hoy, Mañana, Salida y Ruta.
  const hotelForCity = (cityId) => getCityHotel(allSpots, cityId);

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
      invalidateTripDocs(queryClient, tripId);
      // Mismo hueco que en Documents.jsx/Cities.jsx: el recordatorio local
      // del propio dispositivo tampoco se reprogramaba desde aquí.
      if (timeIsChanging) {
        cancelTicketReminder(item.id);
        // Solo suena en el móvil de quien va a usar el documento.
        if (isDocForUser(item, currentUserEmail)) scheduleTicketReminder({ ...item, time, trip_id: item.trip_id || tripId });
        requestTicketPush({ ...item, time });
      }
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
      // Mismo hueco que arriba para documentos, aplicado a spots: cambiar la
      // hora desde aquí no reprogramaba el recordatorio local del spot.
      if (timeIsChanging) {
        scheduleSpotReminder({ ...item, assigned_time: time });
      }
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
        <MemberAvatarRow trip={trip} profiles={profiles} onInvite={onInvite} currentUserEmail={currentUserEmail} tripId={tripId} />
      </div>
    </div>
  );
}
