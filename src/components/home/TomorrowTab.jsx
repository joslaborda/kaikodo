import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Calendar } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import DayCard from './DayCard';
import { useTranslation } from 'react-i18next';
import { isStaySpot, getCityHotel } from '@/lib/cityStay';
import { isDocInMyRoute } from '@/lib/docHolders';

export default function TomorrowTab({ trip, cities, tripId, currentUserEmail, profiles }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const tomorrowStr = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd');

  const sortedCities = useMemo(() =>
    [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
    [cities]
  );

  const tomorrowCity = useMemo(() =>
    sortedCities.find(c => c.start_date && c.end_date && tomorrowStr >= c.start_date && tomorrowStr <= c.end_date) ||
    sortedCities.find(c => c.start_date === tomorrowStr),
    [sortedCities, tomorrowStr]
  );

  const { data: allDocs = [] } = useQuery({
    queryKey: ['allDocs', tripId],
    queryFn: () => base44.entities.Ticket.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 60000, refetchOnMount: 'always',
  });

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
