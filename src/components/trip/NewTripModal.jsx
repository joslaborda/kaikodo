import { useState, useRef, forwardRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus, X, Shuffle, AlertTriangle } from 'lucide-react';
import { getCountryMeta, normalizeCountry, getCountryOptions, searchCountries, getCountryLabel } from '@/lib/countryConfig';
import CityInput from '@/components/trip/CityInput';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';

// ─── Currency options ─────────────────────────────────────────────────────────
const CURRENCY_OPTIONS = [
  { value: 'EUR', label: 'EUR (€)' }, { value: 'USD', label: 'USD ($)' },
  { value: 'GBP', label: 'GBP (£)' }, { value: 'JPY', label: 'JPY (¥)' },
  { value: 'CHF', label: 'CHF (Fr)' }, { value: 'MXN', label: 'MXN ($)' },
  { value: 'ARS', label: 'ARS ($)' }, { value: 'BRL', label: 'BRL (R$)' },
  { value: 'THB', label: 'THB (฿)' }, { value: 'KRW', label: 'KRW (₩)' },
  { value: 'CNY', label: 'CNY (¥)' }, { value: 'VND', label: 'VND (₫)' },
  { value: 'MAD', label: 'MAD (DH)' }, { value: 'TRY', label: 'TRY (₺)' },
  { value: 'SGD', label: 'SGD ($)' }, { value: 'IDR', label: 'IDR (Rp)' },
  { value: 'CAD', label: 'CAD ($)' }, { value: 'AUD', label: 'AUD ($)' },
  { value: 'NZD', label: 'NZD ($)' }, { value: 'NOK', label: 'NOK (kr)' },
  { value: 'SEK', label: 'SEK (kr)' }, { value: 'DKK', label: 'DKK (kr)' },
  { value: 'PLN', label: 'PLN (zł)' }, { value: 'CZK', label: 'CZK (Kč)' },
  { value: 'HUF', label: 'HUF (Ft)' }, { value: 'INR', label: 'INR (₹)' },
  { value: 'MYR', label: 'MYR (RM)' }, { value: 'PHP', label: 'PHP (₱)' },
  { value: 'ZAR', label: 'ZAR (R)' }, { value: 'CLP', label: 'CLP ($)' },
  { value: 'COP', label: 'COP ($)' }, { value: 'PEN', label: 'PEN (S/)' },
  { value: 'AED', label: 'AED (د.إ)' }, { value: 'SAR', label: 'SAR (﷼)' },
  { value: 'EGP', label: 'EGP (£)' }, { value: 'RUB', label: 'RUB (₽)' },
  { value: 'CRC', label: 'CRC (₡)' },
];

function currencySymbol(code) {
  const map = { EUR:'€', USD:'$', GBP:'£', JPY:'¥', CHF:'Fr', THB:'฿', KRW:'₩', CNY:'¥', VND:'₫', MAD:'DH',
    TRY:'₺', BRL:'R$', IDR:'Rp', INR:'₹', PHP:'₱', MYR:'RM', ZAR:'R', CLP:'$', PEN:'S/', AED:'د.إ',
    NOK:'kr', SEK:'kr', DKK:'kr', PLN:'zł', CZK:'Kč', HUF:'Ft', RUB:'₽', CRC:'₡', COP:'$' };
  return map[code] || '$';
}

function addDays(dateStr, n) {
  // 'T00:00:00' fuerza medianoche local; format() evita la conversión a UTC que
  // desplazaba un día en husos positivos.
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return format(d, 'yyyy-MM-dd');
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function computeNightsDates(startDateStr, nightsArr) {
  if (!startDateStr) return [];
  const result = [];
  let cursor = startDateStr;
  for (const raw of nightsArr) {
    const n = Math.max(1, parseInt(raw) || 0);
    const start = cursor;
    const end = addDays(cursor, n - 1);
    result.push({ start_date: start, end_date: end });
    cursor = addDays(cursor, n);
  }
  return result;
}
function autoDistribute(startDateStr, endDateStr, count) {
  if (!startDateStr || !endDateStr || count <= 0) return [];
  const total = daysBetween(startDateStr, endDateStr) + 1;
  const base = Math.floor(total / count);
  const extra = total % count;
  const result = [];
  let cursor = startDateStr;
  for (let i = 0; i < count; i++) {
    const n = base + (i < extra ? 1 : 0);
    const start = cursor;
    const end = addDays(cursor, n - 1);
    result.push({ start_date: start, end_date: end });
    cursor = addDays(cursor, n);
  }
  return result;
}

const DEFAULT_FORM = {
  name: '', start_date: '', end_date: '',
  description: '',
  currency: 'EUR', currency_symbol: '€',
  language: 'Español', language_code: 'es-ES',
};

function defaultStops(mode) {
  return mode === 'single'
    ? [{ city: '', country: '', nights: '', manual: { start_date: '', end_date: '' } }]
    : [
        { city: '', country: '', nights: '', manual: { start_date: '', end_date: '' } },
        { city: '', country: '', nights: '', manual: { start_date: '', end_date: '' } },
      ];
}

// ─── Inline country autocomplete (free-text + suggestions from catalog) ───────
const CountryField = forwardRef(function CountryField({ value, onChange, hasError }, externalRef) {
  const { t, i18n } = useTranslation();
  // Lista de países en el idioma activo. `value` es siempre el canónico en
  // español (lo que se guarda en BD); `label` es lo que ve el usuario.
  const countries = useMemo(() => getCountryOptions(i18n.language), [i18n.language]);
  const [open, setOpen] = useState(false);
  // El valor llega como canónico español; se muestra en el idioma activo.
  const [q, setQ] = useState(() => (value ? getCountryLabel(value, i18n.language) : ''));
  const containerRef = useRef(null);

  useEffect(() => {
    setQ(value ? getCountryLabel(value, i18n.language) : '');
  }, [value, i18n.language]);

  useEffect(() => {
    const handler = e => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const suggestions = useMemo(() => {
    if (!q || q.length < 1) return [];
    return searchCountries(q, i18n.language, 8);
  }, [q, i18n.language]);

  const handleInput = e => {
    const v = e.target.value;
    setQ(v);
    // Texto libre: se normaliza a canónico (acepta "Spain", "España", "ES"...).
    onChange(normalizeCountry(v) || v);
    setOpen(true);
  };

  const handleSelect = c => {
    setQ(c.label);       // se muestra en el idioma activo
    onChange(c.value);   // se guarda SIEMPRE el canónico en español
    setOpen(false);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        // Al salir, fijar el canónico y mostrar su nombre en el idioma activo.
        if (q.trim()) {
          try {
            const hit = searchCountries(q, i18n.language, 1)[0];
            if (hit && (hit.label.toLowerCase() === q.toLowerCase()
                     || hit.value.toLowerCase() === q.toLowerCase())) {
              setQ(hit.label);
              onChange(hit.value);
            }
          } catch {}
        }
        setOpen(false);
      }
    }, 150);
  };

  return (
    <div className="relative" ref={containerRef}>
      <input
        ref={externalRef}
        value={q}
        onChange={handleInput}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        placeholder={t('trip.new.countryRequired')}
        autoComplete="off"
        className={`w-full h-9 border rounded-xl px-3 text-sm outline-none transition-colors ${
          hasError ? 'border-red-400 bg-red-50 focus:border-red-500' : 'border-border bg-card focus:border-primary'
        }`}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto bg-card border border-border rounded-xl shadow-lg">
          {suggestions.map(c => (
            <li key={c.code} onMouseDown={() => handleSelect(c)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-orange-50 hover:text-primary transition-colors flex items-center gap-2">
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function NewTripModal({ open, onOpenChange, onSubmit, isPending }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({ ...DEFAULT_FORM });
  const [mode, setMode] = useState('multi');
  const [dateMode, setDateMode] = useState('nights');
  const [stops, setStops] = useState(defaultStops('multi'));
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [attempted, setAttempted] = useState(false); // for validation red highlight

  // Refs for scroll-to-error
  const nameRef = useRef(null);
  const startDateRef = useRef(null);
  const firstCountryRef = useRef(null);
  const nightsErrorRef = useRef(null);
    const endDateRef = useRef(null);

  const validStops = stops.filter(s => s.city.trim());
  const totalNightsEntered = stops.reduce((sum, s) => sum + (parseInt(s.nights) || 0), 0);
  const tripTotalDays = formData.start_date && formData.end_date
    ? daysBetween(formData.start_date, formData.end_date) + 1
    : null;
  const nightsAllocations = formData.start_date
    ? computeNightsDates(formData.start_date, stops.map(s => s.nights || 0))
    : [];

  let nightsError = null;
  if (formData.start_date && formData.end_date && stops.some(s => s.nights)) {
    const diff = totalNightsEntered - tripTotalDays;
    if (diff > 0) nightsError = t('trip.new.nightsExtra', { count: diff });
    else if (diff < 0) nightsError = t('trip.new.nightsMissing', { count: Math.abs(diff) });
  }

  const canCreate =
    formData.name.trim() &&
    stops[0]?.country?.trim() &&
    formData.start_date &&
    (!formData.end_date || formData.end_date >= formData.start_date) &&
    validStops.length > 0 &&
    !nightsError &&
    !isPending;

  // ── helpers ──────────────────────────────────────────────────────────────
  function applyStopCountry(idx, country) {
    updateStop(idx, { city: '', country });
    if (idx === 0 && !currencyTouched) {
      const meta = getCountryMeta(country);
      setFormData(prev => ({
        ...prev,
        currency: meta.currency,
        currency_symbol: meta.symbol,
        language: meta.languageLabel,
        language_code: meta.languageCode,
      }));
    }
  }

  function setMode_(m) { setMode(m); setStops(defaultStops(m)); }
  function updateStop(idx, patch) { setStops(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s)); }
  function updateStopManual(idx, patch) { setStops(prev => prev.map((s, i) => i === idx ? { ...s, manual: { ...s.manual, ...patch } } : s)); }
  function addStop() { setStops(prev => [...prev, { city: '', country: '', nights: '', manual: { start_date: '', end_date: '' } }]); }
  function removeStop(idx) { setStops(prev => prev.filter((_, i) => i !== idx)); }

  function autoDistributeNights() {
    if (!formData.start_date) return;
    const count = stops.length;
    if (formData.end_date) {
      const total = daysBetween(formData.start_date, formData.end_date) + 1;
      const base = Math.floor(total / count);
      const extra = total % count;
      setStops(prev => prev.map((s, i) => ({ ...s, nights: String(base + (i < extra ? 1 : 0)) })));
    } else {
      setStops(prev => prev.map(s => ({ ...s, nights: s.nights || '3' })));
    }
  }

  function autoDistributeManual() {
    if (!formData.start_date || !formData.end_date) return;
    const allocs = autoDistribute(formData.start_date, formData.end_date, stops.length);
    setStops(prev => prev.map((s, i) => ({ ...s, manual: { start_date: allocs[i]?.start_date || '', end_date: allocs[i]?.end_date || '' } })));
  }

  function computedTripEndDate() {
    if (formData.end_date) return formData.end_date;
    if (formData.start_date && totalNightsEntered > 0) return addDays(formData.start_date, totalNightsEntered - 1);
    return '';
  }

  function handleSubmit() {
    setAttempted(true);

    // Scroll to first error
    if (!formData.name.trim()) { nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); nameRef.current?.focus(); return; }
    if (!formData.start_date) { startDateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); startDateRef.current?.focus(); return; }    if (formData.end_date && formData.end_date < formData.start_date) { endDateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); endDateRef.current?.focus(); return; }
    if (!stops[0]?.country?.trim()) { firstCountryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstCountryRef.current?.focus(); return; }
    if (validStops.length === 0) return;
    // El error de noches (suma de noches por parada no cuadra con los días del
    // viaje) solo se mostraba visualmente — no bloqueaba el envío, así que se
    // podía crear un viaje con fechas/paradas inconsistentes.
    if (nightsError) { nightsErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }

    const tripCities = validStops;
    let allocations = [];
    if (mode === 'single') {
      const endDate = computedTripEndDate();
      allocations = [{ start_date: formData.start_date, end_date: endDate }];
    } else if (dateMode === 'nights') {
      allocations = computeNightsDates(formData.start_date, tripCities.map(s => s.nights || 1));
    } else {
      allocations = tripCities.map(s => s.manual);
    }

    const finalEndDate = computedTripEndDate();
    const firstCountry = tripCities[0]?.country || '';
    const firstMeta = getCountryMeta(firstCountry);
    onSubmit({
      formData: {
        ...formData,
        end_date: finalEndDate,
        country: normalizeCountry(firstCountry),
        destination: tripCities.map(s => s.city).join(' → '),
        ...(!currencyTouched ? {
          currency: firstMeta.currency,
          currency_symbol: firstMeta.symbol,
          language: firstMeta.languageLabel,
          language_code: firstMeta.languageCode,
        } : {}),
      },
      stops: tripCities.map(s => s.city),
      // José (14 sep 2026): coordenadas reales de cada parada (si
      // CityInput consiguió resolverlas vía Google Places) -- array
      // paralelo a `stops`, igual que ya hace `stopCountries`. Puede venir
      // con `lat`/`lng` a `undefined` en cualquier posición si esa parada
      // se escribió a mano sin elegir ninguna sugerencia -- eso es
      // exactamente el fallback esperado, no un error.
      stopCoords: tripCities.map(s => ({ lat: s.lat ?? undefined, lng: s.lng ?? undefined, photoRef: s.photoRef ?? undefined })),
      stopCountries: tripCities.map(s => normalizeCountry(s.country || firstCountry)),
      allocations,
      selectedTemplate: null,
    });
  }

  function handleClose() {
    onOpenChange(false);
    setFormData({ ...DEFAULT_FORM });
    setMode('multi');
    setDateMode('nights');
    setStops(defaultStops('multi'));
    setCurrencyTouched(false);
    setAttempted(false);
  }

  const missingName = attempted && !formData.name.trim();
  const missingStart = attempted && !formData.start_date;
  const missingCountry = attempted && !stops[0]?.country?.trim();
  const invalidEndDate = attempted && formData.end_date && formData.end_date < formData.start_date;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground text-2xl">{t('trip.newTrip')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">

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
              className={`w-full h-10 border rounded-xl px-3 text-sm outline-none transition-colors ${
                missingName ? 'border-red-400 bg-red-50 focus:border-red-500' : 'border-border bg-card focus:border-primary'
              }`}
            />
            {missingName && <p className="text-xs text-red-500">{t('trip.new.nameRequired')}</p>}
          </div>

          {/* 2. Modo */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">{t('trip.new.tripType')}</label>
            <div className="flex rounded-xl border border-border overflow-hidden max-w-xs">
              {[['single',t('trip.new.singleDest')],['multi',t('trip.new.multiCity')]].map(([v,l]) => (
                <button key={v} type="button" onClick={() => setMode_(v)}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === v ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:bg-secondary/50'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Fechas */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                {t('trip.dialog.startDate')} <span className="text-primary">*</span>
              </label>
              <input
                ref={startDateRef}
                type="date"
                value={formData.start_date}
                onChange={e => setFormData(p => ({ ...p, start_date: e.target.value }))}
                className={`w-full h-10 border rounded-xl px-3 text-sm outline-none transition-colors ${
                  missingStart ? 'border-red-400 bg-red-50 focus:border-red-500' : 'border-border bg-card focus:border-primary'
                }`}
              />
              {missingStart && <p className="text-xs text-red-500">{t('trip.new.startRequired')}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                {t('trip.dialog.endDate')} <span className="text-muted-foreground font-normal text-xs">{t('trip.new.orByNights')}</span>
              </label>
              <input
                ref={endDateRef}
                type="date"
                value={formData.end_date}
                min={formData.start_date || undefined}
                onChange={e => {
                  // El min del <input> nativo no siempre se respeta en el
                  // WebView de Android (varía por fabricante/versión) — sin
                  // este chequeo en JS se podía seleccionar una fecha fin
                  // anterior al inicio pese al atributo min. Se ignora el
                  // valor si viola la regla, en vez de aceptarlo y confiar
                  // solo en el aviso de "invalidEndDate" al enviar.
                  const v = e.target.value;
                  if (formData.start_date && v && v < formData.start_date) return;
                  setFormData(p => ({ ...p, end_date: v }));
                }}
                className={`w-full h-10 border rounded-xl px-3 text-sm outline-none transition-colors ${invalidEndDate ? 'border-red-400 bg-red-50 focus:border-red-500' : 'border-border bg-card focus:border-primary'}`}
              />
              {invalidEndDate && <p className="text-xs text-red-500">{t('trip.dialog.endBeforeStart')}</p>}
            </div>
          </div>

          {/* 4. Paradas */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">
                {mode === 'multi' ? t('trip.new.destinations') : t('trip.new.destination')} <span className="text-primary">*</span>
              </label>
              <div className="flex items-center gap-2">
                {mode === 'multi' && formData.start_date && (
                  <div className="flex gap-1">
                    {[{v:'nights',l:t('trip.new.nights')},{v:'manual',l:t('trip.new.manual')}].map(({v,l}) => (
                      <button key={v} type="button" onClick={() => setDateMode(v)}
                        className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
                          dateMode === v ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                        }`}>{l}</button>
                    ))}
                  </div>
                )}

              </div>
            </div>

            {mode === 'multi' && formData.start_date && stops.length > 1 && (
              <button type="button" onClick={dateMode === 'nights' ? autoDistributeNights : autoDistributeManual}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors -mt-1">
                <Shuffle className="w-3.5 h-3.5" />{t('trip.new.autoDistribute')}
              </button>
            )}

            <div className="space-y-2">
              {stops.map((stop, idx) => (
                <div key={idx} className={`bg-card border rounded-xl p-3 space-y-2 ${idx === 0 && missingCountry ? 'border-red-300' : 'border-border'}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-40 flex-shrink-0">
                      <CountryField
                        ref={idx === 0 ? firstCountryRef : null}
                        value={stop.country}
                        onChange={v => applyStopCountry(idx, v)}
                        hasError={idx === 0 && missingCountry}
                      />
                    </div>
                    <div className="flex-1">
                      <CityInput
                        key={stop.country}
                        country={stop.country}
                        value={stop.city}
                        onChange={v => updateStop(idx, { city: v, lat: null, lng: null })}
                        onSelectPlace={({ name, lat, lng, photoRef }) => updateStop(idx, { city: name, lat, lng, photoRef })}
                        placeholder={t('trip.new.cityN', { n: idx + 1 })}
                      />
                    </div>
                    {mode === 'multi' && stops.length > 1 && (
                      <button type="button" onClick={() => removeStop(idx)} className="text-muted-foreground hover:text-destructive flex-shrink-0 p-1">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {formData.start_date && (
                    <>
                      {mode === 'single' ? (
                        computedTripEndDate() ? (
                          <p className="text-xs text-primary font-medium pl-1">{formData.start_date} → {computedTripEndDate()}</p>
                        ) : null
                      ) : dateMode === 'nights' ? (
                        <div className="flex items-center gap-2 pl-1">
                          <input type="number" min="1" aria-label={t('trip.new.nightsAria')} placeholder={t('trip.new.nightsPh')}
                            value={stop.nights}
                            onChange={e => updateStop(idx, { nights: e.target.value })}
                            className="w-20 h-8 border border-border rounded-lg px-2 text-sm outline-none focus:border-primary bg-secondary"
                          />
                          <span className="text-xs text-muted-foreground">{t('trip.new.nightsPh')}</span>
                          {stop.nights && nightsAllocations[idx] && (
                            <span className="text-xs text-primary font-medium">
                              {nightsAllocations[idx].start_date} → {nightsAllocations[idx].end_date}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 pl-1 flex-wrap">
                          {/* El min del start_date de una parada N>0 solo miraba
                              formData.start_date (el inicio del viaje entero),
                              no el end_date de la parada N-1 — así que nada
                              impedía elegir un start_date muy anterior al fin
                              de la parada previa, solapando varios días entre
                              dos paradas consecutivas. Igual que en
                              SettingsDialog.jsx, se acota al end_date de la
                              parada anterior (o al inicio del viaje si es la
                              primera). */}
                          <input type="date" value={stop.manual.start_date}
                            min={(idx > 0 ? stops[idx - 1]?.manual?.end_date : null) || formData.start_date || undefined}
                            max={formData.end_date || undefined}
                            onChange={e => {
                              // Mismo refuerzo en JS que en los campos de
                              // fecha del propio viaje (min/max nativo del
                              // input no siempre se respeta en el WebView
                              // de Android) — se ignora si viola el rango.
                              const v = e.target.value;
                              const lo = (idx > 0 ? stops[idx - 1]?.manual?.end_date : null) || formData.start_date;
                              const hi = formData.end_date;
                              if (lo && v && v < lo) return;
                              if (hi && v && v > hi) return;
                              updateStopManual(idx, { start_date: v });
                            }}
                            className="w-36 h-8 border border-border rounded-lg px-2 text-xs outline-none focus:border-primary bg-secondary"
                          />
                          <span className="text-xs text-muted-foreground">→</span>
                          <input type="date" value={stop.manual.end_date}
                            min={stop.manual.start_date || formData.start_date || undefined} max={formData.end_date || undefined}
                            onChange={e => {
                              const v = e.target.value;
                              const lo = stop.manual.start_date || formData.start_date;
                              const hi = formData.end_date;
                              if (lo && v && v < lo) return;
                              if (hi && v && v > hi) return;
                              updateStopManual(idx, { end_date: v });
                            }}
                            className="w-36 h-8 border border-border rounded-lg px-2 text-xs outline-none focus:border-primary bg-secondary"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            {mode === 'multi' && (
              <button type="button" onClick={addStop}
                className="w-full flex items-center justify-center gap-1.5 text-sm text-primary font-medium border border-dashed border-primary/40 rounded-xl py-2.5 hover:bg-orange-50 transition-colors">
                <Plus className="w-4 h-4" />{t('trip.dialog.addStop')}
              </button>
            )}

            {missingCountry && <p className="text-xs text-red-500">{t('trip.new.firstStopCountry')}</p>}

            {mode === 'multi' && dateMode === 'nights' && formData.start_date && (
              <div className="pl-1 space-y-1" ref={nightsErrorRef}>
                {nightsError ? (
                  <p className="text-xs text-destructive font-medium flex items-center gap-1"><AlertTriangle size={12} />{nightsError}</p>
                ) : totalNightsEntered > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('trip.new.totalLabel')}: <span className="font-medium text-foreground">{t('trip.new.nightsCount', { count: totalNightsEntered })}</span>
                    {' '}· {t('trip.new.endLabel')}: <span className="font-medium text-primary">{addDays(formData.start_date, totalNightsEntered - 1)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

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
