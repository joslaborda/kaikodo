import { BusFront } from '@/lib/icons';
import { useState, useRef, useEffect } from 'react';
import { Loader2, Camera, Upload, X, Utensils, Hotel, Ticket, ShoppingBag, CirclePlus, Wine } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { convertAmount } from '@/lib/fxRates';
import { checkUpload, convertHeicIfNeeded } from '@/lib/uploadLimits';
import { toast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { normalizeEmail, normalizeAmountInput, isZeroDecimalCurrency } from '@/lib/utils';

// labelKey en vez de label fijo: CATEGORIES es un const de módulo (fuera del
// componente), así que no tiene acceso a t() — se traduce en el punto de uso.
// "drinks" ya tenía icono/color/traducción listos en Expenses.jsx (CAT_ICONS,
// CAT_COLORS, CAT_CONFIG, usados para pintar gastos ya guardados con esa
// categoría) pero nunca apareció aquí, en el selector real donde se elige la
// categoría al crear/editar un gasto — así que nadie podía crear uno nuevo
// como "Bebidas" desde la UI.
const CATEGORIES = [
  { value: 'food',          labelKey: 'expenses.categories.food',          Icon: Utensils    },
  { value: 'transport',     labelKey: 'expenses.categories.transport',     Icon: BusFront         },
  { value: 'accommodation', labelKey: 'expenses.categories.accommodation', Icon: Hotel       },
  { value: 'activities',    labelKey: 'expenses.categories.activities',    Icon: Ticket      },
  { value: 'shopping',      labelKey: 'expenses.categories.shopping',      Icon: ShoppingBag },
  { value: 'drinks',        labelKey: 'expenses.categories.drinks',        Icon: Wine        },
  { value: 'other',         labelKey: 'expenses.categories.other',         Icon: CirclePlus  },
];

const COMMON_CURRENCIES = [
  'EUR','GBP','JPY','CNY','CHF','MXN','ARS','BRL','THB','KRW','VND','MAD',
  'TRY','SGD','IDR','CAD','AUD','INR','MYR','PHP','ZAR','CLP','PEN','AED','SAR',
  'NOK','SEK','DKK','PLN','CZK','HUF','NZD','KES','RUB','EGP','CRC','COP',
];

export default function ExpenseForm({
  members = [],
  initialData = null,
  defaultCurrency = 'EUR',
  baseCurrency = 'EUR',
  availableCurrencies = [],
  onSave,
  onCancel,
  saving = false,
  userMap = {},
  currentUserEmail = '',
  profiles = {},
  profilesByEmail,
  cities = [],
  defaultCityId = '',
  minDate = '',
  maxDate = '',
  onValidityChange,
}) {
  const { t } = useTranslation();
  // userMap está indexado por email normalizado (minúsculas) — nunca se
  // muestra el email en crudo, aunque no se encuentre el perfil.
  const getName = email => userMap[normalizeEmail(email)] || t('common.member');
  const isCurrentUser = email => normalizeEmail(email) === normalizeEmail(currentUserEmail || members[0]);
  const profileMap = profilesByEmail || profiles || {};

  const orderedCurrencies = [...new Set([defaultCurrency, baseCurrency, ...availableCurrencies, ...COMMON_CURRENCIES])];

  const [form, setForm] = useState(initialData || {
    description: '',
    amount: '',
    currency: defaultCurrency,
    category: 'food',
    date: format(new Date(), 'yyyy-MM-dd'),
    paid_by: members[0] || '',
    split_type: 'equal',
    split_with: [...members],
    amounts_by_user: {},
    // Sin esto, "Por ciudad" en Estadísticas se quedaba vacío para siempre —
    // el gasto nunca guardaba de qué ciudad era. Se preselecciona la ciudad
    // activa del viaje, pero el usuario puede cambiarla o dejarla sin ciudad.
    city_id: defaultCityId || '',
    city_name: (cities.find(c => c.id === defaultCityId)?.name) || '',
  });

  const [receipts, setReceipts] = useState(initialData?.receipt_photos || []);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [converting, setConverting] = useState(false);
  const [fxInfo, setFxInfo] = useState(null);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const currency = form.currency || defaultCurrency;
  const isSameCurrency = currency === baseCurrency;

  // Auto-convert on amount/currency change
  useEffect(() => {
    if (!form.amount || parseFloat(form.amount) <= 0 || isSameCurrency) { setFxInfo(null); return; }
    const t = setTimeout(async () => {
      setConverting(true);
      try {
        const r = await convertAmount(parseFloat(form.amount), currency, baseCurrency, form.date || null);
        setFxInfo(r);
      } catch { setFxInfo(null); }
      finally { setConverting(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [form.amount, currency, baseCurrency, form.date, isSameCurrency]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const toggleMember = email => {
    setForm(p => ({
      ...p,
      split_with: p.split_with.includes(email)
        ? p.split_with.filter(e => e !== email)
        : [...p.split_with, email],
    }));
  };

  const selectAll = () => set('split_with', [...members]);
  const selectNone = () => set('split_with', []);

  const equalShare = () => {
    if (!form.amount || form.split_with.length === 0) return null;
    const isZeroDecimal = isZeroDecimalCurrency(currency);
    const share = parseFloat(form.amount) / form.split_with.length;
    return isZeroDecimal ? Math.round(share).toLocaleString('es') : share.toFixed(2);
  };

  const handleReceiptUpload = async file => {
    if (!file) return;
    const chk = checkUpload(file);
    if (!chk.ok) {
      toast({
        title: chk.reason === 'size' ? t('upload.tooLarge') : t('upload.notImage'),
        description: chk.reason === 'size' ? t('upload.maxMb', { mb: chk.maxMb }) : undefined,
        variant: 'destructive',
      });
      return;
    }
    setUploadingReceipt(true);
    try {
      const uploadFile = await convertHeicIfNeeded(file);
      const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadFile });
      setReceipts(p => [...p, file_url]);
    } catch (e) {
      // Antes era try/finally sin catch: si fallaba, el error se perdía y el
      // usuario no sabía que su recibo no se había subido.
      toast({ title: t('upload.failed'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    } finally { setUploadingReceipt(false); }
  };

  const customTotal = Object.values(form.amounts_by_user || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const customCuadra = Math.abs(parseFloat(form.amount || 0) - customTotal) < 0.01;
  // Defensa adicional al guard del input: si algún importe individual del
  // reparto personalizado es negativo, la suma total puede seguir "cuadrando"
  // (p.ej. 150 + (-50) + 0 = 100) pero invierte a quién se le debita/acredita
  // cada parte — sin este check se podía guardar un gasto que dejaba a un
  // miembro debiendo más que el importe entero del gasto.
  const customHasNegative = Object.values(form.amounts_by_user || {}).some(v => parseFloat(v) < 0);

  const canSave = form.description.trim() && form.amount && parseFloat(form.amount) > 0 && !saving && (
    form.split_type === 'solo' ||
    (form.split_type === 'equal' && form.split_with.length > 0) ||
    // En custom hay que asignar el importe completo: si no cuadra, el reparto se
    // haría por ratios y las cantidades escritas se escalarían sin avisar.
    (form.split_type === 'custom' && customTotal > 0 && customCuadra && !customHasNegative)
  );

  // Notifica al contenedor (ExpenseSheet) si el formulario es válido en
  // tiempo real, para que el botón "Guardar" se deshabilite antes de pulsarlo
  // — no solo al pulsarlo (handleSave vuelve a validar, pero así hay feedback
  // visual inmediato).
  useEffect(() => { if (onValidityChange) onValidityChange(canSave); }, [canSave]);

  const handleSave = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast({ title: t('expenses.form.amountRequired'), description: t('expenses.form.amountRequiredDesc'), variant: 'destructive' });
      return;
    }
    if (form.split_type === 'custom' && customHasNegative) {
      toast({ title: t('expenses.form.amountRequired'), description: t('expenses.form.negativeSplitDesc'), variant: 'destructive' });
      return;
    }
    if (form.split_type === 'equal' && form.split_with.length === 0) {
      toast({ title: t('expenses.form.pickSomeone'), variant: 'destructive' });
      return;
    }
    if (form.split_type === 'custom' && (customTotal <= 0 || !customCuadra)) {
      const diff = parseFloat(form.amount || 0) - customTotal;
      toast({ title: t('expenses.form.amountRequired'), description: diff > 0 ? t('expenses.form.missingToAssign', { amount: Math.abs(diff).toFixed(2), currency }) : t('expenses.form.overAssigned', { amount: Math.abs(diff).toFixed(2), currency }), variant: 'destructive' });
      return;
    }
    if (!form.description.trim()) {
      toast({ title: t('expenses.form.descRequired'), description: t('expenses.form.descRequiredDesc'), variant: 'destructive' });
      return;
    }
    if (!form.paid_by) {
      toast({ title: t('expenses.form.payerRequired'), description: t('expenses.form.payerRequiredDesc'), variant: 'destructive' });
      return;
    }
    let amountBase = parseFloat(form.amount);
    let fxRate = 1, fxSource = 'same', fxTimestamp = new Date().toISOString();
    if (!isSameCurrency) {
      if (fxInfo) {
        amountBase = fxInfo.amountConverted; fxRate = fxInfo.rate; fxSource = fxInfo.source; fxTimestamp = fxInfo.fetchedAt;
        // fxInfo lo precalcula el useEffect de arriba — si las 3 fuentes de
        // cambio fallaron, viene con rate:1/source:'unavailable' con la misma
        // forma que una conversión real. Sin este aviso, un gasto de 500 USD
        // se guardaba como 500 en la moneda base (p. ej. JPY, ~75.000) sin que
        // nadie se enterara; la rama manual de abajo sí lo avisaba.
        if (fxInfo.source === 'unavailable') {
          toast({ title: t('expenses.fx.unavailableTitle'), description: t('expenses.fx.unavailableDesc', { from: currency, to: baseCurrency }), variant: 'destructive' });
        } else if (fxInfo.approximate) {
          // Se pidió el tipo de cambio de una fecha concreta pero la fuente
          // histórica falló y se usó el tipo de HOY como aproximación — sin
          // este aviso, el usuario no tenía forma de saberlo.
          toast({ title: t('expenses.fx.approximateTitle'), description: t('expenses.fx.approximateDesc') });
        }
      } else {
        try {
          const r = await convertAmount(parseFloat(form.amount), currency, baseCurrency, form.date || null);
          amountBase = r.amountConverted; fxRate = r.rate; fxSource = r.source; fxTimestamp = r.fetchedAt;
          if (r.source === 'unavailable') {
            toast({ title: t('expenses.fx.unavailableTitle'), description: t('expenses.fx.unavailableDesc', { from: currency, to: baseCurrency }), variant: 'destructive' });
          } else if (r.approximate) {
            toast({ title: t('expenses.fx.approximateTitle'), description: t('expenses.fx.approximateDesc') });
          }
        } catch {
          toast({ title: t('expenses.fx.unavailableTitle'), description: t('expenses.fx.unavailableRetry', { from: currency, to: baseCurrency }), variant: 'destructive' });
        }
      }
    }
    // split_with para "solo" se fijaba solo en el momento de pulsar ese modo
    // (el botón hace set('split_with', [form.paid_by || members[0]])) — si
    // después se cambiaba quién pagó sin volver a tocar el modo, split_with
    // quedaba apuntando a la persona anterior. No afecta el balance (solo
    // debita al pagador, calculateBalances ignora split_with en este modo),
    // pero sí la visualización: el detalle del gasto mostraba el avatar
    // equivocado en "Compartido con". Se fuerza aquí, al guardar, en vez de
    // confiar en el estado acumulado.
    const splitWith = form.split_type === 'custom'
      ? Object.entries(form.amounts_by_user||{}).filter(([,v]) => parseFloat(v) > 0).map(([e]) => e)
      : form.split_type === 'solo'
      ? [form.paid_by]
      : form.split_with;
    onSave({ ...form, split_with: splitWith, currency, amount_base: amountBase, fx_rate_to_base: fxRate, fx_source: fxSource, fx_timestamp: fxTimestamp, receipt_photos: receipts });
  };

  return (
    <div className="space-y-5">

      {/* Importe + conversión — cantidad domina, moneda secundaria */}
      <div className="bg-secondary rounded-2xl py-6 px-4 text-center">
        {/* Cantidad — grande y centrada */}
        <input
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={form.amount}
          onChange={e => {
            // normalizeAmountInput detecta si la coma o el punto es el
            // separador decimal real en vez de asumir siempre que la coma lo
            // es — "1.234,56" ya no se guarda como 1.234 (ver utils.js).
            const val = normalizeAmountInput(e.target.value);
            set('amount', val);
          }}
          autoFocus
          className="text-5xl font-bold text-center bg-transparent outline-none text-foreground placeholder:text-border w-full mb-1"
          style={{ letterSpacing: '-1px' }}
        />
        <div className="w-16 h-0.5 bg-primary rounded-full mx-auto mb-4" />

        {/* Moneda — píldora pequeña como selector secundario */}
        <div className="flex items-center justify-center gap-3">
          <div className="relative inline-flex items-center">
            <select
              value={currency}
              onChange={e => set('currency', e.target.value)}
              className="appearance-none bg-card border border-border rounded-full pl-3 pr-7 py-1.5 text-xs font-semibold text-muted-foreground outline-none focus:border-primary cursor-pointer"
            >
              {orderedCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <svg className="absolute right-2 pointer-events-none" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>

          {/* FX inline */}
          {!isSameCurrency && form.amount && parseFloat(form.amount) > 0 && (
            <span className="text-xs text-muted-foreground">
              {converting
                ? '...'
                : fxInfo
                  ? `≈ ${fxInfo.amountConverted.toLocaleString('es')} ${baseCurrency}`
                  : ''}
            </span>
          )}
        </div>
      </div>

      {/* Descripción + recibos */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          {/* Fix: sin min-w-0 un input dentro de una fila flex no encoge por
              debajo de su ancho de contenido — en pantallas estrechas esto
              empujaba/superponía los botones de subir foto y cámara sobre el
              propio input en vez de dejarles su hueco (min-w-0 es la forma
              estándar en flexbox de permitir que un flex-1 sí encoja). */}
          <input
            placeholder={t('expenses.form.descPlaceholder')}
            value={form.description}
            onChange={e => set('description', e.target.value)}
            className="flex-1 min-w-0 text-sm text-foreground placeholder-muted-foreground bg-transparent outline-none"
          />
          <div className="flex gap-1.5 flex-shrink-0">
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingReceipt}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-orange-50 transition-colors disabled:opacity-40">
              <Upload className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={uploadingReceipt}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-orange-50 transition-colors disabled:opacity-40">
              <Camera className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
        {receipts.length > 0 && (
          <div className="flex gap-2 px-4 py-3 flex-wrap">
            {receipts.map((url, i) => (
              <div key={i} className="relative">
                <img src={url} alt="Recibo" className="w-14 h-14 rounded-lg object-cover border border-border" />
                <button onClick={() => setReceipts(p => p.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {uploadingReceipt && (
              <div className="w-14 h-14 rounded-lg bg-secondary flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleReceiptUpload(e.target.files[0])} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files?.[0] && handleReceiptUpload(e.target.files[0])} />

      {/* Fecha + Ciudad */}
      <div className={cities.length > 0 ? 'grid grid-cols-2 gap-3' : ''}>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('common.date')}</p>
          {/* Sin min/max, la fecha del gasto no tenía ninguna relación con las
              fechas del viaje — a diferencia de DocumentForm.jsx (vuelos,
              hoteles...), que sí acota el selector nativo al rango del viaje.
              Igual que allí, es solo una guía en el <input type="date">, no un
              bloqueo duro: un gasto justo antes/después del viaje sigue siendo
              válido (p. ej. algo comprado con antelación). */}
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
            min={minDate || undefined} max={maxDate || undefined}
            className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-card text-foreground" />
        </div>
        {cities.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('expenses.form.city')}</p>
            <select
              value={form.city_id || ''}
              onChange={e => {
                const cityId = e.target.value;
                const cityName = cities.find(c => c.id === cityId)?.name || '';
                setForm(p => ({ ...p, city_id: cityId, city_name: cityName }));
              }}
              className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-card text-foreground"
            >
              <option value="">{t('expenses.form.noCityOption')}</option>
              {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Categoría */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('common.type')}</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(c => (
            <button key={c.value} type="button" onClick={() => set('category', c.value)}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition-colors ${
                form.category === c.value ? 'bg-primary text-white border-primary' : 'bg-card text-muted-foreground border-border hover:border-primary/40'
              }`}>
              <c.Icon size={13} />{t(c.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Quién paga */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('expenses.form.paidBy')}</p>
        <div className="flex gap-2 flex-wrap">
          {members.map(email => (
            <button key={email} type="button" onClick={() => set('paid_by', email)}
              className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
                form.paid_by === email ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200' : 'bg-card border-border hover:border-primary/40'
              }`}>
              {(() => {
                const prof = profileMap?.[email] || null;
                return prof?.avatar_url
                  ? <img src={prof.avatar_url} alt="" style={{width:24,height:24,borderRadius:'50%',objectFit:'cover',flexShrink:0}} />
                  : <div style={{width:24,height:24,borderRadius:'50%',background:form.paid_by===email?'var(--kodo-bg-orange-mid)':'var(--kodo-progress-track)',color:form.paid_by===email?'hsl(var(--primary))':'var(--kodo-text-muted)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:500,flexShrink:0}}>
                      {getName(email).slice(0,2).toUpperCase()}
                    </div>;
              })()}
              <span className={`text-xs truncate font-medium ${form.paid_by === email ? 'text-primary' : 'text-muted-foreground'}`}>
                {isCurrentUser(email) ? t('common.you') : getName(email)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* División */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('expenses.form.splitBetween')}</p>
        {/* Mode selector */}
        <div className="flex rounded-xl border border-border overflow-hidden mb-3 text-sm">
          {[
            { key: 'equal', label: t('expenses.splitType.equal') },
            { key: 'custom', label: t('expenses.splitType.custom') },
            { key: 'solo', label: t('expenses.splitType.solo') },
          ].map(m => (
            <button key={m.key} type="button"
              onClick={() => {
                set('split_type', m.key);
                if (m.key === 'equal') set('split_with', [...members]);
                if (m.key === 'solo') { set('split_with', [form.paid_by || members[0]]); }
                if (m.key === 'custom') {
                  const eq = form.amount ? (parseFloat(form.amount) / members.length).toFixed(2) : '';
                  const init = members.reduce((a, e) => ({ ...a, [e]: eq }), {});
                  set('amounts_by_user', init); set('split_with', [...members]);
                }
              }}
              className={`flex-1 py-2 font-medium transition-colors text-xs ${
                form.split_type === m.key ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:bg-secondary/50'
              }`}>
              {m.label}
            </button>
          ))}
        </div>

        {form.split_type === 'equal' && (
          <div className="flex gap-2 flex-wrap">
            {members.map(email => {
              const selected = form.split_with.includes(email);
              const share = selected && form.split_with.length > 0 && form.amount
                ? (parseFloat(form.amount) / form.split_with.length) : null;
              const isZeroDecimal = isZeroDecimalCurrency(currency);
              const shareStr = share ? (isZeroDecimal ? Math.round(share).toLocaleString('es') : share.toFixed(2)) : null;
              const sp = profileMap?.[email];
              return (
                <button key={email} type="button" onClick={() => toggleMember(email)}
                  className={`flex-1 min-w-0 flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border transition-colors ${
                    selected ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200' : 'bg-card border-border hover:border-primary/40'
                  }`}>
                  {sp?.avatar_url
                    ? <img src={sp.avatar_url} alt="" style={{width:28,height:28,borderRadius:'50%',objectFit:'cover'}} />
                    : <div style={{width:28,height:28,borderRadius:'50%',background:selected?'var(--kodo-bg-orange-mid)':'var(--kodo-progress-track)',color:selected?'hsl(var(--primary))':'var(--kodo-text-muted)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:500}}>
                        {getName(email).slice(0,2).toUpperCase()}</div>}
                  <span className={`text-xs font-medium truncate max-w-full ${selected ? 'text-primary' : 'text-muted-foreground'}`}>
                    {isCurrentUser(email) ? t('common.you') : getName(email)}
                  </span>
                  {shareStr && <span className="text-xs text-primary font-medium">{shareStr} {currency}</span>}
                </button>
              );
            })}
          </div>
        )}

        {form.split_type === 'custom' && (
          <div className="space-y-2">
            {members.map(email => {
              const sp = profileMap?.[email];
              return (
                <div key={email} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-card">
                  {sp?.avatar_url
                    ? <img src={sp.avatar_url} alt="" style={{width:28,height:28,borderRadius:'50%',objectFit:'cover',flexShrink:0}} />
                    : <div style={{width:28,height:28,borderRadius:'50%',background:'var(--kodo-progress-track)',color:'var(--kodo-text-muted)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:500,flexShrink:0}}>
                        {getName(email).slice(0,2).toUpperCase()}</div>}
                  <span className="text-xs font-medium text-foreground flex-1 truncate">
                    {isCurrentUser(email) ? t('common.you') : getName(email)}
                  </span>
                  <input
                    type="number" min="0" step="any" placeholder="0"
                    value={form.amounts_by_user?.[email] || ''}
                    onChange={e => {
                      // min="0" no se aplica solo (este input no vive dentro
                      // de un <form>), así que sin este guard se podía escribir
                      // un importe negativo aquí: la suma seguía "cuadrando"
                      // con el total del gasto pero invertía quién debe a
                      // quién (ver customHasNegative en canSave/handleSave).
                      const raw = e.target.value.replace(/^-+/, '');
                      set('amounts_by_user', { ...form.amounts_by_user, [email]: raw });
                    }}
                    className="w-20 text-right text-sm border border-border rounded-lg px-2 py-1 outline-none focus:border-primary bg-secondary"
                  />
                  <span className="text-xs text-muted-foreground">{currency}</span>
                </div>
              );
            })}
            {(() => {
              const diff = parseFloat(form.amount || 0) - customTotal;
              if (Math.abs(diff) <= 0.01) {
                return customTotal > 0
                  ? <p className="text-xs text-green-600 mt-1">{t('expenses.form.totalMatches')}</p>
                  : null;
              }
              return (
                <p className="text-xs text-amber-600 mt-1">
                  {diff > 0
                    ? t('expenses.form.missingToAssign', { amount: Math.abs(diff).toFixed(2), currency })
                    : t('expenses.form.overAssigned', { amount: Math.abs(diff).toFixed(2), currency })}
                </p>
              );
            })()}
          </div>
        )}

        {form.split_type === 'solo' && (
          <p className="text-xs text-muted-foreground bg-secondary rounded-xl px-3 py-2">
            {t('expenses.form.soloHint')}
          </p>
        )}

        {form.split_type === 'equal' && form.split_with.length === 0 && (
          <p className="text-xs text-red-500 mt-2">{t('expenses.form.pickSomeone')}</p>
        )}
      </div>

      {/* Botones */}
    {/* Hidden submit trigger for ExpenseSheet */}
    <button id="expense-form-submit" type="button" onClick={handleSave} style={{display:'none'}} />
    </div>
  );
}