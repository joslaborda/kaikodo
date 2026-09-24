import { useEffect, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tripDayOptionValue } from '@/lib/tripDays';
import { FormSection, DatePill, TimePill } from '@/components/form/FormPills';

// José (24 sep 2026): asignar día y hora a un spot, igual en los tres sitios
// donde se hace (ficha del spot en Spots, ficha dentro de Ruta y el panel de
// asignar de Spots). Tira de días deslizable (día de la semana, número y
// ciudad) en vez del desplegable; tocar el día marcado lo desmarca (sin día).
// La hora es opcional: pastilla con la rueda nativa del móvil.
//
// El día se elige como fecha + ciudad (tripDayOptionValue): en un día de
// tránsito hay dos ciudades con la misma fecha y hay que saber cuál es.
export default function DayTimeAssign({ tripDayOptions = [], date, cityId, time, onDayChange, onTimeChange, minDate, maxDate }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? undefined : es;
  const stripRef = useRef(null);
  const selectedValue = date ? tripDayOptionValue({ date, cityId }) : '';
  const hasDays = tripDayOptions.length > 0;

  // Al abrir, que el día marcado quede a la vista dentro de la tira.
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector('[data-selected="true"]');
    if (strip && el) strip.scrollLeft = Math.max(0, el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2);
    // Solo al montar.
  }, []);

  const fmt = (iso, pattern) => { try { return format(parseISO(iso), pattern, { locale }); } catch { return iso; } };

  // Día de tránsito: la misma fecha dos veces (dos ciudades). Si la opción
  // marcada no trae ciudad (dato antiguo), vale la primera con esa fecha.
  const isSelected = (d) => selectedValue === tripDayOptionValue(d)
    || (!cityId && date === d.date && tripDayOptions.find(o => o.date === date) === d);

  return (
    <div className="space-y-4">
      <FormSection title={t('spots.assign.whichDay')}>
        {hasDays ? (
          <div ref={stripRef} className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none snap-x">
            {tripDayOptions.map(d => {
              const on = isSelected(d);
              return (
                <button key={tripDayOptionValue(d)} type="button" data-selected={on}
                  onClick={() => (on ? onDayChange({ date: '', cityId: '' }) : onDayChange({ date: d.date, cityId: d.cityId || '' }))}
                  aria-pressed={on}
                  className={`snap-start flex-shrink-0 w-[60px] rounded-2xl border py-2 text-center transition-colors ${
                    on ? 'bg-primary border-primary text-white' : 'bg-card border-border text-foreground'}`}>
                  <span className={`block text-[10px] uppercase ${on ? 'text-white/80' : 'text-muted-foreground'}`}>{fmt(d.date, 'EEE')}</span>
                  <span className="block text-lg font-bold leading-tight">{fmt(d.date, 'd')}</span>
                  <span className={`block text-[10px] truncate px-1 ${on ? 'text-white/80' : 'text-muted-foreground'}`}>{d.city}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <DatePill value={date} onChange={v => onDayChange({ date: v, cityId: '' })} minDate={minDate} maxDate={maxDate} clearable />
        )}
      </FormSection>

      <FormSection title={<>{t('spots.assign.time')} <span className="font-normal text-muted-foreground text-xs">{t('spots.assign.optional')}</span></>}>
        <TimePill value={time || ''} onChange={onTimeChange} placeholder={t('spots.assign.pickTime')} />
      </FormSection>

      {date && (
        <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2 text-xs text-muted-foreground">
          <Route className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span>{time
            ? t('spots.assign.summaryTime', { day: fmt(date, 'EEEE d'), time })
            : t('spots.assign.summary', { day: fmt(date, 'EEEE d') })}</span>
        </div>
      )}
    </div>
  );
}
