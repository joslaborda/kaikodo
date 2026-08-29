import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Users, Car, FileText, Hotel, TrainFront } from 'lucide-react';
import { BusFront, PlaneIcon } from '@/lib/icons';
import { getCountryMeta } from '@/lib/countryConfig';
import { getTripCoverImage } from '@/lib/tripImage';
import { daysUntil } from '@/lib/tripDays';
import MemberAvatarRow from './MemberAvatarRow';
import PDFViewer from '@/components/PDFViewer';
import { resolveDocViewUrl } from '@/lib/privateFiles';
import { useTranslation } from 'react-i18next';

export default function InicioTab({ trip, cities, documents, packingItems, profiles, tripId, onInvite, currentUserEmail }) {
  const { t } = useTranslation();
  const [viewFile, setViewFile] = useState(null);
  const todayStr  = format(new Date(), 'yyyy-MM-dd');
  const tripStart = trip?.start_date || '';
  const daysLeft  = tripStart ? daysUntil(tripStart) : null;
  const isDeparture = daysLeft === 0;

  const sortedCities = useMemo(() =>
    [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
    [cities]
  );

  const TRANSPORT_TYPES = ['flight', 'train', 'bus', 'car'];
  const todayDocs = documents.filter(d => {
    const docDate = d.date || d.valid_from || d.start_date;
    return docDate === todayStr;
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

  const firstDoc = todayDocs[0] || null;
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

  const packedCount = packingItems.filter(i => i.packed).length;
  const packedPct   = packingItems.length ? Math.round(packedCount / packingItems.length * 100) : 0;

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

  const coverImage = getTripCoverImage(trip, cities);

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
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.75) 0%, rgba(0,0,0,.15) 100%)' }} />
        {countryMeta?.flag && (
          <div style={{ position: 'absolute', top: 14, right: 16, fontSize: 32, zIndex: 1 }}>{countryMeta.flag}</div>
        )}
        <div style={{ position: 'relative', zIndex: 1, padding: '16px 16px 18px' }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: 'var(--kodo-hero-eyebrow)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            {isDeparture ? t('home.departure.today') : t('home.departure.tomorrow')}
          </p>
          <p style={{ fontSize: 22, fontWeight: 500, color: 'white', lineHeight: 1.2, marginBottom: 6 }}>
            {heroHeadline}<br/>{t('home.inicio.awaits')}
          </p>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>{heroSubtitle}</p>
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
        </div>
      )}

      {packingItems.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-foreground">{t('utilities.packing.tabMaleta')}</p>
            <p className="text-sm font-medium text-primary">{packedPct}%</p>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden mb-1">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: packedPct + '%' }} />
          </div>
          <p className="text-xs text-muted-foreground">{t('home.inicio.packedReady', { packed: packedCount, total: packingItems.length })}</p>
        </div>
      )}

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4" />{t('home.travelers')}
          </p>
        </div>
        <MemberAvatarRow trip={trip} profiles={profiles} onInvite={onInvite} currentUserEmail={currentUserEmail} />
      </div>

      <PDFViewer fileUrl={viewFile} onClose={() => setViewFile(null)} />
    </div>
  );
}
