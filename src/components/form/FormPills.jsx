import { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import { format, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar, Clock, ChevronDown, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Avatar from '@/components/trip/Avatar';

// José (24 sep 2026): piezas comunes de los formularios rediseñados
// (documentos primero; gastos, spots y Ruta después). Sustituyen a los
// selectores nativos del móvil (<input type="date">, <select>) y a las
// etiquetas en MAYÚSCULAS por pastillas y chips con el mismo aspecto que el
// formulario de viaje nuevo. Si mañana cambia el estilo, se cambia aquí.

const toDate = (s) => { if (!s) return undefined; const d = parseISO(s); return isValid(d) ? d : undefined; };

export const pillCls = (active, placeholder) =>
  `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors max-w-full ${
    placeholder
      ? 'bg-secondary text-muted-foreground border border-dashed border-muted-foreground/40'
      : 'bg-orange-50 dark:bg-orange-950/30 text-primary border border-orange-200 dark:border-orange-900/50'
  } ${active ? 'ring-1 ring-primary' : ''}`;

export function FormSection({ title, hint, children, className = '' }) {
  return (
    <div className={className}>
      {title && <p className="text-sm font-bold text-foreground mb-2">{title}</p>}
      {hint && <p className="text-xs text-muted-foreground -mt-1 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

// Tarjeta con filas (icono + contenido), como "Detalles" del mockup.
export function FormCard({ children }) {
  return <div className="bg-card border border-border rounded-2xl px-3 divide-y divide-border/70">{children}</div>;
}
export function FormRow({ icon: Icon, children, align = 'center' }) {
  return (
    <div className={`flex ${align === 'start' ? 'items-start' : 'items-center'} gap-3 py-2.5 min-h-[44px]`}>
      {Icon && <Icon className={`w-4 h-4 text-muted-foreground flex-shrink-0 ${align === 'start' ? 'mt-1' : ''}`} />}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// Panel desplegable bajo una pastilla (no es un popover flotante: empuja el
// contenido, así no se corta dentro de modales con scroll).
function Panel({ children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return <div ref={ref} className="mt-2 bg-card border border-border rounded-2xl p-2 shadow-sm">{children}</div>;
}

const dayPickerClassNames = {
  months: 'w-full', month: 'w-full space-y-2',
  caption: 'flex justify-center pt-1 relative items-center h-9',
  caption_label: 'text-sm font-semibold capitalize',
  nav: 'flex items-center',
  nav_button: 'h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary',
  nav_button_previous: 'absolute left-0', nav_button_next: 'absolute right-0',
  table: 'w-full border-collapse', head_row: 'flex w-full',
  head_cell: 'flex-1 text-muted-foreground font-normal text-[11px] uppercase',
  row: 'flex w-full mt-1', cell: 'flex-1 p-0 text-center relative',
  day: 'w-full h-10 text-sm rounded-full text-foreground hover:bg-secondary transition-colors',
  day_selected: '!bg-primary !text-white font-bold',
  day_today: 'font-bold text-primary',
  day_disabled: '!text-muted-foreground/35 !bg-transparent pointer-events-none',
  day_hidden: 'invisible',
};

// Fecha suelta. value/onChange en 'yyyy-MM-dd'.
export function DatePill({ value, onChange, minDate, maxDate, placeholder, clearable = false }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? undefined : es;
  const [open, setOpen] = useState(false);
  const d = toDate(value), minD = toDate(minDate), maxD = toDate(maxDate);
  const [month, setMonth] = useState(d || minD || new Date());
  const disabled = [];
  if (minD) disabled.push({ before: minD });
  if (maxD) disabled.push({ after: maxD });
  return (
    <div className="inline-block max-w-full">
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={() => { setOpen(o => !o); setMonth(d || minD || new Date()); }} className={pillCls(open, !d)}>
          <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{d ? format(d, 'EEE d MMM', { locale }) : (placeholder || t('forms.pickDate'))}</span>
        </button>
        {clearable && d && (
          <button type="button" aria-label={t('forms.clear')} onClick={() => onChange('')}
            className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="w-3.5 h-3.5" /></button>
        )}
      </span>
      {open && (
        <Panel onClose={() => setOpen(false)}>
          <DayPicker mode="single" selected={d} month={month} onMonthChange={setMonth}
            onDayClick={(day, mods) => { if (mods?.disabled) return; onChange(format(day, 'yyyy-MM-dd')); setOpen(false); }}
            disabled={disabled} locale={locale} weekStartsOn={1} showOutsideDays={false}
            className="p-1 w-full" classNames={dayPickerClassNames}
            components={{ IconLeft: () => <ChevronLeft className="h-4 w-4" />, IconRight: () => <ChevronRight className="h-4 w-4" /> }} />
        </Panel>
      )}
    </div>
  );
}

// Hora: pastilla con el selector nativo de hora encima (invisible). La rueda
// de hora nativa es la mejor forma de elegir una hora en el móvil; lo que
// era feo era la caja, no la rueda.
export function TimePill({ value, onChange, placeholder, clearable = true }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`${pillCls(false, !value)} relative`}>
        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
        <span>{value || placeholder || t('forms.pickTime')}</span>
        <input type="time" value={value || ''} onChange={e => onChange(e.target.value)}
          aria-label={placeholder || t('forms.pickTime')}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </span>
      {clearable && value && (
        <button type="button" aria-label={t('forms.clear')} onClick={() => onChange('')}
          className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="w-3.5 h-3.5" /></button>
      )}
    </span>
  );
}

// Sustituto de <select>: pastilla + lista de opciones debajo.
// options: [{ value, label, sublabel? }]
export function OptionPill({ value, onChange, options = [], placeholder, icon: Icon = ChevronDown, allowEmpty = false, emptyLabel }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => o.value === value);
  return (
    <div className="max-w-full">
      <button type="button" onClick={() => setOpen(o => !o)} className={pillCls(open, !sel)}>
        {Icon !== ChevronDown && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
        <span className="truncate">{sel ? sel.label : placeholder}</span>
        <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
      </button>
      {open && (
        <Panel onClose={() => setOpen(false)}>
          <div className="max-h-64 overflow-y-auto">
            {allowEmpty && (
              <button type="button" onClick={() => { onChange(''); setOpen(false); }}
                className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-secondary/40">{emptyLabel || placeholder}</button>
            )}
            {options.map(o => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${o.value === value ? 'bg-orange-50 dark:bg-orange-950/30 text-primary font-semibold' : 'text-foreground hover:bg-secondary/40'}`}>
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.sublabel && <span className="block text-xs text-muted-foreground truncate">{o.sublabel}</span>}
                </span>
                {o.value === value && <Check className="w-4 h-4 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

// Chip de persona / opción (el de "¿Para quién es?").
export function Chip({ on, locked = false, onClick, avatar, children, title }) {
  return (
    <button type="button" onClick={locked ? undefined : onClick} aria-pressed={on} title={title}
      className={`inline-flex items-center gap-2 ${avatar ? 'pl-1.5' : 'pl-3'} pr-3 py-1.5 rounded-full border text-sm transition-colors ${
        on ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/50 text-primary font-medium'
           : 'bg-card border-border text-foreground hover:bg-secondary/30'
      } ${locked ? 'cursor-default opacity-80' : ''}`}>
      {avatar}
      <span className="truncate max-w-[9rem]">{children}</span>
      {on && <Check className="w-3.5 h-3.5 shrink-0" />}
    </button>
  );
}

export function PersonAvatar({ email, profile }) {
  return <Avatar email={email} profile={profile} size={24} />;
}
