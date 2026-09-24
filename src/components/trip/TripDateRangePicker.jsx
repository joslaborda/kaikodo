import { useState, forwardRef } from 'react';
import { DayPicker } from 'react-day-picker';
import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// José (24 sep 2026): selección de fechas "smooth". Antes eran dos
// <input type="date"> nativos: en iOS había que elegir la salida, pulsar OK,
// abrir el segundo selector... y el segundo dejaba tocar días anteriores a la
// salida (el `min` nativo no se respeta siempre; el valor se ignoraba en
// silencio). Ahora es un solo calendario: toque 1 = salida, toque 2 = vuelta,
// sin OK, con los días fuera de rango desactivados de verdad.
//
// Valores siempre en 'yyyy-MM-dd' (lo que ya guardaba el formulario).
//  - start / end:       fechas actuales ('' si no hay)
//  - onChange({start, end})
//  - minDate / maxDate: límites opcionales ('yyyy-MM-dd')
//  - endOptional:       la vuelta se puede dejar vacía (viaje por noches)
//  - compact:           versión pequeña (fechas por parada)
//  - hasError:          resalta la salida en rojo (validación del formulario)

const toDate = (s) => {
  if (!s) return undefined;
  const d = parseISO(s);
  return isValid(d) ? d : undefined;
};
const toStr = (d) => format(d, 'yyyy-MM-dd');

const TripDateRangePicker = forwardRef(function TripDateRangePicker(
  { start, end, onChange, minDate, maxDate, endOptional = false, compact = false, hasError = false, startLabel, endLabel },
  ref
) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? undefined : es;
  const startD = toDate(start);
  const endD = toDate(end);
  const minD = toDate(minDate);
  const maxD = toDate(maxDate);

  // 'start' | 'end' | null (cerrado). Sin salida, el calendario empieza abierto
  // solo en la versión grande (la de fechas del viaje).
  const [picking, setPicking] = useState(!compact && !start ? 'start' : null);
  const [month, setMonth] = useState(startD || minD || new Date());

  const fmt = (d) => (d ? format(d, compact ? 'd MMM' : 'd MMM yyyy', { locale }) : null);

  const openFor = (which) => {
    if (which === 'end' && !startD) which = 'start';
    setPicking(p => (p === which ? null : which));
    const focus = which === 'end' ? (endD || startD) : (startD || minD);
    if (focus) setMonth(focus);
  };

  const handleDayClick = (day, modifiers) => {
    if (modifiers?.disabled) return;
    const s = toStr(day);
    if (picking === 'end' && startD) {
      if (differenceInCalendarDays(day, startD) < 0) {
        // Por si acaso (los días previos ya están desactivados): nueva salida.
        onChange({ start: s, end: '' });
        setPicking('end');
        return;
      }
      onChange({ start, end: s });
      setPicking(null);
      return;
    }
    // Elegir salida: si la vuelta queda antes, se borra y se pasa a elegirla.
    const keepEnd = endD && differenceInCalendarDays(endD, day) >= 0 ? end : '';
    onChange({ start: s, end: keepEnd });
    setPicking('end');
  };

  const disabled = [];
  if (minD) disabled.push({ before: minD });
  if (maxD) disabled.push({ after: maxD });
  if (picking === 'end' && startD) disabled.push({ before: startD });

  const days = startD && endD ? differenceInCalendarDays(endD, startD) + 1 : null;

  const boxBase = `flex-1 min-w-0 text-left border rounded-xl transition-colors ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} bg-card`;
  const boxCls = (which, err) => `${boxBase} ${
    picking === which ? 'border-primary ring-1 ring-primary' : err ? 'border-red-400 bg-red-50' : 'border-border'
  }`;

  return (
    <div>
      <div className="flex items-stretch gap-2">
        <button ref={ref} type="button" onClick={() => openFor('start')} className={boxCls('start', hasError)}>
          <span className="block text-[11px] text-muted-foreground leading-tight">{startLabel || t('trip.dates.departure')}</span>
          <span className={`block truncate ${compact ? 'text-xs' : 'text-sm'} font-semibold ${startD ? 'text-foreground' : 'text-muted-foreground font-normal'}`}>
            {fmt(startD) || t('trip.dates.choose')}
          </span>
        </button>
        <div className={`${boxCls('end', false)} relative`}>
          <button type="button" onClick={() => openFor('end')} className="block w-full text-left pr-5">
            <span className="block text-[11px] text-muted-foreground leading-tight">{endLabel || t('trip.dates.return')}</span>
            <span className={`block truncate ${compact ? 'text-xs' : 'text-sm'} font-semibold ${endD ? 'text-foreground' : 'text-muted-foreground font-normal'}`}>
              {fmt(endD) || (endOptional ? t('trip.dates.byNights') : t('trip.dates.choose'))}
            </span>
          </button>
          {endD && endOptional && (
            <button type="button" aria-label={t('trip.dates.clearReturn')}
              onClick={() => { onChange({ start, end: '' }); setPicking(null); }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {picking && (
        <div className="mt-2 bg-card border border-border rounded-2xl p-2">
          <p className="text-xs text-muted-foreground text-center pt-1">
            {picking === 'start' ? t('trip.dates.pickDeparture') : t('trip.dates.pickReturn')}
          </p>
          <DayPicker
            mode="range"
            selected={{ from: startD, to: endD }}
            onDayClick={handleDayClick}
            month={month}
            onMonthChange={setMonth}
            disabled={disabled}
            locale={locale}
            weekStartsOn={1}
            showOutsideDays={false}
            className="p-1 w-full"
            classNames={{
              months: 'w-full',
              month: 'w-full space-y-2',
              caption: 'flex justify-center pt-1 relative items-center h-9',
              caption_label: 'text-sm font-semibold capitalize',
              nav: 'flex items-center',
              nav_button: 'h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary',
              nav_button_previous: 'absolute left-0',
              nav_button_next: 'absolute right-0',
              table: 'w-full border-collapse',
              head_row: 'flex w-full',
              head_cell: 'flex-1 text-muted-foreground font-normal text-[11px] uppercase',
              row: 'flex w-full mt-1',
              cell: 'flex-1 p-0 text-center relative',
              day: 'w-full h-10 text-sm rounded-full text-foreground hover:bg-secondary transition-colors',
              day_selected: 'bg-orange-100 dark:bg-orange-950/40 text-foreground rounded-none hover:bg-orange-100',
              day_range_start: '!bg-primary !text-white font-bold !rounded-full',
              day_range_end: '!bg-primary !text-white font-bold !rounded-full',
              day_range_middle: 'bg-orange-100 dark:bg-orange-950/40 !rounded-none',
              day_today: 'font-bold text-primary',
              day_disabled: '!text-muted-foreground/35 !bg-transparent pointer-events-none line-through decoration-transparent',
              day_hidden: 'invisible',
            }}
            components={{
              IconLeft: () => <ChevronLeft className="h-4 w-4" />,
              IconRight: () => <ChevronRight className="h-4 w-4" />,
            }}
          />
          {picking === 'end' && endOptional && (
            <button type="button" onClick={() => { onChange({ start, end: '' }); setPicking(null); }}
              className="w-full text-xs text-primary font-medium py-2">
              {t('trip.dates.noReturn')}
            </button>
          )}
        </div>
      )}

      {!compact && days && (
        <p className="text-xs text-muted-foreground mt-1.5 pl-1">
          {t('trip.dates.days', { count: days })}
        </p>
      )}
    </div>
  );
});

export default TripDateRangePicker;
