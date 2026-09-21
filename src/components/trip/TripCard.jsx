import { Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { useTripCoverImage } from '@/lib/tripImage';
import { getCountryMeta } from '@/lib/countryConfig';

// Devuelve solo datos: el texto lo pone quien renderiza, con su t(). Antes
// construía labels en español ('En 3 días', 'Finalizado') que nadie llegaba a
// usar — los consumidores solo miran type/days/dayNum/total.
export function getTripStatus(trip) {
  if (!trip.start_date) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(trip.start_date + 'T00:00:00');
  const end = trip.end_date ? new Date(trip.end_date + 'T00:00:00') : null;
  if (today < start) {
    const days = differenceInDays(start, today);
    return { days, type: 'upcoming' };
  }
  if (end && today > end) return { type: 'past' };
  if (end) {
    const dayNum = differenceInDays(today, start) + 1;
    const total  = differenceInDays(end, start) + 1;
    return { dayNum, total, type: 'active' };
  }
  return { type: 'active' };
}

function getTripDuration(trip) {
  if (!trip.start_date || !trip.end_date) return null;
  return differenceInDays(new Date(trip.end_date), new Date(trip.start_date)) + 1;
}

function formatDateRange(trip) {
  if (!trip.start_date) return null;
  const s = format(new Date(trip.start_date+'T12:00:00'), 'd MMM', { locale:es });
  if (!trip.end_date) return s;
  return `${s} – ${format(new Date(trip.end_date+'T12:00:00'), 'd MMM', { locale:es })}`;
}

function getRouteSubtitle(trip, cities) {
  if (cities.length > 0)
    // Por fecha (no solo por `order`): las paradas añadidas desde Ajustes no lo tenían.
    return [...cities].sort((a,b)=>(a.start_date||'9999').localeCompare(b.start_date||'9999') || (a.order??0)-(b.order??0)).map(c=>c.name).join(' · ');
  return trip.country || trip.destination || '';
}

function getFlag(trip, cities) {
  const country = cities[0]?.country || trip.country || trip.destination || '';
  return getCountryMeta(country)?.flag || '🌍';
}

// ── Hero card ─────────────────────────────────────────────────────────────────
export function HeroTripCard({ trip, cities = [] }) {
  const { t } = useTranslation();
  const coverImage = useTripCoverImage(trip, cities);
  const status     = getTripStatus(trip);
  const dateRange  = formatDateRange(trip);
  const subtitle   = getRouteSubtitle(trip, cities);
  const duration   = getTripDuration(trip);

  const badgeCls = status?.type==='active'
    ? 'bg-green-50/90 text-green-700 border border-green-200'
    : status?.type==='upcoming'
      ? 'bg-orange-50/90 text-primary border border-orange-200'
      : 'bg-secondary text-muted-foreground border border-border';

  const statusLabel = status?.type === 'active'
    ? t('trip.statusActive')
    : status?.type === 'upcoming'
      ? t('trip.statusUpcoming')
      : t('trip.statusPast');

  // Only show top-left badge for active trips (day counter). Upcoming countdown is top-right only.
  const topLeft = status?.type==='active' && status.dayNum
    ? t('trip.dayOf', { day: status.dayNum, total: status.total })
    : null;

  return (
    // José (18 sep 2026, en vivo): con 2 viajes activos las tarjetas salían
    // pegadas -- Link renderiza como <a>, display:inline por defecto, y el
    // margin-top que le da space-y-4 en TripsList.jsx no hace nada en un
    // elemento inline. block lo arregla sin tocar el layout interno.
    <Link to={createPageUrl(`Home?trip_id=${trip.id}`)} className="block">
      <div className="rounded-2xl overflow-hidden border border-border hover:shadow-lg transition-shadow">
        <div className="h-44 relative overflow-hidden" style={{background:"var(--kodo-hero-bg)"}}>
          <img src={coverImage} alt={trip.name}
            className="w-full h-full object-cover opacity-85"
            onError={e=>{
              // Try Colombia Pexels fallback, then hide
              if (!e.currentTarget.dataset.fallback) {
                e.currentTarget.dataset.fallback = '1';
                e.currentTarget.src = 'https://images.pexels.com/photos/3601425/pexels-photo-3601425.jpeg?auto=compress&cs=tinysrgb&w=800';
              } else {
                e.currentTarget.style.display='none';
              }
            }}/>
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10"/>
          {status && (
            <div className={`absolute top-2.5 right-2.5 text-xs font-medium px-2.5 py-1 rounded-full ${badgeCls}`}>
              {statusLabel}
            </div>
          )}
          {topLeft && (
            <div className="absolute top-2.5 left-2.5 bg-black/35 rounded-lg px-2.5 py-1">
              <p className="text-xs font-medium text-white leading-none">{topLeft}</p>
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 px-3 pb-3">
            <p className="text-base font-medium text-white mb-1">{trip.name}</p>
            {subtitle && <p className="text-xs text-white/70 truncate mb-2">{subtitle}</p>}
            <div className="flex gap-1.5">
              {duration && <div className="bg-white/15 rounded-lg px-2 py-1 text-xs text-white/90">{duration} {t('common.days')}</div>}
              {trip.members?.length > 0 && <div className="bg-white/15 rounded-lg px-2 py-1 text-xs text-white/90 flex items-center gap-1"><Users size={11} />{trip.members.length}</div>}
              {cities.length > 0 && <div className="bg-white/15 rounded-lg px-2 py-1 text-xs text-white/90">{cities[0].name}</div>}
            </div>
          </div>
        </div>
        <div className="bg-card px-3 py-2.5 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{dateRange || t('trip.noDates')}</p>
          <p className="text-xs text-primary font-medium">{t('trip.open')} →</p>
        </div>
      </div>
    </Link>
  );
}

// ── Compact card ──────────────────────────────────────────────────────────────
export default function TripCard({ trip, cities = [] }) {
  const { t } = useTranslation();
  const coverImage = useTripCoverImage(trip, cities);
  const status     = getTripStatus(trip);
  const dateRange  = formatDateRange(trip);
  const subtitle   = getRouteSubtitle(trip, cities);
  const flag       = getFlag(trip, cities);
  const isPast     = status?.type === 'past';

  const badgeCls = isPast
    ? 'bg-secondary text-muted-foreground border border-border'
    : 'bg-orange-50 text-primary border border-orange-200';

  const badgeLabel = isPast
    ? t('trip.statusPast')
    : status?.days != null
      ? t('trip.daysLeft', { count: status.days })
      : t('trip.statusActive');

  return (
    <Link to={createPageUrl(`Home?trip_id=${trip.id}`)} className="block">
      <div className={`bg-card border border-border rounded-2xl p-3 flex items-center gap-3 transition-colors relative shadow-sm ${isPast ? 'opacity-65' : ''}`}>
        <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-secondary flex items-center justify-center text-2xl">
          <img src={coverImage} alt={trip.name}
            className={`w-full h-full object-cover ${isPast?'grayscale-[30%]':''}`}
            onError={e=>{
              e.currentTarget.style.display='none';
              if (e.currentTarget.parentElement) e.currentTarget.parentElement.innerHTML=`<span style="font-size:26px">${flag}</span>`;
            }}/>
        </div>
        <div className="flex-1 min-w-0 pr-16">
          <p className="text-sm font-medium text-foreground truncate mb-1">{trip.name}</p>
          {subtitle && <p className="text-xs text-muted-foreground truncate mb-1">{subtitle}</p>}
          <p className="text-xs text-muted-foreground">
            {dateRange || t('trip.noDates')}{trip.members?.length > 0 ? ` · ${trip.members.length}` : ''}
          </p>
        </div>
        {status && (
          <div className={`absolute top-2.5 right-2.5 text-xs font-medium px-2 py-0.5 rounded-full ${badgeCls}`}>
            {badgeLabel}
          </div>
        )}
      </div>
    </Link>
  );
}
