import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { getCountryMeta, normalizeCountry, getCountryLabel } from '@/lib/countryConfig';
import { CitySearch, CountryField } from '@/components/trip/stopFields';
import TripDateRangePicker from '@/components/trip/TripDateRangePicker';
import NewTripInvitees from '@/components/trip/NewTripInvitees';
import { cityDateSpan } from '@/lib/tripDates';
import { useTranslation } from 'react-i18next';
import { differenceInCalendarDays, parseISO, format } from 'date-fns';
import { es } from 'date-fns/locale';

// José (24 sep 2026): formulario de viaje nuevo rehecho.
//  - Sin modo "noches", sin "Auto-repartir", sin fechas generales del viaje y
//    sin selector "1 destino / Multi-ciudad": un viaje es una lista de
//    paradas, cada una con SUS fechas. Las del viaje se calculan solas (la
//    primera salida y la última vuelta -- mismo criterio que tripDates.js).
//  - Fechas OPCIONALES por parada ("Fechas por confirmar"): se puede crear
//    un viaje sin haber cerrado aún cuántos días va a cada sitio.
//  - Un solo campo por parada: la ciudad. El país sale de la sugerencia de
//    Google; solo se pide a mano si se escribe una ciudad sin elegir
//    sugerencia.
//  - Invitar viajeros al crear (NewTripInvitees), con el mismo buscador y
//    los mismos "Han viajado contigo" que Ajustes del viaje. Las
//    invitaciones se envían al pulsar "Crear viaje".

const DEFAULT_FORM = {
  name: '',
  description: '',
  currency: 'EUR', currency_symbol: '€',
  language: 'Español', language_code: 'es-ES',
};

let stopSeq = 0;
const newStop = (patch = {}) => ({ id: ++stopSeq, city: '', country: '', lat: null, lng: null, placeId: null, start_date: '', end_date: '', ...patch });

// "Kanagawa, Japón" -> "Japón" (canónico en español). '' si no es un país conocido.
// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function NewTripModal({ open, onOpenChange, onSubmit, isPending }) {
  const { t, i18n } = useTranslation();
  const fmtShort = (d) => format(parseISO(d), 'd MMM', { locale: i18n.language === 'en' ? undefined : es });
  const [formData, setFormData] = useState({ ...DEFAULT_FORM });
  const [stops, setStops] = useState([]);
  const [editingId, setEditingId] = useState(null); // parada cuya ciudad se está cambiando
  const [invitees, setInvitees] = useState([]);
  const [attempted, setAttempted] = useState(false);

  const nameRef = useRef(null);
  const stopsRef = useRef(null);

  const span = cityDateSpan(stops);
  const spanDays = span ? differenceInCalendarDays(parseISO(span.end), parseISO(span.start)) + 1 : null;
  const missingName = attempted && !formData.name.trim();
  const missingStops = attempted && stops.length === 0;
  const stopMissingCountry = (s) => !s.country?.trim();
  const anyMissingCountry = stops.some(stopMissingCountry);

  const canCreate = formData.name.trim() && stops.length > 0 && !anyMissingCountry && !isPending;

  // Límites del calendario de cada parada: no solaparse con la parada
  // fechada anterior ni con la siguiente (el mismo día vale: día de tránsito).
  const boundsFor = (idx) => {
    const prev = [...stops.slice(0, idx)].reverse().find(s => s.end_date);
    const next = stops.slice(idx + 1).find(s => s.start_date);
    return { min: prev?.end_date || undefined, max: next?.start_date || undefined };
  };

  function pickCityInto(id, data, { coordsOnly = false } = {}) {
    setStops(prev => prev.map(s => {
      if (s.id !== id) return s;
      if (coordsOnly) return s.placeId === data.placeId ? { ...s, lat: data.lat, lng: data.lng } : s;
      return { ...s, ...data, country: data.country || s.country };
    }));
    if (!coordsOnly) setEditingId(null);
  }

  function addStopFrom(data, opts = {}) {
    if (opts.coordsOnly) {
      setStops(prev => prev.map(s => (s.placeId && s.placeId === data.placeId ? { ...s, lat: data.lat, lng: data.lng } : s)));
      return;
    }
    // Sin país en la sugerencia: se hereda el de la parada anterior como
    // punto de partida (sigue siendo editable).
    setStops(prev => {
      const last = prev[prev.length - 1];
      return [...prev, newStop({ ...data, country: data.country || (data.placeId ? '' : last?.country || '') })];
    });
  }

  function updateStop(id, patch) { setStops(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s))); }
  function removeStop(id) { setStops(prev => prev.filter(s => s.id !== id)); }

  function handleSubmit() {
    setAttempted(true);
    if (!formData.name.trim()) { nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); nameRef.current?.focus(); return; }
    if (stops.length === 0 || anyMissingCountry) { stopsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

    const firstCountry = stops[0].country;
    const firstMeta = getCountryMeta(firstCountry);
    onSubmit({
      formData: {
        ...formData,
        start_date: span?.start || '',
        end_date: span?.end || '',
        country: normalizeCountry(firstCountry),
        destination: stops.map(s => s.city).join(' → '),
        currency: firstMeta.currency,
        currency_symbol: firstMeta.symbol,
        language: firstMeta.languageLabel,
        language_code: firstMeta.languageCode,
      },
      stops: stops.map(s => s.city),
      stopCoords: stops.map(s => ({ lat: s.lat ?? undefined, lng: s.lng ?? undefined, placeId: s.placeId ?? undefined })),
      stopCountries: stops.map(s => normalizeCountry(s.country)),
      // Fechas por parada; vacías = "por confirmar".
      allocations: stops.map(s => ({ start_date: s.start_date || '', end_date: s.end_date || '' })),
      invitees,
      selectedTemplate: null,
    });
  }

  function handleClose() {
    onOpenChange(false);
    setFormData({ ...DEFAULT_FORM });
    setStops([]);
    setEditingId(null);
    setInvitees([]);
    setAttempted(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-foreground text-2xl">{t('trip.newTrip')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">

          {/* 1. Nombre */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              {t('trip.new.tripName')} <span className="text-primary">*</span>
            </label>
            <input
              ref={nameRef}
              placeholder={t('trip.new.namePlaceholder')}
              value={formData.name}
              onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
              autoCapitalize="sentences" autoCorrect="on" spellCheck
              className={`w-full h-10 border rounded-xl px-3 text-sm outline-none transition-colors ${
                missingName ? 'border-red-400 bg-red-50 focus:border-red-500' : 'border-border bg-card focus:border-primary'
              }`}
            />
            {missingName && <p className="text-xs text-red-500 mt-1">{t('trip.new.nameRequired')}</p>}
          </div>

          {/* 2. Paradas — línea numerada como en Ajustes del viaje y Ruta */}
          <div ref={stopsRef}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <label className="text-sm font-medium text-foreground">
                {t('trip.new.stops')} <span className="text-primary">*</span>
              </label>
              <span className="text-xs text-muted-foreground">
                {span
                  ? t('trip.new.spanSummary', { range: `${fmtShort(span.start)} → ${fmtShort(span.end)}`, days: t('trip.dates.days', { count: spanDays }) })
                  : stops.length > 0 ? t('trip.dates.pending') : ''}
              </span>
            </div>

            <div>
              {stops.map((s, idx) => {
                const b = boundsFor(idx);
                const noCountry = stopMissingCountry(s);
                return (
                  <div key={s.id} className="flex gap-3">
                    <div className="flex flex-col items-center w-6 flex-shrink-0">
                      <div className="w-6 h-6 rounded-full border-[1.5px] border-orange-300 bg-orange-50 dark:bg-orange-950/30 text-primary text-[11px] font-bold flex items-center justify-center">{idx + 1}</div>
                      <div className="flex-1 w-[1.5px] bg-orange-200 dark:bg-orange-900/50 my-1" />
                    </div>
                    <div className="flex-1 min-w-0 bg-card border border-border rounded-2xl px-3 py-2.5 mb-2.5">
                      <div className="flex items-start gap-2">
                        {editingId === s.id ? (
                          <CitySearch initial={s.city} autoFocus placeholder={t('trip.new.searchCity')}
                            onPick={(data, opts) => pickCityInto(s.id, data, opts)}
                            onCancel={() => setEditingId(null)} />
                        ) : (
                          <button type="button" onClick={() => setEditingId(s.id)} className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-semibold text-foreground truncate">{s.city}</p>
                            {!noCountry && s.placeId && <p className="text-xs text-muted-foreground truncate">{getCountryLabel(s.country, i18n.language)}</p>}
                          </button>
                        )}
                        <button type="button" onClick={() => removeStop(s.id)} aria-label={t('trip.new.removeStop')}
                          className="w-8 h-8 -m-1 rounded-full flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-secondary flex-shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {/* Ciudad escrita a mano (sin sugerencia de Google): el país
                          se pide aquí -- heredado de la parada anterior como
                          punto de partida, pero editable (viaje multi-país). */}
                      {(noCountry || !s.placeId) && editingId !== s.id && (
                        <div className="mt-2">
                          <CountryField value={s.country} hasError={attempted && noCountry}
                            onChange={v => updateStop(s.id, { country: v })} />
                          {attempted && noCountry && <p className="text-xs text-red-500 mt-1">{t('trip.new.countryNeeded')}</p>}
                        </div>
                      )}
                      <div className="mt-2">
                        <TripDateRangePicker
                          variant="pill"
                          start={s.start_date}
                          end={s.end_date}
                          minDate={b.min}
                          maxDate={b.max}
                          onChange={({ start, end }) => updateStop(s.id, { start_date: start, end_date: end })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Añadir parada: el buscador ES la siguiente parada */}
              <div className="flex gap-3 items-center">
                <div className="w-6 flex-shrink-0 flex justify-center">
                  <div className="w-6 h-6 rounded-full border-[1.5px] border-dashed border-orange-300 text-primary flex items-center justify-center">
                    <Plus className="w-3.5 h-3.5" />
                  </div>
                </div>
                <CitySearch
                  key={stops.length}
                  placeholder={stops.length === 0 ? t('trip.new.firstCity') : t('trip.new.addCity')}
                  onPick={addStopFrom}
                />
              </div>
            </div>
            {missingStops && <p className="text-xs text-red-500 mt-2 pl-9">{t('trip.new.stopRequired')}</p>}
          </div>

          {/* 3. Viajeros — mismo buscador que Ajustes del viaje */}
          <NewTripInvitees value={invitees} onChange={setInvitees} />

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
            <Button
              type="button"
              onClick={handleSubmit}
              className="bg-primary hover:bg-primary/90 text-white"
              disabled={(attempted && !canCreate) || isPending}
            >
              {isPending ? t('trip.new.creating') : t('trip.create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

