import { BusFront } from '@/lib/icons';
import { useState, useRef, useEffect } from 'react';
import { Loader2, Camera, Upload, X, Utensils, Hotel, Ticket, ShoppingBag, CirclePlus, Wine, Pencil, Calendar as CalendarIcon, MapPin, Check } from 'lucide-react';
import { FormSection, FormCard, FormRow, DatePill, OptionPill, Chip, PersonAvatar } from '@/components/form/FormPills';
import { splitEvenly, formatShare } from '@/lib/expenseSplit';
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
  'EUR','USD','GBP','JPY','CNY','CHF','MXN','ARS','BRL','THB','KRW','VND','MAD',
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
  const { t, i18n } = useTranslation();
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
    // José (24 sep 2026): por defecto paga quien apunta el gasto (antes era
    // members[0] = el creador del viaje, aunque apuntara otra persona).
    paid_by: members.find(m => normalizeEmail(m) === normalizeEmail(currentUserEmail)) || members[0] || '',
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
      const result = await base44.functions.invoke('uploadPublicFile', { file: uploadFile });
      const data = result?.data ?? result;
      if (data?.error) throw new Error(data.error);
      const { file_url } = data;
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

  // ── Reparto (José, 24 sep 2026) ────────────────────────────────────────
  //  - A partes iguales: entre las personas marcadas (por defecto, todas).
  //  - Personalizado: cuánto le toca a cada uno (tiene que cuadrar).
  //  - Solo para mí: gasto propio, lo pagaste tú y es para ti; no afecta a
  //    los balances. Al elegirlo, quien paga pasa a ser quien lo apunta (antes
  //    se quedaba el pagador que hubiera marcado, y "para mí" era en realidad
  //    "para quien pagó"). Si Ana pagó algo solo para ti: "A partes iguales"
  //    marcándote solo a ti.
  const zeroDec = isZeroDecimalCurrency(currency);
  const lang = i18n.language === 'en' ? 'en' : 'es';
  const me = members.find(m => normalizeEmail(m) === normalizeEmail(currentUserEmail)) || members[0] || '';
  const setSplitType = (key) => {
    if (key === 'equal') setForm(p => ({ ...p, split_type: 'equal', split_with: p.split_type === 'equal' && p.split_with.length ? p.split_with : [...members] }));
    if (key === 'solo') setForm(p => ({ ...p, split_type: 'solo', paid_by: me, split_with: [me] }));
    if (key === 'custom') {
      const shares = splitEvenly(parseFloat(form.amount) || 0, members.length, zeroDec);
      const init = members.reduce((acc, e, i) => ({ ...acc, [e]: shares[i] != null ? String(shares[i]) : '' }), {});
      setForm(p => ({ ...p, split_type: 'custom', amounts_by_user: init, split_with: [...members] }));
    }
  };
  const equalMembers = members.filter(m => form.split_with.includes(m));
  const equalShares = splitEvenly(parseFloat(form.amount) || 0, equalMembers.length, zeroDec);
  const shareFor = (email) => { const i = equalMembers.indexOf(email); return i >= 0 ? equalShares[i] : null; };
  const soloOfOther = form.split_type === 'solo' && normalizeEmail(form.paid_by) !== normalizeEmail(me);
  const cityOptions = cities.map(c => ({ value: c.id, label: c.name }));
  const person = (email) => {
    const prof = profileMap?.[email] || profileMap?.[normalizeEmail(email)] || null;
    return {
      name: isCurrentUser(email) ? t('common.you') : getName(email),
      avatar: <PersonAvatar email={email} profile={prof} />,
    };
  };

  return (
    <div className="space-y-5">

      {/* Importe — grande y centrado; la moneda en pastilla */}
      <div className="bg-secondary rounded-2xl py-6 px-4 text-center">
        <input
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={form.amount}
          onChange={e => set('amount', normalizeAmountInput(e.target.value))}
          autoFocus
          className="text-5xl font-bold text-center bg-transparent outline-none text-foreground placeholder:text-border w-full mb-1"
          style={{ letterSpacing: '-1px' }}
        />
        <div className="w-16 h-0.5 bg-primary rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-center gap-3">
          <OptionPill value={currency} onChange={v => v && set('currency', v)}
            options={orderedCurrencies.map(c => ({ value: c, label: c }))} placeholder={currency} />
          {!isSameCurrency && form.amount && parseFloat(form.amount) > 0 && (
            <span className="text-xs text-muted-foreground">
              {converting ? '...' : fxInfo ? `≈ ${fxInfo.amountConverted.toLocaleString('es')} ${baseCurrency}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Detalles: descripción + recibo, fecha y ciudad */}
      <FormCard>
        <FormRow icon={Pencil}>
          <div className="flex items-center gap-2">
            <input
              placeholder={t('expenses.form.descPlaceholder')}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              autoCapitalize="sentences" autoCorrect="on" spellCheck
              className="flex-1 min-w-0 text-sm text-foreground placeholder:text-muted-foreground bg-transparent outline-none"
            />
            <div className="flex gap-1.5 flex-shrink-0">
              <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={uploadingReceipt} aria-label={t('expenses.form.receiptCamera')}
                className="w-8 h-8 rounded-full bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center text-primary disabled:opacity-40">
                {uploadingReceipt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingReceipt} aria-label={t('expenses.form.receiptUpload')}
                className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground disabled:opacity-40">
                <Upload className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {receipts.length > 0 && (
            <div className="flex gap-2 pt-2 flex-wrap">
              {receipts.map((url, i) => (
                <div key={i} className="relative">
                  <img src={url} alt="" className="w-14 h-14 rounded-lg object-cover border border-border" />
                  <button type="button" onClick={() => setReceipts(p => p.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </FormRow>
        <FormRow icon={CalendarIcon}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Guía, no bloqueo: un gasto antes/después del viaje es válido. */}
            <DatePill value={form.date} onChange={v => v && set('date', v)} />
            {cities.length > 0 && (
              <OptionPill value={form.city_id || ''}
                onChange={cityId => setForm(p => ({ ...p, city_id: cityId, city_name: cities.find(c => c.id === cityId)?.name || '' }))}
                options={cityOptions} placeholder={t('expenses.form.noCityOption')} icon={MapPin}
                allowEmpty emptyLabel={t('expenses.form.noCityOption')} />
            )}
          </div>
        </FormRow>
      </FormCard>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleReceiptUpload(e.target.files[0])} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files?.[0] && handleReceiptUpload(e.target.files[0])} />

      <FormSection title={t('common.type')}>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(c => (
            <button key={c.value} type="button" onClick={() => set('category', c.value)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                form.category === c.value ? 'bg-primary text-white border-primary' : 'bg-card text-foreground border-border hover:bg-secondary/40'
              }`}>
              <c.Icon size={14} />{t(c.labelKey)}
            </button>
          ))}
        </div>
      </FormSection>

      {/* ¿Quién pagó? — no hace falta en un gasto propio (lo pagaste tú) */}
      {form.split_type !== 'solo' && (
        <FormSection title={t('expenses.form.whoPaid')}>
          <div className="flex flex-wrap gap-2">
            {members.map(email => {
              const { name, avatar } = person(email);
              return (
                <Chip key={email} on={form.paid_by === email} onClick={() => set('paid_by', email)} avatar={avatar}>{name}</Chip>
              );
            })}
          </div>
        </FormSection>
      )}

      <FormSection title={t('expenses.form.howSplit')}>
        <div className="flex flex-wrap gap-2 mb-3">
          {[['equal', t('expenses.splitType.equal')], ['custom', t('expenses.splitType.custom')], ['solo', t('expenses.splitType.solo')]].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setSplitType(key)}
              className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
                form.split_type === key ? 'bg-primary text-white border-primary' : 'bg-card text-foreground border-border hover:bg-secondary/40'
              }`}>{label}</button>
          ))}
        </div>

        {form.split_type === 'equal' && (
          <>
            <div className="bg-card border border-border rounded-2xl divide-y divide-border/70">
              {members.map(email => {
                const on = form.split_with.includes(email);
                const share = shareFor(email);
                const { name, avatar } = person(email);
                return (
                  <button key={email} type="button" onClick={() => toggleMember(email)} aria-pressed={on}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                    {avatar}
                    <span className={`flex-1 min-w-0 truncate text-sm ${on ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{name}</span>
                    {on && share != null && <span className="text-sm font-semibold text-primary">{formatShare(share, zeroDec, lang)} {currency}</span>}
                    <span className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${on ? 'bg-primary' : 'border border-border bg-card'}`}>
                      {on && <Check className="w-3 h-3 text-white" />}
                    </span>
                  </button>
                );
              })}
            </div>
            {form.split_with.length === 0 && <p className="text-xs text-red-500 mt-2">{t('expenses.form.pickSomeone')}</p>}
          </>
        )}

        {form.split_type === 'custom' && (
          <>
            <div className="bg-card border border-border rounded-2xl divide-y divide-border/70">
              {members.map(email => {
                const { name, avatar } = person(email);
                return (
                  <div key={email} className="flex items-center gap-3 px-3 py-2">
                    {avatar}
                    <span className="flex-1 min-w-0 truncate text-sm text-foreground">{name}</span>
                    <input
                      type="text" inputMode="decimal" placeholder="0"
                      value={form.amounts_by_user?.[email] || ''}
                      onChange={e => {
                        // Sin negativos: la suma podría "cuadrar" invirtiendo quién debe a quién.
                        const raw = normalizeAmountInput(e.target.value.replace(/^-+/, ''));
                        set('amounts_by_user', { ...form.amounts_by_user, [email]: raw });
                      }}
                      className="w-24 text-right text-sm font-semibold border border-border rounded-full px-3 py-1.5 outline-none focus:border-primary bg-secondary"
                    />
                    <span className="text-xs text-muted-foreground w-9">{currency}</span>
                  </div>
                );
              })}
            </div>
            {(() => {
              const diff = parseFloat(form.amount || 0) - customTotal;
              if (Math.abs(diff) <= 0.01) {
                return customTotal > 0 ? <p className="text-xs text-green-600 mt-2">{t('expenses.form.totalMatches')}</p> : null;
              }
              return (
                <p className="text-xs text-amber-600 mt-2">
                  {diff > 0
                    ? t('expenses.form.missingToAssign', { amount: formatShare(Math.abs(diff), zeroDec, lang), currency })
                    : t('expenses.form.overAssigned', { amount: formatShare(Math.abs(diff), zeroDec, lang), currency })}
                </p>
              );
            })()}
          </>
        )}

        {form.split_type === 'solo' && (
          <p className="text-xs text-muted-foreground bg-secondary rounded-xl px-3 py-2">
            {soloOfOther ? t('expenses.form.soloHintOther', { name: getName(form.paid_by) }) : t('expenses.form.soloHint')}
          </p>
        )}
      </FormSection>

    {/* Hidden submit trigger for ExpenseSheet */}
    <button id="expense-form-submit" type="button" onClick={handleSave} style={{display:'none'}} />
    </div>
  );
}
