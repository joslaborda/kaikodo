import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Calendar } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import DayCard from './DayCard';
import { useTranslation } from 'react-i18next';
import { isStaySpot, getCityHotel } from '@/lib/cityStay';
import { isDocInMyRoute, isDocForUser } from '@/lib/docHolders';
import { notify, resolveUserIds } from '@/lib/notifications';
import { normalizeEmail } from '@/lib/utils';
import { scheduleTicketReminder, cancelTicketReminder, scheduleSpotReminder } from '@/lib/localReminders';
import { requestTicketPush } from '@/lib/ticketPush';

import { useTripDocs, invalidateTripDocs } from '@/hooks/useTripDocs';
export default function TomorrowTab({ trip, cities, tripId, currentUserEmail, profiles }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const tomorrowStr = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd');

  const sortedCities = useMemo(() =>
    [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
    [cities]
  );

  // Mismo criterio que TodayTab.jsx: en un día de tránsito (una ciudad termina
  // y otra empieza ese día) mañana es la ciudad a la que llegas. Antes esta
  // pestaña decía "Madrid" y la tarjeta de Hoy decía "Barcelona" para el
  // mismo día.
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

  const tomorrowDocs  = allDocs.filter(d => (d.date === tomorrowStr || d.valid_from === tomorrowStr || d.start_date === tomorrowStr) && isDocInMyRoute(d, currentUserEmail, trip?.members || []));
  const tomorrowSpots = tomorrowCity
    ? allSpots.filter(s => !isStaySpot(s) && s.city_id === tomorrowCity.id && s.assigned_date === tomorrowStr)
        .sort((a, b) => (a.day_order ?? 999) - (b.day_order ?? 999))
    : [];

  // José (22 sep 2026) -- auditoría: faltaba por completo. DayCard.jsx solo
  // guarda de verdad si le llega onUpdateItemTime (`if (onUpdateItemTime)
  // await onUpdateItemTime(...)`); sin él, editar la hora de un spot o
  // documento desde esta pestaña actualizaba solo el estado local de la
  // hoja (parecía guardado, la hoja se cerraba con la hora nueva) pero
  // nunca llegaba a persistirse. Mismo handler que ya tienen TodayTab.jsx
  // e InicioTab.jsx, adaptado a "mañana" en vez de "hoy".
  const handleUpdateItemTime = async (item, time) => {
    const timeIsChanging = (time || '') !== (item.time || '');
    if (item._kind === 'doc') {
      const oldTime = item.time || '';
      await base44.entities.Ticket.update(item.id, { time, ...(timeIsChanging ? { day_order: null } : {}) });
      invalidateTripDocs(queryClient, tripId);
      if (timeIsChanging) {
        cancelTicketReminder(item.id);
        if (isDocForUser(item, currentUserEmail)) scheduleTicketReminder({ ...item, time, trip_id: item.trip_id || tripId });
        requestTicketPush({ ...item, time });
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

  if (!tomorrowCity) return (
    <div className="bg-card rounded-2xl border border-border text-center py-12 px-4">
      <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-3">
        <Calendar className="w-6 h-6 text-muted-foreground/50" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">{t('home.tomorrow.emptyTitle')}</p>
      <p className="text-xs text-muted-foreground">{t('home.tomorrow.emptyHint')}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <DayCard
        label={t('common.tomorrow')}
        city={tomorrowCity}
        docs={tomorrowDocs}
        spots={tomorrowSpots}
        itineraryDays={itineraryDays}
        dateStr={tomorrowStr}
        tripId={tripId}
        defaultOpen={true}
        // José (21 sep 2026): faltaba esta prop — TodayTab ya la pasaba, pero
        // esta pestaña no, así que "Mañana" pedía "+ Añadir alojamiento"
        // aunque la ciudad ya tuviera uno guardado. El alojamiento es de la
        // estancia entera, no de un día: mañana tiene el mismo que hoy.
        hotelSpot={getCityHotel(allSpots, tomorrowCity.id)}
        onUpdateItemTime={handleUpdateItemTime}
        onReorderSpots={async (newOrder) => {
          await Promise.all(newOrder.map((spot, idx) =>
            base44.entities.Spot.update(spot.id, { day_order: idx })
          ));
          queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
        }}
        trip={trip}
        currentUserEmail={currentUserEmail}
        profiles={profiles}
      />
    </div>
  );
}
