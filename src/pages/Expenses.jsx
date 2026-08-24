import { BusFront } from '@/lib/icons';
import { useTranslation } from 'react-i18next';
import { createPageUrl } from '@/utils';
import { toast } from '@/components/ui/use-toast';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Trash2, Utensils, Hotel, Ticket, ShoppingBag, MoreHorizontal, DollarSign, Scale, BarChart2, Compass, Wine, AlertTriangle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useTripContext } from '@/hooks/useTripContext';
import { getCountryMeta, computeAvailableCurrencies } from '@/lib/countryConfig';
import { getFxRate } from '@/lib/fxRates';
import { notify, resolveUserIds } from '@/lib/notifications';
import { calculateBalances, getDebts } from '@/lib/expenseBalances';
import { computeEditors } from '@/lib/syncTripMembers';
import { normalizeEmail, isZeroDecimalCurrency } from '@/lib/utils';
import { searchUserProfiles } from '@/lib/userProfiles';
import ExpenseForm from '@/components/expenses/ExpenseForm';
import PDFViewer from '@/components/PDFViewer';
import OTabBar from '@/components/trip/OTabBar';
import Avatar from '@/components/trip/Avatar';
import { format } from 'date-fns';


// ── Category config ───────────────────────────────────────────────────────────
const CAT_ICONS = {
  food:          Utensils,
  transport:     BusFront,
  accommodation: Hotel,
  activities:    Ticket,
  shopping:      ShoppingBag,
  drinks:        Wine,
  other:         MoreHorizontal,
};
const CAT_COLORS = {
  food: 'bg-orange-100 dark:bg-orange-950/30 text-primary', transport: 'bg-blue-100 dark:bg-blue-950/30 text-blue-600',
  accommodation: 'bg-purple-100 dark:bg-purple-950/30 text-purple-600', activities: 'bg-pink-100 dark:bg-pink-950/30 text-pink-600',
  shopping: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600', drinks: 'bg-pink-100 dark:bg-pink-950/30 text-pink-600', other: 'bg-secondary text-muted-foreground',
};
const CAT_CONFIG = {
  food:          { label: 'expenses.categories.food'          },
  transport:     { label: 'expenses.categories.transport'      },
  accommodation: { label: 'expenses.categories.accommodation'  },
  activities:    { label: 'expenses.categories.activities'     },
  shopping:      { label: 'expenses.categories.shopping'       },
  drinks:        { label: 'expenses.categories.drinks'         },
  other:         { label: 'expenses.categories.other'          },
};

// ── Currency symbol helper ─────────────────────────────────────────────────────
function sym(code) {
  const MAP = { EUR:'€', USD:'$', GBP:'£', JPY:'¥', KRW:'₩', CNY:'¥', THB:'฿', VND:'₫', INR:'₹', MXN:'$', COP:'$', CLP:'$' };
  return MAP[code] || code;
}

function fmtAmt(n, code) {
  const isZeroDecimal = isZeroDecimalCurrency(code);
  const v = isZeroDecimal ? Math.round(n) : parseFloat(n.toFixed(2));
  return v.toLocaleString('es');
}


// ── CurrencyBanner — shown when active city changes ───────────────────────────
function CurrencyBanner({ countryName, currencyCode, flag, onAccept, onDismiss }) {
  const { t } = useTranslation();
  return (
    <div style={{ background: 'var(--kodo-bg-orange)', border: '0.5px solid var(--kodo-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{flag}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 3 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'hsl(var(--primary))' }}>{t('expenses.arrivedAt', { countryName })}</p>
            <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'var(--kodo-border)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0, marginTop: -2 }}>×</button>
          </div>
          <p style={{ fontSize: 12, color: 'hsl(var(--primary))', marginBottom: 10, lineHeight: 1.4 }}>
            {t('expenses.localCurrencyPrompt', { currencyCode })}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onAccept}
              style={{ flex: 1, background: 'hsl(var(--primary))', color: 'white', border: 'none', borderRadius: 8, padding: '7px 0', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              {t('expenses.useThisCurrency', { currencyCode })}
            </button>
            <button onClick={onDismiss}
              style={{ flex: 1, background: 'white', color: 'hsl(var(--primary))', border: '0.5px solid hsl(var(--primary) / 0.3)', borderRadius: 8, padding: '7px 0', fontSize: 12, cursor: 'pointer' }}>
              {t('expenses.keepBaseCurrency')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Expense row ───────────────────────────────────────────────────────────────
function ExpenseRow({ expense, baseCurrency, userMap, onEdit, onDelete }) {
  const { t } = useTranslation();
  const tc = CAT_CONFIG[expense.category] || CAT_CONFIG.other;
  const isSame = expense.currency === baseCurrency || !expense.currency;
  const paidByName = userMap[normalizeEmail(expense.paid_by)] || t('common.member');
  const splitCount = expense.split_with?.length || 1;

  return (
    <button onClick={() => onEdit(expense)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-secondary/20 transition-colors border-b border-border last:border-0">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${CAT_COLORS[expense.category] || CAT_COLORS.other}`}>
        {(() => { const I = CAT_ICONS[expense.category] || CAT_ICONS.other; return <I size={16} />; })()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{expense.description}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t('expenses.paidBy')} {paidByName} · ÷ {splitCount}</p>
      </div>
      <div className="text-right flex-shrink-0">
        {/* Moneda original — siempre visible y prominente */}
        <p className="text-sm font-semibold text-foreground">
          {sym(expense.currency || baseCurrency)}{fmtAmt(parseFloat(expense.amount || 0), expense.currency || baseCurrency)}
          {' '}<span className="text-xs font-normal text-muted-foreground">{expense.currency || baseCurrency}</span>
        </p>
        {/* Equivalente en base — solo si moneda diferente */}
        {!isSame && (
          expense.fx_source === 'unavailable' ? (
            <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1 justify-end">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              {t('expenses.fx.notConverted')}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">
              ≈ {sym(baseCurrency)}{fmtAmt(parseFloat(expense.amount_base || expense.amount || 0), baseCurrency)} {baseCurrency}
            </p>
          )
        )}
      </div>
    </button>
  );
}

// ── Tab: Gastos ───────────────────────────────────────────────────────────────
function GastosTab({ expenses, baseCurrency, userMap, onEdit, onDelete, onAdd, currentUserEmail }) {
  const { t, i18n } = useTranslation();
  const [catFilter, setCatFilter] = useState('all');

  const filtered = catFilter === 'all' ? expenses : expenses.filter(e => e.category === catFilter);

  // Group by date
  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach(e => {
      const d = e.date || e.created_date?.slice(0, 10) || t('expenses.noDate');
      if (!g[d]) g[d] = [];
      g[d].push(e);
    });
    return Object.entries(g).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  const formatDate = (d) => {
    if (d === t('expenses.noDate')) return d;
    try {
      return new Date(d + 'T12:00:00').toLocaleDateString(i18n?.language === 'en' ? 'en-GB' : 'es', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch { return d; }
  };

  if (expenses.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border text-center py-16 px-6">
        <DollarSign className="w-8 h-8 mx-auto mb-3 opacity-25" />
        <p className="text-sm font-medium text-foreground mb-1">{t('expenses.noExpensesYet')}</p>
        <p className="text-xs text-muted-foreground mb-5">{t('expenses.noExpensesSubtitle')}</p>
        <button onClick={onAdd} className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm rounded-full font-medium">
          <Plus className="w-4 h-4" />{t('expenses.addFirst')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Categorías */}
      <div className="flex flex-wrap gap-2">
        {[['all', null, t('common.all')], ...Object.entries(CAT_CONFIG).map(([k, v]) => [k, k, t(v.label)])].map(([k, catKey, l]) => (
          <button key={k} onClick={() => setCatFilter(k)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1 ${
              catFilter === k ? 'bg-primary text-white border-primary' : 'bg-card border-border text-muted-foreground hover:border-primary/40'
            }`}>
            {catKey && CAT_ICONS[catKey] ? (() => { const I = CAT_ICONS[catKey]; return <I size={12} />; })() : <Compass size={12} />} {l}
          </button>
        ))}
      </div>

      {/* Lista agrupada por fecha */}
      {grouped.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">{t('expenses.noCategoryExpenses')}</div>
      ) : (
        grouped.map(([date, exps]) => (
          <div key={date}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{formatDate(date)}</p>
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              {exps.map(e => (
                <ExpenseRow key={e.id} expense={e} baseCurrency={baseCurrency} userMap={userMap} onEdit={onEdit} onDelete={onDelete} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Tab: Balances ─────────────────────────────────────────────────────────────
function BalancesTab({ expenses, members, currentUserEmail, userMap, baseCurrency, profilesByEmail, onSettle }) {
  const { t } = useTranslation();
  // calculateBalances/getDebts trabajan siempre en minúsculas (ver
  // expenseBalances.js) — aquí también hay que normalizar antes de comparar
  // contra balances/debts, o el propio currentUserEmail no haría match con
  // su entrada normalizada y "myBalance"/"iOwe"/"owesMe" saldrían vacíos.
  const balances = useMemo(() => calculateBalances(expenses, members), [expenses, members]);
  const debts = useMemo(() => getDebts(balances), [balances]);
  const meNorm = normalizeEmail(currentUserEmail);

  const myBalance = balances[meNorm] || 0;
  const iSettled = Math.abs(myBalance) < 0.01;
  // Bug real (24-ago, reportado con captura): "Todos en paz" / "No hay
  // deudas pendientes en el grupo" se mostraba en cuanto MI balance
  // llegaba a cero (p. ej. justo después de saldar mi propia deuda),
  // aunque el resto del grupo siguiera debiéndose dinero entre sí — el
  // texto prometía algo sobre TODO el grupo pero la condición solo miraba
  // a una persona. `debts` (ver arriba) ya es la lista de deudas
  // pendientes de TODO el grupo tras `calculateBalances`/`getDebts` — así
  // que "de verdad no queda nadie a deber" es simplemente que esté vacía.
  const allSettled = debts.length === 0;

  const iOwe   = debts.filter(d => d.from === meNorm);
  const owesMe = debts.filter(d => d.to   === meNorm);

  // settlingKey evita doble-submit: "Saldar" dispara createMutation.mutateAsync
  // (handleSettle) sin ningún guard local — un doble tap creaba dos gastos de
  // liquidación idénticos. Se deshabilita solo el botón de la deuda que se
  // está saldando (no todos), identificada por from+to.
  const [settlingKey, setSettlingKey] = useState(null);
  const handleSettleClick = async (debt) => {
    const key = `${debt.from}-${debt.to}`;
    if (settlingKey) return;
    setSettlingKey(key);
    try {
      await onSettle(debt);
    } finally {
      setSettlingKey(null);
    }
  };

  // Convert each debt to debtor's home_currency for display.
  // getFxRate ya cachea en localStorage/ExchangeRateCache (24h), pero antes
  // se llamaba una vez POR DEUDA aunque varias compartieran la misma moneda
  // (p. ej. 4 personas debiendo en USD contra una base en EUR disparaban 4
  // llamadas idénticas en paralelo, cada una re-parseando el mismo JSON de
  // localStorage). Ahora se calcula el conjunto de monedas únicas que hacen
  // falta y se pide la tasa una sola vez por moneda, no por deuda.
  const [convertedDebts, setConvertedDebts] = useState({});
  useEffect(() => {
    if (!debts.length) return;
    const run = async () => {
      const neededCurrencies = new Set();
      debts.forEach(d => {
        const debtorCurrency = profilesByEmail?.[d.from]?.home_currency || baseCurrency;
        const creditorCurrency = profilesByEmail?.[d.to]?.home_currency || baseCurrency;
        if (debtorCurrency !== baseCurrency) neededCurrencies.add(debtorCurrency);
        if (creditorCurrency !== baseCurrency) neededCurrencies.add(creditorCurrency);
      });

      const rateEntries = await Promise.all(
        [...neededCurrencies].map(async (currency) => {
          try {
            const fx = await getFxRate(baseCurrency, currency);
            return [currency, fx.rate];
          } catch {
            return [currency, null];
          }
        })
      );
      const rateByCurrency = Object.fromEntries(rateEntries);

      const results = {};
      debts.forEach((d, i) => {
        const debtorCurrency  = profilesByEmail?.[d.from]?.home_currency || baseCurrency;
        const creditorCurrency = profilesByEmail?.[d.to]?.home_currency  || baseCurrency;
        const debtorRate = debtorCurrency !== baseCurrency ? rateByCurrency[debtorCurrency] : null;
        const creditorRate = creditorCurrency !== baseCurrency ? rateByCurrency[creditorCurrency] : null;
        const debtorAmount = debtorRate ? parseFloat((d.amount * debtorRate).toFixed(2)) : d.amount;
        const creditorAmount = creditorRate ? parseFloat((d.amount * creditorRate).toFixed(2)) : d.amount;
        results[i] = { debtorAmount, debtorCurrency, creditorAmount, creditorCurrency };
      });
      setConvertedDebts(results);
    };
    run();
  }, [debts.map(d => `${d.from}-${d.to}-${d.amount}`).join(','), profilesByEmail, baseCurrency]);

  // Gastos cuya conversión a la moneda base falló (fx_source === 'unavailable'):
  // calculateBalances los suma igualmente usando el monto original como si ya
  // estuviera en baseCurrency (ver expenseBalances.js), así que si hay varios
  // el balance mostrado puede estar mezclando monedas sin avisar. Antes solo
  // se marcaba fila por fila en GastosTab (ExpenseRow) — aquí, donde se toman
  // decisiones de "quién le debe a quién", no había ningún aviso.
  // Este hook tiene que ir ANTES del early return de abajo (expenses.length
  // === 0): moverlo después violaba las Rules of Hooks — con la lista vacía
  // en el primer render y expenses llegando después vía react-query, el
  // número de hooks cambiaba entre renders y React podía romper el
  // componente entero (u otros hooks empezaban a leer el state equivocado).
  const unavailableFxCount = useMemo(
    () => expenses.filter(e => e.fx_source === 'unavailable').length,
    [expenses]
  );

  if (expenses.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border text-center py-16">
        <Scale className="w-8 h-8 mx-auto mb-3 opacity-25" />
        <p className="text-sm font-medium text-foreground mb-1">{t('expenses.noDataYet')}</p>
        <p className="text-xs text-muted-foreground">{t('expenses.addToSeeBalances')}</p>
      </div>
    );
  }

  // from=true → muestra moneda del deudor (quien paga)
  // from=false → muestra moneda del acreedor (quien recibe)
  const DebtAmount = ({ idx, d, from }) => {
    const cv = convertedDebts[idx];
    if (!cv) return <span>{fmtAmt(d.amount, baseCurrency)} {sym(baseCurrency)}</span>;
    const primaryCurrency = from ? cv.debtorCurrency  : cv.creditorCurrency;
    const primaryAmount   = from ? cv.debtorAmount    : cv.creditorAmount;
    const otherCurrency   = from ? cv.creditorCurrency : cv.debtorCurrency;
    const otherAmount     = from ? cv.creditorAmount   : cv.debtorAmount;
    return (
      <>
        <span className="font-semibold">{sym(primaryCurrency)}{fmtAmt(primaryAmount, primaryCurrency)} {primaryCurrency}</span>
        {primaryCurrency !== otherCurrency && (
          <span className="text-muted-foreground font-normal"> ≈ {sym(otherCurrency)}{fmtAmt(otherAmount, otherCurrency)} {otherCurrency}</span>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      {unavailableFxCount > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('expenses.fx.pendingAggregate', { count: unavailableFxCount })}
          </p>
        </div>
      )}
      {/* Mi balance — card prominente */}
      <div className={`rounded-2xl border p-4 ${
        iSettled ? 'bg-card border-border' :
        myBalance > 0 ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/40' :
        'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40'
      }`}>
        <p className={`text-xs font-medium mb-2 ${iSettled ? 'text-muted-foreground' : myBalance > 0 ? 'text-green-800 dark:text-green-400' : 'text-red-800 dark:text-red-400'}`}>
          {t('expenses.balance.yourBalance')}
        </p>
        <p className={`text-3xl font-medium ${iSettled ? 'text-foreground' : myBalance > 0 ? 'text-green-700' : 'text-red-600'}`}>
          {iSettled ? t('expenses.balance.upToDate') : `${myBalance > 0 ? '+' : ''}${fmtAmt(myBalance, baseCurrency)} ${sym(baseCurrency)}`}
        </p>
        {!iSettled && (
          <p className={`text-xs mt-1 font-medium ${myBalance > 0 ? 'text-green-700' : 'text-red-600'}`}>
            {myBalance > 0 ? t('expenses.balance.theyOweYouThis') : t('expenses.balance.youOweThis')}
          </p>
        )}
        {(() => {
          const isSettlement = (e) => e.is_settlement === true || (e.description || '').startsWith('Liquidación:');
          const realExpenses = expenses.filter(e => !isSettlement(e));
          let iPaid = 0;
          let myShare = 0;
          // Math.max(0, ...) en los 6 usos de amount_base/amount de este archivo:
          // el hardening contra negativos que ya tenía amounts_by_user (reparto
          // personalizado) no cubría el campo que usan TODOS los split_type,
          // incluido "equal" — Expense.jsonc no impone un mínimo y su rls de
          // update deja a cualquier miembro reescribir el monto de un gasto
          // ajeno, así que un valor negativo colado por API/devtools invertía
          // quién debe a quién en balances y estadísticas.
          realExpenses.forEach(e => {
            const amt = Math.max(0, parseFloat(e.amount_base || e.amount) || 0);
            if (!amt) return;
            if (normalizeEmail(e.paid_by) === meNorm) iPaid += amt;
            const myShareKey = Object.keys(e.amounts_by_user || {}).find(k => normalizeEmail(k) === meNorm);
            if (e.split_type === 'custom' && myShareKey) {
              // Mismo hardening que calculateBalances() en expenseBalances.js:
              // sin Math.max(0,...), un importe negativo colado por API/edición
              // directa podía inflar o invertir "mi parte" aquí aunque el
              // balance real (que sí usa expenseBalances.js) ya estuviera
              // saneado — las dos cifras dejaban de cuadrar en la misma
              // pantalla.
              const safeAmounts = Object.fromEntries(
                Object.entries(e.amounts_by_user).map(([k, v]) => [k, Math.max(0, parseFloat(v) || 0)])
              );
              const total = Object.values(safeAmounts).reduce((s, v) => s + v, 0);
              if (total > 0) myShare += (safeAmounts[myShareKey] / total) * amt;
            } else {
              // Igual que calculateBalances(): deduplicar con Set — un viaje
              // con datos legado (mismo email repetido con distinta
              // capitalización en trip.members/split_with) inflaba
              // parts.length y subestimaba "mi parte".
              const parts = [...new Set((e.split_with?.length > 0 ? e.split_with : [e.paid_by]).map(normalizeEmail))];
              if (parts.includes(meNorm)) myShare += amt / parts.length;
            }
          });
          return iPaid > 0 ? (
            <div className="mt-3 pt-3 border-t border-border/50 flex gap-4">
              <div><p className="text-xs text-muted-foreground">{t('expenses.balance.iPaid')}</p><p className="text-sm font-medium text-foreground">{fmtAmt(iPaid, baseCurrency)} {sym(baseCurrency)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('expenses.balance.myShare')}</p><p className="text-sm font-medium text-foreground">{fmtAmt(myShare, baseCurrency)} {sym(baseCurrency)}</p></div>
            </div>
          ) : null;
        })()}
      </div>

      {/* Lo que debo */}
      {iOwe.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('expenses.balance.youNeedToPay')}</p>
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            {iOwe.map((d, i) => {
              const idx = debts.indexOf(d);
              const cv = convertedDebts[idx];
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-0">
                  <Avatar email={d.to} profiles={profilesByEmail} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{userMap[d.to] || t('common.member')}</p>
                    <p className="text-xs text-red-500 font-medium mt-0.5">
                      {t('expenses.balance.youOwe')} <DebtAmount idx={idx} d={d} from={true} />
                    </p>
                  </div>
                  <button
                    onClick={() => handleSettleClick({ ...d, displayAmount: cv?.debtorAmount || d.amount, displayCurrency: cv?.debtorCurrency || baseCurrency })}
                    disabled={!!settlingKey}
                    className="text-sm bg-primary text-white px-4 py-2 rounded-full font-semibold flex-shrink-0 disabled:opacity-50 disabled:pointer-events-none">
                    {settlingKey === `${d.from}-${d.to}` ? t('common.loading') : t('expenses.balance.settle')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lo que me deben */}
      {owesMe.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('expenses.balance.theyOweYou')}</p>
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            {owesMe.map((d, i) => {
              const idx = debts.indexOf(d);
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-0">
                  <Avatar email={d.from} profiles={profilesByEmail} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{userMap[d.from] || t('common.member')}</p>
                    <p className="text-xs text-green-600 font-medium mt-0.5">
                      {t('expenses.balance.owesYou')} <DebtAmount idx={idx} d={d} from={false} />
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{t('expenses.balance.pending')}</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">{t('expenses.balance.theyWillSee', { button: t('expenses.balance.settle') })}</p>
        </div>
      )}

      {/* Saldo de todos — visible mientras quede alguna deuda en el GRUPO,
          no solo mientras yo tenga una (si no, en cuanto te saldas tú
          desaparece justo la información de quién más debe todavía). */}
      {!allSettled && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('expenses.balance.groupBalance')}</p>
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            {members.map((email) => {
              const bal = balances[normalizeEmail(email)] || 0;
              const isMe = normalizeEmail(email) === meNorm;
              const name = userMap[normalizeEmail(email)] || t('common.member');
              const total = Math.max(...Object.values(balances).map(Math.abs), 0.01);
              const pct = Math.abs(bal) / total * 100;
              return (
                <div key={email} className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-0">
                  <Avatar email={email} profiles={profilesByEmail} size={30} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between mb-1.5">
                      <span className="text-sm font-medium text-foreground">{isMe ? t('expenses.balance.you') : name}</span>
                      <span className={`text-sm font-medium ${Math.abs(bal) < 0.01 ? 'text-muted-foreground' : bal > 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {Math.abs(bal) < 0.01 ? '0' : `${bal > 0 ? '+' : ''}${fmtAmt(bal, baseCurrency)}`} {sym(baseCurrency)}
                      </span>
                    </div>
                    <div style={{ height: 4, background: 'hsl(var(--secondary))', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: Math.abs(bal) < 0.01 ? 'hsl(var(--muted-foreground))' : bal > 0 ? '#16a34a' : '#dc2626', borderRadius: 4 }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {allSettled && (
        <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/40 rounded-2xl p-4 text-center">
          <p className="text-sm font-medium text-green-700">{t('expenses.balance.everyoneSettled')}</p>
          <p className="text-xs text-green-600 mt-1">{t('expenses.balance.noDebts')}</p>
        </div>
      )}
    </div>
  );
}


// ── Tab: Estadísticas ─────────────────────────────────────────────────────────
function StatsTab({ expenses, baseCurrency, currentUserEmail, cities = [], trip }) {
  const { t } = useTranslation();
  const s = sym(baseCurrency);
  // Mismo motivo que en BalancesTab: paid_by/split_with/amounts_by_user
  // pueden traer el email con mayúsculas distintas a currentUserEmail — sin
  // normalizar, "lo que pagué"/"mi parte" salía en 0 para cualquiera cuyo
  // email no coincidiera carácter a carácter.
  const meNorm = normalizeEmail(currentUserEmail);

  // Excluir liquidaciones — no son gastos reales, son transferencias contables
  // Usamos el patrón de descripción porque is_settlement puede no estar en el schema de base44
  const isSettlement = (e) => e.is_settlement === true || (e.description || '').startsWith('Liquidación:');
  const realExpenses = useMemo(() => expenses.filter(e => !isSettlement(e)), [expenses]);

  // {t('expenses.balance.myShare')} = lo que pagué adelantado - lo que me deben neto
  // Esta fórmula es equivalente a calculateBalances pero más directa para Stats
  const mySpend = useMemo(() => {
    let iPaid = 0;
    let myShare = 0;
    realExpenses.forEach(e => {
      const amt = Math.max(0, parseFloat(e.amount_base || e.amount) || 0);
      if (!amt) return;
      // Lo que pagué yo
      if (normalizeEmail(e.paid_by) === meNorm) iPaid += amt;
      // Mi parte según el split — mismo hardening que calculateBalances() en
      // expenseBalances.js (Math.max(0,...) sobre importes negativos, Set
      // dedup en split_with) para que esta cifra no se desincronice de "Tu
      // balance" en la pestaña Balances ante los mismos datos borde.
      const myShareKey = Object.keys(e.amounts_by_user || {}).find(k => normalizeEmail(k) === meNorm);
      if (e.split_type === 'custom' && myShareKey) {
        const safeAmounts = Object.fromEntries(
          Object.entries(e.amounts_by_user).map(([k, v]) => [k, Math.max(0, parseFloat(v) || 0)])
        );
        const total = Object.values(safeAmounts).reduce((s, v) => s + v, 0);
        if (total > 0) myShare += (safeAmounts[myShareKey] / total) * amt;
      } else {
        const parts = [...new Set((e.split_with?.length > 0 ? e.split_with : [e.paid_by]).map(normalizeEmail))];
        if (parts.includes(meNorm)) myShare += amt / parts.length;
      }
    });
    // mySpend = mi parte real del gasto (no lo que adelanté para otros)
    return myShare;
  }, [realExpenses, meNorm]);

  // Total real del grupo (sin liquidaciones)
  const totalGroup = useMemo(() =>
    realExpenses.reduce((s, e) => s + (Math.max(0, parseFloat(e.amount_base || e.amount) || 0)), 0),
  [realExpenses]);

  // Días: usar fechas reales del viaje si están disponibles
  const tripDays = useMemo(() => {
    if (trip?.start_date && trip?.end_date) {
      const diff = Math.round((new Date(trip.end_date + 'T00:00:00') - new Date(trip.start_date + 'T00:00:00')) / 86400000) + 1;
      return Math.max(1, diff);
    }
    // Fallback: rango de fechas de gastos reales
    const dates = realExpenses.map(e => e.date).filter(Boolean).sort();
    if (!dates.length) return 1;
    return Math.max(1, Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000) + 1);
  }, [realExpenses, trip]);

  const myPerDay = tripDays > 0 ? mySpend / tripDays : mySpend;

  // {t('expenses.myExpense')} por categoría (solo mi parte real de gastos reales)
  const myByCategory = useMemo(() => {
    const acc = {};
    realExpenses.forEach(e => {
      const amt = Math.max(0, parseFloat(e.amount_base || e.amount) || 0);
      if (!amt) return;
      let myShare = 0;
      const myShareKey = Object.keys(e.amounts_by_user || {}).find(k => normalizeEmail(k) === meNorm);
      if (e.split_type === 'custom' && myShareKey) {
        const safeAmounts = Object.fromEntries(
          Object.entries(e.amounts_by_user).map(([k, v]) => [k, Math.max(0, parseFloat(v) || 0)])
        );
        const total = Object.values(safeAmounts).reduce((s, v) => s + v, 0);
        myShare = total > 0 ? (safeAmounts[myShareKey] / total) * amt : 0;
      } else {
        const parts = [...new Set((e.split_with?.length > 0 ? e.split_with : [e.paid_by]).map(normalizeEmail))];
        if (parts.includes(meNorm)) myShare = amt / parts.length;
      }
      if (myShare > 0) acc[e.category || 'other'] = (acc[e.category || 'other'] || 0) + myShare;
    });
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }, [realExpenses, meNorm]);

  const maxCat = myByCategory[0]?.[1] || 1;

  // Grupo por categoría (sin liquidaciones)
  const groupByCategory = useMemo(() => {
    const acc = {};
    realExpenses.forEach(e => {
      const cat = e.category || 'other';
      acc[cat] = (acc[cat] || 0) + (Math.max(0, parseFloat(e.amount_base || e.amount) || 0));
    });
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }, [realExpenses]);

  // Por ciudad (sin liquidaciones)
  const byCity = useMemo(() => {
    const acc = {};
    realExpenses.forEach(e => {
      const city = e.city_name || t('expenses.noCity');
      acc[city] = (acc[city] || 0) + (Math.max(0, parseFloat(e.amount_base || e.amount) || 0));
    });
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }, [realExpenses]);

  if (expenses.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border text-center py-16">
        <BarChart2 className="w-8 h-8 mx-auto mb-3 opacity-25" />
        <p className="text-sm font-medium text-foreground mb-1">{t('expenses.stats.empty')}</p>
        <p className="text-xs text-muted-foreground">{t('expenses.addToSeeStats')}</p>
      </div>
    );
  }

  // Mismo aviso que ya tiene BalancesTab: si hay gastos con conversión a la
  // moneda base fallida, estos totales (mySpend, myByCategory, groupByCategory,
  // byCity — todos usan amount_base) pueden estar mezclando monedas sin
  // convertir, igual que el balance de la otra pestaña. Antes solo se avisaba
  // ahí, no aquí, aunque el riesgo es idéntico.
  const unavailableFxCount = expenses.filter(e => e.fx_source === 'unavailable').length;

  return (
    <div className="space-y-4">
      {unavailableFxCount > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('expenses.fx.pendingAggregate', { count: unavailableFxCount })}
          </p>
        </div>
      )}
      {/* {t('expenses.myExpense')} — PRIMERO */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('expenses.myExpense')}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">{t('expenses.stats.myTotal')}</p>
          <p className="text-xl font-medium text-foreground">{fmtAmt(mySpend, baseCurrency)} {s}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">{t('expenses.stats.perDay')}</p>
          <p className="text-xl font-medium text-foreground">{fmtAmt(myPerDay, baseCurrency)} {s}</p>
        </div>
      </div>

      {myByCategory.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-xs text-muted-foreground mb-3">{t('expenses.byCategory')}</p>
          <div className="space-y-3">
            {myByCategory.map(([cat, amt]) => {
              const tc = CAT_CONFIG[cat] || CAT_CONFIG.other;
              const pct = amt / maxCat * 100;
              return (
                <div key={cat} className="flex items-center gap-2.5">
                  {(() => { const I = CAT_ICONS[cat] || CAT_ICONS.other; const col = CAT_COLORS[cat] || CAT_COLORS.other; return <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${col}`}><I size={15} /></div>; })()}
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-foreground">{t(tc.label)}</span>
                      <span className="text-muted-foreground">{fmtAmt(amt, baseCurrency)} {s}</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--kodo-progress-track)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'hsl(var(--primary))', borderRadius: 4 }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grupo — curiosidad */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('expenses.stats.groupTotal')}</p>
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex justify-between items-center mb-3">
          <span className="text-xs text-muted-foreground">{t('expenses.stats.groupSum')}</span>
          <span className="text-sm font-medium text-foreground">{fmtAmt(totalGroup, baseCurrency)} {s}</span>
        </div>
        <div className="space-y-2.5">
          {groupByCategory.map(([cat, amt]) => {
            const tc = CAT_CONFIG[cat] || CAT_CONFIG.other;
            const pct = amt / totalGroup * 100;
            return (
              <div key={cat} className="flex items-center gap-2.5">
                {(() => { const I = CAT_ICONS[cat] || CAT_ICONS.other; const col = CAT_COLORS[cat] || CAT_COLORS.other; return <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${col}`}><I size={15} /></div>; })()}
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-foreground">{t(tc.label)}</span>
                    <span className="text-muted-foreground">{fmtAmt(amt, baseCurrency)} {s}</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--kodo-progress-track)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'hsl(var(--primary))', borderRadius: 4 }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {byCity.length > 1 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-xs text-muted-foreground mb-3">{t('expenses.stats.byCity')}</p>
          <div className="space-y-2">
            {byCity.map(([city, amt]) => (
              <div key={city} className="flex items-center justify-between py-1">
                <span className="text-sm text-foreground">{city}</span>
                <span className="text-sm font-medium text-foreground">{fmtAmt(amt, baseCurrency)} {s}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Expense detail sheet ──────────────────────────────────────────────────────
function ExpenseDetailSheet({ expense, baseCurrency, userMap, profilesByEmail, onClose, onEdit, onDelete }) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
    // Fix: los recibos se abrían con <a target="_blank"> a la URL cruda del
  // archivo (en nativo, eso deja al usuario mirando una URL pelada en vez de
  // la app) — reusa el mismo visor que ya usan Documentos/Ruta (PDFViewer,
  // que también sabe mostrar imágenes con zoom, descarga y cierre).
  const [viewReceipt, setViewReceipt] = useState(null);
  if (!expense) return null;
  const tc = CAT_CONFIG[expense.category] || CAT_CONFIG.other;
  const isSame = expense.currency === baseCurrency || !expense.currency;
  const s = sym(baseCurrency);

  return (
    <>
      <div className="fixed inset-0 flex items-end justify-center bg-black/40" onClick={onClose} style={{zIndex:70}}>
        <div className="bg-card w-full max-w-lg rounded-t-3xl" onClick={e => e.stopPropagation()}>
          <div className="w-9 h-1 bg-border rounded-full mx-auto mt-4 mb-4" />
          <div className="flex items-start justify-between px-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--kodo-bg-orange)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19 }}>
                {(() => { const I = CAT_ICONS[expense.category] || CAT_ICONS.other; return <I size={16} />; })()}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{expense.description}</p>
                <p className="text-xs text-muted-foreground">{t(tc.label)}{expense.date ? ' · ' + expense.date : ''}</p>
              </div>
            </div>
            <button onClick={onClose} aria-label={t('common.close')} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-3">
            {/* {t('common.amount')} */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{t('common.amount')}</span>
              <div className="text-right">
                {!isSame && <p className="text-sm font-medium text-foreground">{sym(expense.currency)}{fmtAmt(parseFloat(expense.amount || 0), expense.currency)}</p>}
                <p className={`${isSame ? 'text-base' : 'text-xs'} font-medium ${isSame ? 'text-foreground' : 'text-primary'}`}>
                  {s}{fmtAmt(parseFloat(expense.amount_base || expense.amount || 0), baseCurrency)}
                </p>
              </div>
            </div>
            {/* {t('expenses.paidBy')} */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{t('expenses.paidBy')}</span>
              <div className="flex items-center gap-2">
                <Avatar email={expense.paid_by} profiles={profilesByEmail} size={20} />
                <span className="text-sm text-foreground">{userMap[normalizeEmail(expense.paid_by)] || t('common.member')}</span>
              </div>
            </div>
            {/* {t('expenses.splitWith')} */}
            {expense.split_with?.length > 0 && (
              <div className="flex justify-between items-start">
                <span className="text-xs text-muted-foreground">{t('expenses.splitWith')}</span>
                <div className="flex gap-1.5">
                  {expense.split_with.map(email => (
                    <Avatar key={email} email={email} profiles={profilesByEmail} size={22} />
                  ))}
                </div>
              </div>
            )}
            {/* Fotos */}
            {expense.receipt_photos?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">{t('expenses.receipts')}</p>
                <div className="flex gap-2">
                  {expense.receipt_photos.map((url, i) => (
                    <button key={i} type="button" onClick={() => setViewReceipt(url)}>
                      <img src={url} alt="Recibo" className="w-16 h-16 rounded-lg object-cover border border-border" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="border-t border-border">
            <button onClick={() => setConfirmDelete(true)} className="w-full text-xs text-red-400 hover:text-red-600 py-2.5 text-center">
              {t('expenses.deleteExpense')}
            </button>
          </div>
          <div className="flex gap-3 px-5 pb-5 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-muted-foreground">{t('common.close')}</button>
            <button onClick={() => { onClose(); onEdit(expense); }}
              className="flex-1 py-2.5 bg-primary text-white rounded-full text-sm font-medium">
              {t('common.edit')}
            </button>
          </div>
        </div>
      </div>
      {confirmDelete && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50" onClick={() => setConfirmDelete(false)}>
          <div className="bg-card w-full max-w-lg rounded-t-3xl p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="w-9 h-1 bg-border rounded-full mx-auto mb-5" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <p className="text-sm font-medium text-foreground">{t('expenses.deleteConfirm')}</p>
            </div>
            <p className="text-xs text-muted-foreground mb-5 ml-11">{t('expenses.deletePermanent', { description: expense.description })}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(false)} className="flex-1 py-3 border border-border rounded-full text-sm text-muted-foreground">{t('common.cancel')}</button>
              <button onClick={() => { setConfirmDelete(false); onDelete(expense); }} className="flex-1 py-3 bg-primary text-white rounded-full text-sm font-medium">{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
      {viewReceipt && <PDFViewer fileUrl={viewReceipt} onClose={() => setViewReceipt(null)} />}
    </>
  );
}

// ── Expense add/edit sheet ────────────────────────────────────────────────────
function ExpenseSheet({ open, onClose, editingExpense, members, defaultCurrency, baseCurrency, availableCurrencies, userMap, onSave, saving, currentUserEmail, profilesByEmail, cities, defaultCityId, minDate, maxDate }) {
  const { t } = useTranslation();
  const [formValid, setFormValid] = useState(true);
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex items-end justify-center bg-black/40" onClick={onClose} style={{zIndex:70}}>
      <div className="bg-card w-full max-w-lg rounded-t-3xl flex flex-col" style={{maxHeight:"min(96vh, 700px)"}} onClick={e => e.stopPropagation()}>
        <div className="flex-shrink-0 px-5 pt-4 pb-4 border-b border-border">
          <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />
          <div className="flex items-center justify-between">
            <p className="text-base font-medium text-foreground">{editingExpense ? t('expenses.editExpense') : t('expenses.addExpense')}</p>
            <button onClick={onClose} aria-label={t('common.close')} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">
          <ExpenseForm
            members={members}
            initialData={editingExpense}
            defaultCurrency={defaultCurrency}
            baseCurrency={baseCurrency}
            availableCurrencies={availableCurrencies}
            onSave={(data) => { onSave(data); onClose(); }}
            onCancel={onClose}
            saving={saving}
            userMap={userMap}
            currentUserEmail={currentUserEmail}
            profilesByEmail={profilesByEmail}
            cities={cities}
            defaultCityId={defaultCityId}
            minDate={minDate}
            maxDate={maxDate}
            onValidityChange={setFormValid}
          />
        </div>
        {/* Buttons — outside scroll, always visible */}
        <div className="flex-shrink-0 flex gap-3 px-5 pt-4 pb-8 border-t border-border" style={{paddingBottom:"max(2rem, env(safe-area-inset-bottom, 2rem))"}}>
          <button onClick={onClose}
            className="flex-1 py-3 border border-border rounded-full text-sm text-muted-foreground hover:bg-secondary/50 transition-colors">
            {t('common.cancel')}
          </button>
          <button
            form="expense-form"
            onClick={() => document.getElementById('expense-form-submit')?.click()}
            disabled={saving || !formValid}
            className="py-3 bg-primary text-white rounded-full text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:pointer-events-none" style={{flex:2}}>
            {saving ? t('common.loading') : (editingExpense ? t('expenses.saveChanges') : t('expenses.saveExpense'))}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
// ── Tab: Conversión de divisa ─────────────────────────────────────────────────
function ConversionTab({ cities, baseCurrency, activeCity, homeCurrency = 'EUR' }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('1');
  const [fromCurrency, setFromCurrency] = useState(homeCurrency || baseCurrency);
  const [rates, setRates] = useState({});
  const [loadingRates, setLoadingRates] = useState(false);
  const [lastFetch, setLastFetch] = useState(null);

  // Collect ALL currencies from trip cities, always include baseCurrency
  const allCurrencies = useMemo(() => {
    const set = new Set();
    // Always include user's home currency first
    if (homeCurrency) set.add(homeCurrency);
    set.add(baseCurrency);
    cities.forEach(c => {
      const meta = getCountryMeta(c.country_code || c.country || '');
      if (meta?.currency) set.add(meta.currency);
    });
    // baseCurrency always included via initialisation above
    return Array.from(set);
  }, [cities, homeCurrency, baseCurrency]);

  const activeMeta = getCountryMeta(activeCity?.country_code || activeCity?.country || '');
  const activeCurrency = activeMeta?.currency;

  // Currencies to convert TO (everything except fromCurrency)
  const targetCurrencies = allCurrencies.filter(c => c !== fromCurrency);

  useEffect(() => {
    if (targetCurrencies.length === 0) return;
    setLoadingRates(true);
    Promise.all(targetCurrencies.map(to => getFxRate(fromCurrency, to).then(r => [to, r.rate])))
      .then(pairs => {
        const obj = {};
        pairs.forEach(([k, v]) => { obj[k] = v; });
        setRates(obj);
        setLastFetch(new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }));
      })
      .catch(() => {})
      .finally(() => setLoadingRates(false));
  }, [fromCurrency, targetCurrencies.join(',')]);

  // Reset fromCurrency if baseCurrency changes
  useEffect(() => { setFromCurrency(homeCurrency || baseCurrency); }, [homeCurrency, baseCurrency]);

  const numeric = parseFloat(amount) || 0;

  return (
    <div className="space-y-3">
      {/* Amount + from currency */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <p className="text-xs text-muted-foreground mb-2">{t('expenses.convertFrom')}</p>
        <div className="flex items-center gap-2">
          <select
            value={fromCurrency}
            onChange={e => { setFromCurrency(e.target.value); setRates({}); }}
            className="h-12 border border-border rounded-xl px-3 text-sm font-medium text-foreground outline-none focus:border-primary bg-secondary appearance-none"
          >
            {allCurrencies.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className="flex-1 flex items-center h-12 border border-border rounded-xl px-3 focus-within:border-primary transition-colors">
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="flex-1 text-lg font-semibold text-foreground outline-none bg-transparent"
              placeholder="0"
              min="0"
            />
          </div>
        </div>
        {lastFetch && (
          <p className="text-xs text-muted-foreground mt-2">{t('expenses.fx.updatedAt', { time: lastFetch })}</p>
        )}
      </div>

      {/* Results */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {loadingRates ? (
          <div className="py-8 text-center">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          targetCurrencies.map((currency, i) => {
            const rate = rates[currency];
            const converted = rate ? (numeric * rate).toFixed(2) : '—';
            const isActive = currency === activeCurrency;
            return (
              <div key={currency}
                className={`flex items-center justify-between px-4 py-3.5 ${i > 0 ? 'border-t border-border' : ''} ${isActive ? 'bg-orange-50/40 dark:bg-orange-950/20' : ''}`}>
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium text-muted-foreground">{getCountryMeta(currency)?.flag || currency}</span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{currency}</p>
                    {isActive && <p className="text-xs text-primary font-medium">{t('expenses.currentCity')}</p>}
                    {rate && <p className="text-xs text-muted-foreground">1 {fromCurrency} = {rate.toFixed(4)} {currency}</p>}
                  </div>
                </div>
                <p className="text-lg font-semibold text-foreground">{converted}</p>
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center px-4">
        {t('expenses.fx.source')}
      </p>
    </div>
  );
}


export default function Expenses() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const urlParams = new URLSearchParams(window.location.search);
  const tripId = urlParams.get('trip_id');

  useEffect(() => {
    if (!tripId || tripId === 'null') {
      navigate(createPageUrl('TripsList'), { replace: true });
    }
  }, [tripId, navigate]);
  const { user: currentUser } = useAuth();
  // normalizeEmail() aquí — a diferencia de Home.jsx/Cities.jsx, este email
  // se usa además como fallback al escribir trip_members (ver createMutation
  // más abajo), que es justo el campo que las reglas RLS de base44 usan para
  // decidir quién puede releer el gasto. Sin normalizar, un email con
  // capitalización distinta podía dejar al propio creador sin acceso.
  const currentUserEmail = normalizeEmail(currentUser?.email) ?? '';
  const queryClient = useQueryClient();

  const [tab, setTab] = useState('gastos');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [detailExpense, setDetailExpense] = useState(null);
  // ── localStorage helpers para banner y override de moneda ──────────────────
  const bannerKey    = (cityId) => `kodo_currency_banner_${tripId}_${cityId}`;
  const overrideKey  = (cityId) => `kodo_currency_override_${tripId}_${cityId}`;

  const isBannerDismissed = (cityId) => {
    try { return !!localStorage.getItem(bannerKey(cityId)); } catch { return false; }
  };
  const dismissBanner = (cityId) => {
    try { localStorage.setItem(bannerKey(cityId), '1'); } catch {}
  };
  const getStoredOverride = (cityId) => {
    try { return localStorage.getItem(overrideKey(cityId)) || null; } catch { return null; }
  };
  const setStoredOverride = (cityId, currency) => {
    try { localStorage.setItem(overrideKey(cityId), currency); } catch {}
  };

  const [currencyBannerDismissed, setCurrencyBannerDismissed] = useState(false);
  const [activeCurrencyOverride, setActiveCurrencyOverride] = useState(null);
  const [prevCityId, setPrevCityId] = useState(null);

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => base44.entities.Trip.get(tripId),
    enabled: !!tripId, staleTime: 60000,
  });

  const { cities, activeCity } = useTripContext(tripId);

  // Fetch user profile to get home currency as fallback.
  // Clave unificada a ['myProfile', id] — antes esta pantalla usaba una clave
  // propia ('myProfile_exp') que compartía el mismo dato pero nunca se
  // invalidaba cuando Settings.jsx cambiaba la moneda de referencia (que
  // invalida ['myProfile', id]). Resultado: Gastos podía seguir mostrando la
  // moneda anterior varios minutos tras cambiarla en Ajustes.
  const { data: myProfile_ } = useQuery({
    queryKey: ['myProfile', currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.id) return null;
      const r = await base44.entities.UserProfile.filter({ user_id: currentUser.id });
      return r[0] || null;
    },
    enabled: !!currentUser?.id,
    staleTime: 5 * 60 * 1000,
  });

  // baseCurrency: trip field > user home currency > EUR
  const baseCurrency = trip?.base_currency || trip?.currency ||
    myProfile_?.home_currency || 'EUR';
  const activeMeta = getCountryMeta(activeCity?.country_code || activeCity?.country || '');
  const activeLocalCurrency = activeMeta?.currency;
  const availableCurrencies = computeAvailableCurrencies(cities, baseCurrency);
  const members = trip?.members || [];

  // Show banner only when trip is actually in progress
  const tripStarted   = trip?.start_date ? new Date() >= new Date(trip.start_date + 'T00:00:00') : false;
  const tripEnded     = trip?.end_date   ? new Date() >  new Date(trip.end_date   + 'T23:59:59') : false;
  const tripInProgress = tripStarted && !tripEnded;

  // `activeCity?.id === prevCityId` espera a que el efecto de abajo haya
  // sincronizado currencyBannerDismissed con lo guardado en localStorage
  // para ESTA ciudad. Sin esto, cada vez que se remonta la página (volver
  // a Gastos, recargar, etc.) con la caché de React Query ya poblada,
  // currencyBannerDismissed arrancaba en `false` por un instante — el
  // banner ya confirmado "parpadeaba" visible antes de que el efecto lo
  // corrigiera, y el usuario lo veía reaparecer una y otra vez aunque lo
  // hubiera confirmado.
  const showCurrencyBanner = !currencyBannerDismissed &&
    activeCity?.id === prevCityId &&
    tripInProgress &&
    activeLocalCurrency && activeLocalCurrency !== baseCurrency;

  // When city changes, load stored override + banner state for that city
  useEffect(() => {
    if (activeCity?.id && activeCity.id !== prevCityId) {
      setPrevCityId(activeCity.id);
      setCurrencyBannerDismissed(isBannerDismissed(activeCity.id));
      const stored = getStoredOverride(activeCity.id);
      setActiveCurrencyOverride(stored);
    }
  }, [activeCity?.id]);

  const defaultCurrency = activeCurrencyOverride || activeLocalCurrency || baseCurrency;

  // Perfiles de miembros: email→user_id→UserProfile. Se normaliza el email
  // antes de consultar y al indexar los resultados — UserProfile.email
  // siempre se guarda en minúsculas (migración en App.jsx), pero
  // trip.members puede traer el email tal cual vino del proveedor de auth.
  // Sin normalizar, el propio creador del viaje (o cualquier miembro con
  // mayúsculas distintas) nunca hacía match y su nombre se sustituía por el
  // email en crudo en toda esta pantalla.
  const normalizedMembers = useMemo(() => [...new Set(members.map(normalizeEmail))], [members]);
  const { data: memberProfiles = [] } = useQuery({
    queryKey: ['memberProfiles', normalizedMembers.join(',')],
    queryFn: async () => {
      if (!normalizedMembers.length) return [];
      // Antes: base44.entities.User.filter({email:{$in:...}}) para sacar el
      // user_id antes de poder pedir el perfil — esa llamada da SIEMPRE 403
      // para cualquier usuario no colaborador del proyecto en Base44 ("Only
      // collaborators can view the list of users"), así que esta query
      // fallaba en silencio y todos los nombres de esta pantalla (gastos,
      // balances, quién debe a quién) caían al email en crudo — mismo
      // hallazgo que en notifications.js, Home.jsx y Documents.jsx.
      // searchUserProfiles ya acepta emails directamente.
      return searchUserProfiles({ emails: normalizedMembers });
    },
    enabled: normalizedMembers.length > 0,
    staleTime: 120000,
  });

  // Indexado por email normalizado (minúsculas) — igual que balances/debts
  // (ver expenseBalances.js) y profilesByEmail, así toda lectura del gasto
  // usa la misma clave sin importar con qué mayúsculas se guardó el email
  // original en trip.members/paid_by/split_with.
  const userMap = useMemo(() => {
    const m = {};
    members.forEach(email => {
      const e = normalizeEmail(email);
      if (!e) return;
      const prof = memberProfiles.find(p => normalizeEmail(p.email) === e || p.user_email === e);
      // Nunca el email en crudo: display_name/username son obligatorios en
      // UserProfile, así que si no aparecen es que no se encontró el
      // perfil — se deja sin entrada y cada sitio que lee userMap decide su
      // propio texto de reserva (t('common.member')).
      if (prof?.display_name || prof?.username) m[e] = prof.display_name || prof.username;
    });
    return m;
  }, [memberProfiles, members]);

  const profilesByEmail = useMemo(() => {
    const map = {};
    memberProfiles.forEach(p => {
      const email = normalizeEmail(p.email || p.user_email);
      if (email) map[email] = p;
    });
    return map;
  }, [memberProfiles]);

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', tripId],
    queryFn: () => base44.entities.Expense.filter({ trip_id: tripId }, '-date'),
    enabled: !!tripId, staleTime: 30000,
  });

  // trip_members determina quién puede volver a leer este gasto (rls de
  // Expense). Antes, si el usuario creaba un gasto justo cuando `trip`
  // todavía no había cargado (conexión lenta/intermitente — muy real en
  // gente viajando), se guardaba con trip_members: [currentUserEmail] —
  // el gasto quedaba invisible para el RESTO del grupo (falla su propia
  // rls), así que sus balances lo omitían mientras el creador sí lo veía
  // en el suyo: cifras que no cuadran entre miembros, sin ningún aviso.
  // Documents.jsx/Utilities.jsx ya cortan este mismo caso bloqueando la
  // creación en vez de degradar la visibilidad en silencio — aquí se aplica
  // el mismo guard, consistente con el resto de la app.
  const createMutation = useMutation({
    mutationFn: d => {
      if (!trip?.members?.length) throw new Error(t('cities.tripNotLoadedRetry'));
      return base44.entities.Expense.create({ ...d, trip_id: tripId, amount: parseFloat(d.amount), trip_members: trip.members, trip_editors: computeEditors(trip.members, trip) });
    },
    onError: (error) => toast({ title: t('expenses.saveError'), description: error?.message || t('common.tryAgain'), variant: 'destructive' }),
    onSuccess: async (_, d) => {
      queryClient.invalidateQueries({ queryKey: ['expenses', tripId] });
      setSheetOpen(false); setEditingExpense(null);
      // Las liquidaciones notifican solo al acreedor (en handleSettle), no a todo el grupo
      const isSettlement = d?.is_settlement === true || (d?.description || '').startsWith('Liquidación:');
      if (isSettlement) return;
      const others = (trip?.members || []).filter(e => normalizeEmail(e) !== normalizeEmail(currentUser?.email));
      if (others.length > 0) {
        resolveUserIds(others).then(resolved => {
          resolved.forEach(({ userId }) => notify({
            userId,
            type: 'expense_added',
            actor: myProfile_,
            tripId,
            tripName: trip?.name,
            refTitle: d.description || 'gasto',
          }));
        });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, d }) => base44.entities.Expense.update(id, { ...d, amount: parseFloat(d.amount) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expenses', tripId] }); setSheetOpen(false); setEditingExpense(null); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    onError: () => toast({ title: t('expenses.updateError'), variant: 'destructive' }),
  });

  const [pendingDeleteClose, setPendingDeleteClose] = useState(null);

  const deleteMutation = useMutation({
    mutationFn: id => base44.entities.Expense.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', tripId] });
      setDetailExpense(null); // close sheet after confirmed delete
    },
    onError: () => toast({ title: t('expenses.deleteError'), variant: 'destructive' }),
  });

  const handleSave = d => {
    if (editingExpense) updateMutation.mutate({ id: editingExpense.id, d });
    else createMutation.mutate(d);
  };

  const handleDelete = (expense) => {
    if (deleteMutation.isPending) return;
    deleteMutation.mutate(expense.id);
  };

  const openAdd = () => { setEditingExpense(null); setSheetOpen(true); };
  const openEdit = e => { setEditingExpense(e); setSheetOpen(true); };

  const handleSettle = async (debt) => {
    const settleCurrency = debt.displayCurrency || baseCurrency;
    const settleAmount   = debt.displayAmount   || debt.amount;
    try {
      await createMutation.mutateAsync({
        description: `Liquidación: ${userMap[debt.from] || t('common.member')} → ${userMap[debt.to] || t('common.member')}`,
        amount: settleAmount, currency: settleCurrency, amount_base: debt.amount,
        category: 'other', paid_by: debt.from, split_with: [debt.to],
        split_type: 'equal', date: format(new Date(), 'yyyy-MM-dd'),
        is_settlement: true,
      });
      // Notificar a quien le deben que le han liquidado
      try {
        const resolved = await resolveUserIds([debt.to]);
        const allProfiles = memberProfiles;
        const myProf = allProfiles.find(p => p.user_id === currentUser?.id);
        resolved.forEach(({ userId }) => notify({
          userId,
          type: 'expense_settled',
          actor: myProf,
          tripId,
          tripName: trip?.name,
          refExtra: { amount: debt.amount, currency: baseCurrency },
        }));
      } catch {}
      // catch de la notificación (arriba): best-effort, igual que el resto
      // de notify() en la app — no debe bloquear ni avisar si falla solo eso.
    } catch {
      // catch de la liquidación en sí (createMutation, arriba): esto SÍ hay
      // que avisarlo. Antes se tragaba en silencio — handleSettleClick
      // liberaba el botón igualmente y la deuda se quedaba sin saldar sin
      // ninguna explicación visible.
      toast({ title: t('common.error'), description: t('common.tryAgain'), variant: 'destructive' });
    }
  };

  return (
    <div className="bg-background min-h-screen">
      {/* ── Header — same pattern as Restaurants/Translator/Documents ── */}
      <div className="bg-background sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-0">
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('Home') + '?trip_id=' + tripId}>
              <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                {t('utilities.backHome')}
              </button>
            </Link>
            <button onClick={openAdd} className="flex items-center gap-1.5 text-primary text-sm font-medium hover:text-primary/80 transition-colors">
              <Plus className="w-4 h-4" />{t('expenses.addShort')}
            </button>
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-4">{t('expenses.title')}</h1>
          <OTabBar
            tabs={[{key:'gastos',label:t('expenses.tabs.expenses')},{key:'balances',label:t('expenses.tabs.balances')},...(availableCurrencies.length > 1 ? [{key:'conversión',label:t('expenses.tabs.conversion')}] : []),{key:'stats',label:t('expenses.tabs.stats')}]}
            activeKey={tab}
            onChange={setTab}
          />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-5 pb-24 space-y-4">
        {/* Currency banner */}
        {showCurrencyBanner && (tab === 'gastos') && (
          <CurrencyBanner
            countryName={activeCity?.country || activeCity?.name || ''}
            currencyCode={activeLocalCurrency}
            flag={activeMeta?.flag || '🌍'}
            onAccept={() => {
              setActiveCurrencyOverride(activeLocalCurrency);
              setStoredOverride(activeCity?.id, activeLocalCurrency);
              setCurrencyBannerDismissed(true);
              dismissBanner(activeCity?.id);
            }}
            onDismiss={() => {
              setCurrencyBannerDismissed(true);
              dismissBanner(activeCity?.id);
            }}
          />
        )}

        {tab === 'gastos' && (
          <GastosTab
            expenses={expenses}
            baseCurrency={baseCurrency}
            userMap={userMap}
            onEdit={e => setDetailExpense(e)}
            onDelete={handleDelete}
            onAdd={openAdd}
            currentUserEmail={currentUser?.email}
          />
        )}

        {tab === 'balances' && (
          <BalancesTab
            expenses={expenses}
            members={members}
            currentUserEmail={currentUser?.email}
            userMap={userMap}
            baseCurrency={baseCurrency}
            profilesByEmail={profilesByEmail}
            onSettle={handleSettle}
          />
        )}

        {tab === 'stats' && (
          <StatsTab
            expenses={expenses}
            baseCurrency={baseCurrency}
            currentUserEmail={currentUser?.email}
            cities={cities}
            trip={trip}
          />
        )}

        {tab === 'conversión' && (
          <ConversionTab
            cities={cities}
            baseCurrency={baseCurrency}
            activeCity={activeCity}
            homeCountry={myProfile_?.home_country}
            homeCurrency={myProfile_?.home_currency || 'EUR'}
          />
        )}
      </div>

      {/* Detail sheet */}
      {detailExpense && (
        <ExpenseDetailSheet
          expense={detailExpense}
          baseCurrency={baseCurrency}
          userMap={userMap}
          profilesByEmail={profilesByEmail}
          onClose={() => setDetailExpense(null)}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      )}

      {/* Add/edit sheet */}
      <ExpenseSheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); setEditingExpense(null); }}
        editingExpense={editingExpense}
        members={members}
        defaultCurrency={defaultCurrency}
        baseCurrency={baseCurrency}
        availableCurrencies={availableCurrencies}
        userMap={userMap}
        onSave={handleSave}
        saving={createMutation.isPending || updateMutation.isPending}
        currentUserEmail={currentUserEmail}
        profilesByEmail={profilesByEmail}
        cities={cities}
        defaultCityId={activeCity?.id}
        minDate={trip?.start_date || undefined}
        maxDate={trip?.end_date || undefined}
      />
    </div>
  );
}