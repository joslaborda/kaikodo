import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, differenceInDays, parseISO } from 'date-fns';
import { normalizeCountry } from '@/lib/countryConfig';
import { normalizeEmail } from '@/lib/utils';
import { es } from 'date-fns/locale';
import { ArrowRight, Calendar, Compass, DollarSign, MapPin, Users, X } from 'lucide-react';
import { PlaneIcon } from '@/lib/icons';
import { useTranslation } from 'react-i18next';
import Avatar from '@/components/trip/Avatar';

const MAX_AVATARS = 4;

// Antes esta pantalla tenía su propia lógica local de avatar/nombre —
// comparación de email sin normalizeEmail() y, si no encontraba el perfil,
// mostraba el email en crudo en vez del nombre. Es el mismo bug (y el mismo
// fallback roto) que ya se eliminó de Avatar.jsx/InviteModal.jsx/
// Expenses.jsx en la ronda anterior, solo que en un archivo que no se tocó
// entonces — auditoría v2, punto 1.2. Se sustituye por el componente
// compartido, que nunca cae al email.
function TravelersSheet({ open, onClose, trip, profilesByEmail, currentUserEmail }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? undefined : es;
  if (!open) return null;
  const memberEmails = (trip?.members || []).map(normalizeEmail);
  const roles = trip?.roles || {};
  const tripCreator = normalizeEmail(trip?.created_by);
  const dateRange = trip?.start_date && trip?.end_date
    ? `${format(parseISO(trip.start_date), 'dd MMM', { locale: dateLocale })} – ${format(parseISO(trip.end_date), 'dd MMM yyyy', { locale: dateLocale })}`
    : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-background rounded-t-3xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Handle + header */}
        <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 mb-0" />
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="text-base font-semibold text-foreground">{t('home.finished.travelers')}</p>
            {dateRange && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {trip?.name} · {dateRange}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4 text-foreground" />
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {memberEmails.map((email, i) => {
            const isAdmin = roles[email] === 'admin' || tripCreator === email;
            const isMe = email === currentUserEmail;

            return (
              <div key={email} className={`flex items-center gap-3 px-5 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <Avatar email={email} profiles={profilesByEmail} size={40} showName isMe={isMe} />
                </div>
                {isAdmin && (
                  <span className="text-xs bg-orange-50 text-primary border border-orange-200 px-2 py-0.5 rounded-full flex-shrink-0">
                    {t('common.admin')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="h-8" />
      </div>
    </div>,
    document.body
  );
}

export default function FinishedTab({ trip, cities, expenses, spots, tripId, currentUserEmail, profiles = [] }) {
  const [showTravelers, setShowTravelers] = useState(false);
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? undefined : es;
  const allTripSpots = spots;
  const meNorm = normalizeEmail(currentUserEmail);

  // profiles llega como array — Avatar.jsx espera un mapa por email
  // normalizado (mismo patrón que profilesByEmail en Expenses.jsx).
  const profilesByEmail = useMemo(() => {
    const map = {};
    profiles.forEach(p => {
      const key = normalizeEmail(p.email || p.user_email);
      if (key) map[key] = p;
    });
    return map;
  }, [profiles]);

  const isSettlement = (e) => e.is_settlement === true || (e.description || '').startsWith('Liquidación:');
  const realExpenses = expenses.filter(e => !isSettlement(e));

  const totalDays = (trip?.start_date && trip?.end_date)
    ? differenceInDays(parseISO(trip.end_date), parseISO(trip.start_date)) + 1
    : null;
  const totalSpent  = realExpenses.reduce((s, e) => s + Math.max(0, parseFloat(e.amount_base || e.amount) || 0), 0);
  const avgPerDay   = totalDays ? totalSpent / totalDays : 0;
  const visitedSpots = allTripSpots.filter(s => !!s.assigned_date).length;
  const currency    = trip?.currency || 'EUR';
  const memberEmails = (trip?.members || []).map(normalizeEmail);
  const memberCount = memberEmails.length;

  const allCountries = useMemo(() => {
    const sources = cities.length > 0
      ? cities.map(c => c.country).filter(Boolean)
      : [trip?.country].filter(Boolean);
    const seen = {};
    sources.forEach(s => {
      const esName = normalizeCountry(s) || s;
      if (esName && !seen[esName]) seen[esName] = esName;
    });
    return Object.values(seen);
  }, [trip, cities]);

  const sortedCities = useMemo(() =>
    [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
    [cities]
  );

  const countriesLabel = (() => {
    if (cities.length === 0) return trip?.destination || '';
    if (cities.length === 1) return sortedCities[0]?.name || trip?.destination || '';
    const countries = [...allCountries];
    if (countries.length === 0) return trip?.destination || '';
    if (countries.length === 1) return countries[0];
    // Intl.ListFormat pone la conjunción correcta según idioma ("y" en
    // español, "and" en inglés) en vez de la "y" fija que había antes.
    return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(countries);
  })();

  // Avatares con overflow
  const visibleMembers = memberEmails.slice(0, MAX_AVATARS);
  const overflow = memberCount - MAX_AVATARS;

  // Mismo cálculo que Expenses.jsx (StatsTab.myByCategory) — amounts_by_user
  // y split_with pueden venir sin normalizar, así que la clave/comparación
  // se hace siempre contra el email normalizado, nunca contra el crudo.
  const myShare = realExpenses.reduce((s, e) => {
    // Mismos dos guards que ya tienen BalancesTab/StatsTab en Expenses.jsx:
    // Math.max(0, ...) contra importes negativos (amount y cada entrada de
    // amounts_by_user) y un Set contra emails duplicados en split_with. Esta
    // pantalla de resumen de fin de viaje reimplementaba el cálculo sin
    // ninguno de los dos, reintroduciendo ambos bugs aquí.
    const amt = Math.max(0, parseFloat(e.amount_base || e.amount) || 0);
    if (!amt) return s;
    const myShareKey = Object.keys(e.amounts_by_user || {}).find(k => normalizeEmail(k) === meNorm);
    if (e.split_type === 'custom' && myShareKey) {
      const total = Object.values(e.amounts_by_user).reduce((t, v) => t + Math.max(0, parseFloat(v) || 0), 0);
      return s + (total > 0 ? (Math.max(0, parseFloat(e.amounts_by_user[myShareKey]) || 0) / total) * amt : 0);
    }
    const parts = [...new Set((e.split_with?.length > 0 ? e.split_with : [e.paid_by]).map(normalizeEmail))];
    if (!parts.includes(meNorm)) return s;
    return s + amt / parts.length;
  }, 0);

  return (
    <div className="space-y-3">
      {/* Hero */}
      <div className="bg-card rounded-2xl border border-orange-200 p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center mx-auto mb-3">
          <PlaneIcon className="w-7 h-7 text-primary" />
        </div>
        <p className="text-sm text-muted-foreground mb-1">{t('home.finished.thanksForVisiting')}</p>
        <p className="text-2xl font-semibold text-foreground">{countriesLabel}</p>
        {trip?.start_date && trip?.end_date && (
          <p className="text-xs text-muted-foreground mt-2">
            {format(parseISO(trip.start_date), 'dd MMM', { locale: dateLocale })} – {format(parseISO(trip.end_date), 'dd MMM yyyy', { locale: dateLocale })}
          </p>
        )}
      </div>

      {/* Grid stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: t('home.finished.tripDays'), value: totalDays || '—', Icon: Calendar },
          { label: t('home.finished.cities'),      value: cities.length,    Icon: MapPin },
          { label: t('home.finished.visitedSpots'), value: visitedSpots,  Icon: Compass },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-2xl border border-border p-4" style={{ minHeight: 120 }}>
            <s.Icon className="w-4 h-4 text-primary mb-2" />
            <p className="text-2xl font-medium text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}

        {/* Viajeros — avatares como protagonistas */}
        <button
          className="bg-card rounded-2xl border border-border p-4 text-left hover:bg-secondary/30 transition-colors"
          style={{ minHeight: 120 }}
          onClick={() => setShowTravelers(true)}
        >
          <Users className="w-4 h-4 text-primary mb-2" />
          <div className="flex items-center">
            {visibleMembers.map((email, i) => (
              <div key={email} className="border-2 border-card rounded-full flex-shrink-0" style={{ marginLeft: i > 0 ? -8 : 0 }}>
                <Avatar email={email} profiles={profilesByEmail} size={36} />
              </div>
            ))}
            {overflow > 0 && (
              <div
                className="w-9 h-9 rounded-full bg-secondary border-2 border-card flex items-center justify-center flex-shrink-0"
                style={{ marginLeft: -8 }}>
                <span className="text-muted-foreground text-xs font-medium">+{overflow}</span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">{memberCount} {memberCount === 1 ? t('home.finished.traveler') : t('home.finished.travelers')}</p>
        </button>

        {/* Gastos */}
        <div className="bg-card rounded-2xl border border-border p-4 col-span-2">
          <DollarSign className="w-4 h-4 text-primary mb-2" />
          <p className="text-xs text-muted-foreground mb-0.5">{t('home.finished.yourPart')}</p>
          <p className="text-2xl font-medium text-foreground">{myShare.toFixed(0)} {currency}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('home.finished.groupTotal')}: <span className="font-medium text-foreground">{totalSpent.toFixed(0)} {currency}</span>
            {avgPerDay > 0 && <>{' · '}{t('home.finished.perDay', { amount: avgPerDay.toFixed(0), currency })}</>}
          </p>
        </div>
      </div>

      {/* Ruta */}
      {sortedCities.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-xs text-muted-foreground mb-3">{t('home.finished.tripRoute')}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {sortedCities.map((city, i) => (
              <span key={city.id} className="flex items-center gap-2">
                {i > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-sm font-medium text-foreground">{city.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <TravelersSheet
        open={showTravelers}
        onClose={() => setShowTravelers(false)}
        trip={trip}
        profilesByEmail={profilesByEmail}
        currentUserEmail={meNorm}
      />
    </div>
  );
}
