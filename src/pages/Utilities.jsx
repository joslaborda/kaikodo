import { useState, useEffect, useRef} from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Plus, Minus, Trash2, ExternalLink, Loader2, AlertTriangle, Landmark, MapPin, Phone, Mail, Clock, User, Shirt, Droplets, Smartphone, Pill, MoreHorizontal, Building2, Check, ArrowRight } from 'lucide-react';
import WeatherCard from '@/components/WeatherCard';
import { getCountryMeta, getCountryLabel, getCountryIso, normalizeCountry } from '@/lib/countryConfig';
import { ShieldCheck, ShieldX, ShieldAlert, Zap, Syringe, Coins, Info, ChevronDown, ChevronUp, Shield, Cross, Flame } from 'lucide-react';
import { useSearchParams, Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import OTabBar from '@/components/trip/OTabBar';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const PACKING_CATEGORIES = [
  { value:'personal',   tk:'utilities.packing.cat.personal',   Icon: User },
  { value:'ropa',       tk:'utilities.packing.cat.ropa',       Icon: Shirt },
  { value:'neceser',    tk:'utilities.packing.cat.neceser',    Icon: Droplets },
  { value:'tecnologia', tk:'utilities.packing.cat.tecnologia', Icon: Smartphone },
  { value:'medicinas',  tk:'utilities.packing.cat.medicinas',  Icon: Pill },
  { value:'otros',      tk:'utilities.packing.cat.otros',      Icon: MoreHorizontal },
];

// Stepper de cantidad — comparte estilo con el resto de botones redondos
// pequeños (essential toggle, etc). min 1: no tiene sentido un artículo con
// 0 unidades (para "no lo llevo", ya está borrar).
function QuantityStepper({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(Math.max(1, (value || 1) - 1))}
        className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-30"
        disabled={(value || 1) <= 1} aria-label={t('utilities.packing.quantityDecrease')}>
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="text-sm font-medium text-foreground w-6 text-center">{value || 1}</span>
      <button type="button" onClick={() => onChange((value || 1) + 1)}
        className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
        aria-label={t('utilities.packing.quantityIncrease')}>
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add packing item sheet
// ─────────────────────────────────────────────────────────────────────────────
function AddPackingSheet({ open, onClose, defaultCategory = 'personal', onSave, saving }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState(defaultCategory);
  const [essential, setEssential] = useState(false);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (open) { setName(''); setCategory(defaultCategory); setEssential(false); setQuantity(1); }
  }, [open, defaultCategory]);

  const handleSave = () => {
    // Igual que en commitAdd: el atajo de Enter y un doble-click rápido
    // pueden disparar dos llamadas a handleSave antes de que React vuelva
    // a renderizar el botón con disabled=true (la prop `saving` tarda un
    // ciclo en propagarse), creando un artículo duplicado. Guardamos aquí
    // también, no solo en el `disabled` del botón.
    if (saving) return;
    if (!name.trim()) return;
    onSave({ name: name.trim(), category, essential, quantity, packed: false });
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card w-full max-w-lg rounded-t-3xl p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="w-9 h-1 bg-border rounded-full mx-auto" />
        <p className="text-sm font-medium text-foreground">{t('utilities.packing.newItem')}</p>
        <input autoFocus aria-label={t('utilities.packing.itemNameAria')} placeholder={t('utilities.packing.itemNamePlaceholder')} value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          className="w-full px-4 py-3 rounded-2xl border border-border bg-secondary text-sm text-foreground placeholder:text-muted-foreground outline-none" />
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{t('utilities.packing.quantity')}</p>
          <QuantityStepper value={quantity} onChange={setQuantity} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">{t('utilities.packing.category')}</p>
          <div className="grid grid-cols-2 gap-2">
            {PACKING_CATEGORIES.map(cat => (
              <button key={cat.value} onClick={() => setCategory(cat.value)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors ${category === cat.value ? 'border-primary bg-orange-50' : 'border-border'}`}>
                <cat.Icon size={14} color={category === cat.value ? 'hsl(var(--primary))' : '#888'} />
                <span className={`text-xs font-medium ${category === cat.value ? 'text-primary' : 'text-muted-foreground'}`}>{t(cat.tk)}</span>
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setEssential(v => !v)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${essential ? 'border-primary bg-orange-50' : 'border-border'}`}>
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${essential ? 'border-primary bg-primary' : 'border-border'}`}>
            {essential && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
          </div>
          <span className={`text-sm ${essential ? 'text-primary font-medium' : 'text-muted-foreground'}`}>{t('utilities.packing.markEssential')}</span>
        </button>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-full border border-border text-sm text-muted-foreground">{t('common.cancel')}</button>
          <button onClick={handleSave} disabled={!name.trim() || saving}
            className="flex-[2] py-3 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-40">
            {saving ? t('utilities.packing.adding') : t('utilities.packing.add')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit packing item sheet — nuevo (5 sept 2026): antes no había forma de
// editar un artículo ya creado (ni el nombre, ni la cantidad, ni pasarlo de
// esencial a normal para poder borrarlo) salvo borrarlo y crearlo de cero.
// Se abre pinchando la fila del artículo (ver PackingTab).
// ─────────────────────────────────────────────────────────────────────────────
function EditPackingItemSheet({ item, onClose, onSave, onDelete, saving, deleting }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('personal');
  const [essential, setEssential] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (item) {
      setName(item.name || '');
      setCategory(item.category || 'personal');
      setEssential(!!item.essential);
      setQuantity(item.quantity || 1);
      setConfirmingDelete(false);
    }
  }, [item]);

  if (!item) return null;
  const isSouvenir = item.category === 'souvenir';

  const handleSave = () => {
    if (saving) return;
    if (!name.trim()) return;
    onSave(item.id, { name: name.trim(), category, essential, quantity });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card w-full max-w-lg rounded-t-3xl p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="w-9 h-1 bg-border rounded-full mx-auto" />
        <p className="text-sm font-medium text-foreground">{t('utilities.packing.editItem')}</p>
        <input autoFocus aria-label={t('utilities.packing.itemNameAria')} value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          className="w-full px-4 py-3 rounded-2xl border border-border bg-secondary text-sm text-foreground placeholder:text-muted-foreground outline-none" />
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{t('utilities.packing.quantity')}</p>
          <QuantityStepper value={quantity} onChange={setQuantity} />
        </div>
        {!isSouvenir && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">{t('utilities.packing.category')}</p>
            <div className="grid grid-cols-2 gap-2">
              {PACKING_CATEGORIES.map(cat => (
                <button key={cat.value} onClick={() => setCategory(cat.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors ${category === cat.value ? 'border-primary bg-orange-50' : 'border-border'}`}>
                  <cat.Icon size={14} color={category === cat.value ? 'hsl(var(--primary))' : '#888'} />
                  <span className={`text-xs font-medium ${category === cat.value ? 'text-primary' : 'text-muted-foreground'}`}>{t(cat.tk)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!isSouvenir && (
          <button onClick={() => setEssential(v => !v)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${essential ? 'border-primary bg-orange-50' : 'border-border'}`}>
            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${essential ? 'border-primary bg-primary' : 'border-border'}`}>
              {essential && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
            <span className={`text-sm ${essential ? 'text-primary font-medium' : 'text-muted-foreground'}`}>{t('utilities.packing.markEssential')}</span>
          </button>
        )}

        {confirmingDelete ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-3 space-y-2">
            <p className="text-xs text-red-800">{t('utilities.packing.confirmDelete', { name: item.name })}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingDelete(false)} className="flex-1 py-2 rounded-full border border-border text-xs text-muted-foreground">{t('common.cancel')}</button>
              <button onClick={() => onDelete(item.id)} disabled={deleting}
                className="flex-1 py-2 rounded-full bg-red-600 text-white text-xs font-medium disabled:opacity-50">
                {t('common.delete')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={() => setConfirmingDelete(true)}
              className="w-11 h-11 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors flex-shrink-0">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="flex-1 py-3 rounded-full border border-border text-sm text-muted-foreground">{t('common.cancel')}</button>
            <button onClick={handleSave} disabled={!name.trim() || saving}
              className="flex-[2] py-3 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-40">
              {saving ? t('utilities.packing.saving') : t('common.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Requirements tab — Visa, Enchufes, Vacunas, Moneda
// ─────────────────────────────────────────────────────────────────────────────
const PLUG_IMAGES = {
  'A': 'Tipo A — 2 clavijas planas paralelas (EEUU/México/Japón)',
  'B': 'Tipo B — 2 clavijas planas + redonda (EEUU)',
  'C': 'Tipo C — 2 clavijas redondas (Europa/Sudamérica)',
  'D': 'Tipo D — 3 clavijas redondas en triángulo (India)',
  'E': 'Tipo E — 2 clavijas redondas + agujero (Francia/Bélgica)',
  'F': 'Tipo F — 2 clavijas redondas con toma tierra (Alemania/Europa)',
  'G': 'Tipo G — 3 clavijas rectangulares (UK/Singapur/HK)',
  'H': 'Tipo H — 3 clavijas oblicuas (Israel)',
  'I': 'Tipo I — 2/3 clavijas planas en ángulo (Australia/Argentina)',
  'J': 'Tipo J — 3 clavijas redondas (Suiza)',
  'K': 'Tipo K — 2 redondas + tierra (Dinamarca)',
  'L': 'Tipo L — 3 clavijas redondas en línea (Italia)',
  'M': 'Tipo M — 3 clavijas redondas grandes (Sudáfrica)',
  'N': 'Tipo N — 2/3 clavijas redondas (Brasil)',
};

function PlugIcon({ type }) {
  const colors = { A:'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400', B:'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400', C:'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400', F:'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400', E:'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400', G:'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400', I:'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400', default:'bg-secondary text-muted-foreground' };
  const cls = colors[type] || colors.default;
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${cls} text-xs font-semibold`}>
      <Zap size={11} />
      {type}
    </div>
  );
}

function RequirementsTab({ reqs, country, homeCountry, meta, skipVaccines = [], profileLoading = false }) {
  const { t, i18n } = useTranslation();
  const [showAllVaccines, setShowAllVaccines] = useState(false);

  if (!country) return (
    <div className="bg-card rounded-2xl border border-border text-center py-12 px-6">
      <Info className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{t('utilities.noDestination')}</p>
    </div>
  );

  // Mientras se carga el perfil no se sabe todavía si hay nacionalidad — no
  // mostrar nada basado en un país de referencia que aún no se conoce.
  if (profileLoading) return (
    <div className="bg-card rounded-2xl border border-border text-center py-12 px-6">
      <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground/50" />
    </div>
  );

  // El registro exige nacionalidad, así que llegar aquí sin homeCountry es
  // un caso raro (perfil legacy o dato borrado) — mejor pedir completarlo
  // que mostrar requisitos de un país que nadie ha elegido.
  if (!homeCountry) return (
    <div className="bg-card rounded-2xl border border-border text-center py-12 px-6">
      <Info className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground mb-1">{t('utilities.reqs.needHomeCountry')}</p>
      <Link to={createPageUrl('Settings')} className="inline-block mt-3 text-xs text-primary font-medium underline">
        {t('utilities.reqs.completeProfileCta')}
      </Link>
    </div>
  );

  if (!reqs) return (
    <div className="bg-card rounded-2xl border border-border text-center py-12 px-6">
      <Info className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground mb-1">{t('utilities.noDataFor', { country: getCountryLabel(country, i18n.language) })}</p>
      <p className="text-xs text-muted-foreground">{t('utilities.reqs.checkConsulate')}</p>
    </div>
  );

  const visa = reqs.visa || {};
  const adapter = reqs.adapter || {};
  const vaccines = reqs.vaccines || [];
  const currency = reqs.currency || {};
  const tips = reqs.tips || [];

  // Determinar estado del visado usando nuevo campo type/label
  const visaNeeded = visa.needed;
  const visaType = visa.type;
  const visaLabel = visa.label || (visaNeeded === false ? t('pretrip.visaFree') : visaNeeded === true ? t('pretrip.visaRequired') : t('utilities.reqs.verifyConsulate'));

  let visaColor, visaIcon;
  if (visaNeeded === false) {
    visaColor = 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900/40'; visaIcon = <ShieldCheck className="w-5 h-5 text-green-600" />;
  } else if (visaType === 'evisa' || visaType === 'voa' || visaType === 'eta' || visaType === 'esta' || visaType === 'nzeta') {
    visaColor = 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40'; visaIcon = <ShieldAlert className="w-5 h-5 text-amber-500" />;
  } else {
    visaColor = 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40'; visaIcon = <ShieldX className="w-5 h-5 text-red-500" />;
  }

  // Filtrar COVID-19 (no es requisito de viaje) y vacunas de rutina pediátrica
  // Filtrar vacunas rutinarias (todos las tenemos de niños) — solo mostrar las específicas de viaje
  const filteredVaccines = vaccines.filter(v => !skipVaccines.includes(v.name));
  const requiredVax = filteredVaccines.filter(v => v.priority?.includes('obligatori'));
  // Limpiar labels: quitar "(check age and history)" y "(seasonal and risk based)" del texto visible
  const cleanPriority = (p) => p
    ?.replace(/\s*\(check age and history\)/gi, '')
    ?.replace(/\s*\(seasonal and risk based\)/gi, ' (estacional)')
    ?.replace(/\s*\(quimioprofilaxis\)/gi, '')
    ?.trim() || '';
  const recommendedVax = filteredVaccines.filter(v => !requiredVax.includes(v));

  // Detectar si el adaptador español es compatible
  // Usar meta.plug como fuente si adapter.type no está disponible
  const plugTypeRaw = adapter.type || (meta?.plug ? meta.plug.split('/').map(p => `Tipo ${p}`).join(' · ') : '');
  const spanishPlugs = ['C', 'E', 'F'];
  const destPlugs = plugTypeRaw.match(/Tipo ([A-N])/g)?.map(item => item.replace('Tipo ', '')) || [];
  const needsAdapter = adapter.needed ?? (destPlugs.length > 0 && !destPlugs.every(p => spanishPlugs.includes(p)));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('utilities.reqs.intro1')} <span className="font-medium text-foreground">{getCountryLabel(country, i18n.language)}</span> {t('utilities.reqs.intro2')} <span className="font-medium text-foreground">{getCountryLabel(homeCountry, i18n.language)}</span></p>

      {/* Visado */}
      <div className={`bg-card rounded-2xl border p-4 ${visaColor}`}>
        <div className="flex items-center gap-3">
          {visaIcon}
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">{visaLabel}</p>
            {visa.info && <p className="text-xs text-muted-foreground mt-0.5">{visa.info}</p>}
            {visaType && visaType !== 'esta' && visaType !== 'nzeta' && (
              <p className="text-xs font-medium text-amber-700 mt-1">
                {visaType === 'evisa' && t('utilities.reqs.visa.evisa')}
                {visaType === 'voa' && t('utilities.reqs.visa.voa')}
                {visaType === 'eta' && t('utilities.reqs.visa.eta')}
              </p>
            )}
            {visaType === 'esta' && <p className="text-xs font-medium text-amber-700 mt-1">{t('utilities.reqs.visa.esta')}</p>}
            {visaType === 'nzeta' && <p className="text-xs font-medium text-amber-700 mt-1">{t('utilities.reqs.visa.nzeta')}</p>}
          </div>
        </div>
      </div>

      {/* Enchufe */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-muted-foreground" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('utilities.reqs.plugTitle')}</p>
        </div>
        {needsAdapter ? (
          <>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {destPlugs.length > 0 ? destPlugs.map(p => <PlugIcon key={p} type={p} />) : <span className="text-sm text-foreground">{adapter.type || t('utilities.reqs.variousTypes')}</span>}
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium border border-red-100">{t('utilities.reqs.adapterNeeded')}</span>
            </div>
            <p className="text-xs text-muted-foreground">{adapter.info}</p>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium border border-green-100">{t('utilities.reqs.compatible')}</span>
            <p className="text-xs text-muted-foreground">{adapter.info || t('utilities.reqs.noAdapter')}</p>
          </div>
        )}
      </div>

      {/* Vacunas */}
      {vaccines.length > 0 && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Syringe className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('utilities.vaccines')}</p>
          </div>
          {requiredVax.length > 0 && (
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs font-medium text-red-600 mb-2">{t('utilities.reqs.vaxRequired')}</p>
              {requiredVax.map((v, i) => (
                <div key={i} className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-foreground">{v.name}</span>
                </div>
              ))}
            </div>
          )}
          {recommendedVax.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-xs font-medium text-amber-600 mb-2">{t('utilities.reqs.vaxRecommended')}</p>
              {(showAllVaccines ? recommendedVax : recommendedVax.slice(0, 3)).map((v, i) => (
                <div key={i} className="flex items-start gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mt-1.5" />
                  <div>
                    <span className="text-sm text-foreground">{v.name}</span>
                    {cleanPriority(v.priority) && cleanPriority(v.priority) !== 'recomendada' && <span className="text-xs text-muted-foreground ml-1">({cleanPriority(v.priority)})</span>}
                  </div>
                </div>
              ))}
              {recommendedVax.length > 3 && (
                <button onClick={() => setShowAllVaccines(v => !v)} className="text-xs text-primary font-medium flex items-center gap-1 mt-1">
                  {showAllVaccines ? <><ChevronUp size={12} /> {t('utilities.reqs.seeLess')}</> : <><ChevronDown size={12} /> {t('utilities.reqs.seeMore', { count: recommendedVax.length - 3 })}</>}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {vaccines.length === 0 && (
        <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
          <Syringe className="w-4 h-4 text-green-600" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('utilities.reqs.noVaxTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('utilities.reqs.noVaxHint', { country: getCountryLabel(country, i18n.language) })}</p>
          </div>
        </div>
      )}

      {/* Moneda */}
      {currency.info && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('utilities.reqs.currency')}</p>
          </div>
          <p className="text-sm text-foreground">{currency.info}</p>
        </div>
      )}

      {/* Tips */}
      {tips.length > 0 && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Info className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('utilities.reqs.tips')}</p>
          </div>
          <div className="px-4 py-3 space-y-2">
            {tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                <p className="text-sm text-foreground">{tip}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Packing tab
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Shared checkbox — cuadrado, borde naranja pendiente, relleno naranja + check al marcar
// ─────────────────────────────────────────────────────────────────────────────
// El botón visual se mantiene en 20x20 (mismo diseño), pero el área
// realmente clicable ahora es 32x32 — antes coincidían y en móvil era fácil
// fallar el toque por unos pocos píxeles ("el tick es muy sensible").
// stopPropagation porque la fila entera del artículo ahora también es
// clicable (abre "editar") — sin esto, tocar el tick abriría además el
// editor por encima.
function KodoCheck({ checked, onChange, essential = false }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(!checked); }}
      aria-pressed={checked}
      style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        style={{
          width: 20, height: 20, borderRadius: 5,
          border: checked ? 'none' : `1.5px solid ${essential ? 'hsl(var(--primary))' : '#d4cfc8'}`,
          background: checked ? 'hsl(var(--primary))' : essential ? 'hsl(var(--accent))' : 'hsl(var(--card))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
        }}
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
        {!checked && essential && (
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'hsl(var(--primary))' }} />
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Packing tab
// ─────────────────────────────────────────────────────────────────────────────
function PackingTab({ tripId, country, tripInProgress, userId, tripMembers, externalOpen, onExternalClose }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState({});
  const [adding, setAdding] = useState(null);
  const [newName, setNewName] = useState('');
  const [newEssential, setNewEssential] = useState(false);
  const [activeInnerTab, setActiveInnerTab] = useState('maleta');
  const [sheetOpen, setSheetOpen] = useState(false);
  const effectiveSheetOpen = sheetOpen || externalOpen;
  const closeSheet = () => { setSheetOpen(false); onExternalClose?.(); };
  const [sheetCategory, setSheetCategory] = useState('personal');
  const addInputRef = useRef(null);

  const { data: items = [] } = useQuery({
          // Fix: la maleta debe ser individual (cada viajero ve/gestiona solo la
      // suya) — antes se filtraba solo por trip_id, así que todo el mundo veía
      // y podía marcar/borrar los items de los demás miembros del viaje.
      queryKey: ['packingItems', tripId, userId],
      queryFn: () => base44.entities.PackingItem.filter({ trip_id: tripId, user_id: userId }),
      enabled: !!tripId && !!userId, staleTime: 30000,
  });

  // Si `tripMembers` (trip?.members del padre) no había cargado, antes se
  // guardaba con trip_members:[] y el item de la maleta quedaba invisible
  // para siempre, ni para quien lo creó. Se corta antes de guardar algo roto.
  const createMutation = useMutation({
    mutationFn: d => {
      if (!tripMembers?.length) throw new Error(t('cities.tripNotLoadedRetry'));
      return base44.entities.PackingItem.create({ ...d, trip_id: tripId, user_id: userId, trip_members: tripMembers });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['packingItems', tripId] }),
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, packed }) => base44.entities.PackingItem.update(id, { packed }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['packingItems', tripId] }),
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: id => base44.entities.PackingItem.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['packingItems', tripId] }),
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  // Nuevo: editar un artículo ya creado (nombre, cantidad, categoría,
  // esencial) — antes solo se podía marcar/desmarcar o borrar, no cambiar
  // nada más sin borrar y volver a crearlo.
  const [editingItem, setEditingItem] = useState(null);
  const updateItemMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PackingItem.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['packingItems', tripId] }); setEditingItem(null); },
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });
  const deleteFromEditMutation = useMutation({
    mutationFn: id => base44.entities.PackingItem.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['packingItems', tripId] }); setEditingItem(null); },
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const packingItems  = items.filter(i => i.category !== 'souvenir');
  const souvenirItems = items.filter(i => i.category === 'souvenir');

  const totalItems  = packingItems.length;
  const packedCount = packingItems.filter(i => i.packed).length;
  const progress    = totalItems > 0 ? Math.round(packedCount / totalItems * 100) : 0;

  const grouped = PACKING_CATEGORIES.reduce((acc, cat) => {
    acc[cat.value] = packingItems.filter(i => i.category === cat.value);
    return acc;
  }, {});

  const openAdding = (key) => {
    setAdding(key);
    setNewName('');
    setNewEssential(false);
    setTimeout(() => addInputRef.current?.focus(), 80);
  };

  // Antes, al añadir un artículo, la página se quedaba donde estuviera (o
  // incluso más abajo — el teclado del móvil al cerrarse no siempre
  // devuelve el scroll a donde estaba), lejos del botón "+" de arriba del
  // todo. Ahora siempre vuelve arriba tras guardar, que es donde vive ese
  // botón, para poder seguir añadiendo sin buscarlo.
  const scrollToTopAfterAdd = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const commitAdd = async () => {
    // Guard aquí (no solo en el botón "+"): el atajo de Enter en el input
    // no pasaba por el `disabled` del botón, así que un doble Enter rápido
    // antes de que terminara la primera mutación creaba el ítem duplicado.
    if (createMutation.isPending) return;
    if (!newName.trim()) { setAdding(null); return; }
    if (adding === 'souvenir') {
      await createMutation.mutateAsync({ name: newName.trim(), category: 'souvenir', packed: false, essential: false });
    } else {
      await createMutation.mutateAsync({ name: newName.trim(), category: adding, packed: false, essential: newEssential });
    }
    setNewName('');
    setNewEssential(false);
    setAdding(null);
    scrollToTopAfterAdd();
  };

  // Recibe el estado "actual visible" (ya resuelto con el fallback a
  // `allDone`, ver `isCollapsed` más abajo) en vez de leer `p[key]`
  // directamente: como el valor por defecto de una categoría viene de
  // `allDone` y no existe aún en `collapsed`, el primer clic tras un
  // auto-colapso (p.ej. al marcar el último artículo como listo) invertía
  // `undefined` → `true`, que es el mismo valor que ya se estaba mostrando,
  // así que el clic no hacía nada.
  const toggleCollapsed = (key, current) => setCollapsed(p => ({ ...p, [key]: !current }));

  // Inner tab bar (Maleta / Souvenirs) — Ō style
  const innerTabs = [
    { key: 'maleta', label: t('utilities.packing.tabMaleta') },
    ...(tripInProgress ? [{ key: 'souvenirs', label: t('utilities.packing.tabSouvenirs') }] : []),
  ];

  return (
    <div className="space-y-3">
      {/* Inner tabs */}
      {tripInProgress && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex">
            {innerTabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveInnerTab(tab.key)}
                className="flex-1 flex flex-col items-center py-3 gap-1.5">
                <div style={{
                  height: 3, borderRadius: 2, width: 18,
                  background: activeInnerTab === tab.key ? 'hsl(var(--primary))' : 'transparent',
                  marginBottom: 2,
                }} />
                <span style={{
                  fontSize: 13, fontWeight: 500,
                  color: activeInnerTab === tab.key ? 'var(--kodo-text-active)' : 'var(--kodo-nav-inactive)',
                }}>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── MALETA ── */}
      {activeInnerTab === 'maleta' && (
        <>
          {totalItems === 0 ? (
            <div className="bg-card rounded-2xl border border-border text-center py-14 px-6">
                            <p className="text-sm font-medium text-foreground mb-1">{t('utilities.packing.emptyTitle')}</p>
              <p className="text-xs text-muted-foreground mb-5">
                {country ? t('utilities.packing.emptyHintCountry', { country }) : t('utilities.packing.emptyHint')}
              </p>
              <button onClick={() => setSheetOpen(true)}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-white text-sm rounded-full font-medium hover:bg-primary/90 transition-colors">
                <Plus className="w-4 h-4" />{t('utilities.packing.addItem')}
              </button>
            </div>
          ) : (
            <>
              {/* Progress */}
              <div className="bg-card rounded-2xl border border-border p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-foreground">{t('utilities.packing.totalProgress')}</p>
                  <p className={`text-sm font-medium ${progress === 100 ? 'text-green-700' : 'text-primary'}`}>{progress}%</p>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden mb-1.5">
                  <div className={`h-full rounded-full transition-all duration-500 ${progress === 100 ? 'bg-green-600' : 'bg-primary'}`}
                    style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{t('utilities.packing.itemsReady', { packed: packedCount, total: totalItems })}</p>
              </div>

              {/* Categories */}
              {PACKING_CATEGORIES.map(cat => {
                const catItems = grouped[cat.value] || [];
                const catPacked = catItems.filter(i => i.packed).length;
                const allDone = catItems.length > 0 && catPacked === catItems.length;
                const isCollapsed = collapsed[cat.value] ?? allDone;
                const essentialCount = catItems.filter(i => i.essential && !i.packed).length;
                const isAddingHere = adding === cat.value;

                return (
                  <div key={cat.value} className="bg-card rounded-2xl border border-border overflow-hidden">
                    {/* Category header */}
                    <button onClick={() => toggleCollapsed(cat.value, isCollapsed)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/20 transition-colors">
                      <div className="flex items-center gap-2">
                        <cat.Icon size={15} color="#888" />
                        <span className="text-sm font-medium text-foreground">{t(cat.tk)}</span>
                        {essentialCount > 0 && (
                          <span className="text-xs font-medium text-primary bg-orange-50 dark:bg-orange-950/30 px-1.5 py-0.5 rounded-full">
                            {t('utilities.packing.essentialCount', { count: essentialCount })}
                          </span>
                        )}
                        {allDone && catItems.length > 0 && (
                          <Check className="w-3.5 h-3.5 text-green-600" strokeWidth={2.5} />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{catPacked}/{catItems.length}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                          className={`text-muted-foreground transition-transform ${isCollapsed ? '' : 'rotate-180'}`}>
                          <polyline points="18 15 12 9 6 15"/>
                        </svg>
                      </div>
                    </button>

                    {!isCollapsed && (
                      <>
                        {catItems.length === 0 && !isAddingHere && (
                          <p className="text-xs text-muted-foreground text-center py-4 border-t border-border">{t('utilities.packing.noItems')}</p>
                        )}
                        {catItems.map(item => (
                          <div key={item.id} role="button" tabIndex={0}
                            onClick={() => setEditingItem(item)}
                            onKeyDown={e => { if (e.key === 'Enter') setEditingItem(item); }}
                            className={`flex items-center gap-3 px-4 py-2.5 border-t border-border group transition-colors cursor-pointer ${item.packed ? 'opacity-55' : 'hover:bg-secondary/20'}`}>
                            <KodoCheck
                              checked={item.packed}
                              onChange={v => toggleMutation.mutate({ id: item.id, packed: v })}
                              essential={item.essential}
                            />
                            <p className={`flex-1 text-sm truncate ${item.packed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                              {item.name}
                              {item.quantity > 1 && <span className="text-muted-foreground font-normal"> ×{item.quantity}</span>}
                            </p>
                            {!item.essential && (
                              <button onClick={e => { e.stopPropagation(); deleteMutation.mutate(item.id); }} disabled={deleteMutation.isPending}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0 disabled:opacity-30">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}

                        {/* Inline add */}
                        {isAddingHere ? (
                          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border">
                            <input
                              ref={addInputRef}
                              value={newName}
                              onChange={e => setNewName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAdding(null); }}
                              placeholder={t('utilities.packing.itemNamePlaceholder')}
                              className="flex-1 text-sm outline-none bg-transparent text-foreground placeholder:text-muted-foreground"
                            />
                            <button onClick={() => setNewEssential(v => !v)}
                              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${newEssential ? 'bg-orange-50 border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                              {t('utilities.packing.essential')}
                            </button>
                            <button onClick={commitAdd} disabled={createMutation.isPending}
                              className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-50 disabled:pointer-events-none">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {/* ── SOUVENIRS ── */}
      {activeInnerTab === 'souvenirs' && (
        <div className="space-y-3">
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            {souvenirItems.length === 0 && adding !== 'souvenir' && (
              <div className="text-center py-12 px-6">
                                <p className="text-sm font-medium text-foreground mb-1">{t('utilities.packing.souvEmptyTitle')}</p>
                <p className="text-xs text-muted-foreground mb-5">{t('utilities.packing.souvEmptyHint')}</p>
                <button onClick={() => openAdding('souvenir')}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-white text-sm rounded-full font-medium hover:bg-primary/90 transition-colors">
                  <Plus className="w-4 h-4" />{t('utilities.packing.add')}
                </button>
              </div>
            )}

            {souvenirItems.map((item, i) => (
              <div key={item.id} role="button" tabIndex={0}
                onClick={() => setEditingItem(item)}
                onKeyDown={e => { if (e.key === 'Enter') setEditingItem(item); }}
                className={`flex items-center gap-3 px-4 py-3 group transition-colors cursor-pointer ${i > 0 ? 'border-t border-border' : ''} ${item.packed ? 'opacity-55' : 'hover:bg-secondary/20'}`}>
                <KodoCheck
                  checked={item.packed}
                  onChange={v => toggleMutation.mutate({ id: item.id, packed: v })}
                />
                <p className={`flex-1 text-sm truncate ${item.packed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {item.name}
                  {item.quantity > 1 && <span className="text-muted-foreground font-normal"> ×{item.quantity}</span>}
                </p>
                <button onClick={e => { e.stopPropagation(); deleteMutation.mutate(item.id); }} disabled={deleteMutation.isPending}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0 disabled:opacity-30">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {adding === 'souvenir' ? (
              <div className={`flex items-center gap-2 px-4 py-2.5 ${souvenirItems.length > 0 ? 'border-t border-border' : ''}`}>
                <input
                  ref={addInputRef}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAdding(null); }}
                  placeholder={t('utilities.packing.souvPlaceholder')}
                  className="flex-1 text-sm outline-none bg-transparent text-foreground placeholder:text-muted-foreground"
                />
                <button onClick={commitAdd} disabled={createMutation.isPending}
                  className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-50 disabled:pointer-events-none">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              </div>
            ) : souvenirItems.length > 0 ? (
              <button onClick={() => openAdding('souvenir')}
                className="w-full flex items-center gap-2 px-4 py-2.5 border-t border-border text-xs text-primary font-medium hover:bg-orange-50/50 transition-colors">
                <Plus className="w-3.5 h-3.5" />{t('utilities.packing.add')}
              </button>
            ) : null}
          </div>
        </div>
      )}
      <AddPackingSheet
        open={effectiveSheetOpen}
        onClose={closeSheet}
        defaultCategory={sheetCategory}
        saving={createMutation.isPending}
        onSave={async (data) => {
          await createMutation.mutateAsync({ ...data, trip_id: tripId });
          closeSheet();
          scrollToTopAfterAdd();
        }}
      />
      <EditPackingItemSheet
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSave={(id, data) => updateItemMutation.mutate({ id, data })}
        onDelete={(id) => deleteFromEditMutation.mutate(id)}
        saving={updateItemMutation.isPending}
        deleting={deleteFromEditMutation.isPending}
      />
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Emergency tab
// ─────────────────────────────────────────────────────────────────────────────
function EmergencyContent({ country, homeCountry, secondNationality, meta, activeCityName }) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  // Consulados: viven en un fichero aparte de ~340 KB, así que se carga bajo
  // demanda (solo al abrir esta pestaña) y no lastra el arranque de la app.
  const [consulates, setConsulates] = useState([]);
  const [showAllConsulates, setShowAllConsulates] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!country) { setData(null); setLoading(false); return; }
    setLoading(true);
    // Carga diferida: emergencyDB son ~495 KB de datos que solo hacen falta aquí.
    import('@/lib/emergencyDB')
      .then(({ getHardcodedEmergencyInfo }) => {
        if (cancelled) return;
        setData(getHardcodedEmergencyInfo(country, homeCountry, secondNationality || null));
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [country, homeCountry, secondNationality]);

  // Carga diferida de los consulados (fichero grande: solo si hace falta).
  useEffect(() => {
    let cancelled = false;
    setShowAllConsulates(false);
    if (!country || !homeCountry) { setConsulates([]); return; }
    const iso = getCountryIso(normalizeCountry(homeCountry));
    if (!iso) { setConsulates([]); return; }
    import('@/lib/consulatesDB')
      .then(({ getConsulates }) => {
        if (cancelled) return;
        const list = getConsulates(country, iso);
        // El que esté en la ciudad donde está el viajero, primero: si te pasa algo
        // en Mar del Plata te sirve el de Mar del Plata, no el de Buenos Aires.
        const here = (activeCityName || '').trim().toLowerCase();
        const sorted = here
          ? [...list].sort((a, b) => {
              const aq = (a.c || '').toLowerCase() === here ? 0 : 1;
              const bq = (b.c || '').toLowerCase() === here ? 0 : 1;
              return aq - bq;
            })
          : list;
        setConsulates(sorted);
      })
      .catch(() => { if (!cancelled) setConsulates([]); });
    return () => { cancelled = true; };
  }, [country, homeCountry, activeCityName]);

  // No early return — show all tabs even without active trip

  // loading/data handled inline below

  const numbers = data ? [
    data.police && { label:t('utilities.emerg.police'), number:data.police, Icon: Shield, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
    data.ambulance && data.ambulance !== data.police && { label:t('utilities.emerg.ambulance'), number:data.ambulance, Icon: Cross, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30' },
    data.fire && data.fire !== data.police && data.fire !== data.ambulance && { label:t('utilities.emerg.fire'), number:data.fire, Icon: Flame, color: 'text-primary', bg: 'bg-orange-50 dark:bg-orange-950/30' },
    data.emergency_general && !data.police && { label:t('utilities.emerg.general'), number:data.emergency_general, Icon: ShieldAlert, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  ].filter(Boolean) : [];

  return (
    <div className="space-y-4">
      {/* No trip — show info message */}
      {loading && country && (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('utilities.loading')}</p>
        </div>
      )}
      {!loading && country && !data && (
        <div className="bg-card rounded-2xl border border-border text-center py-10 px-6">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground mb-1">{t('utilities.noDataFor', { country: getCountryLabel(country, i18n.language) })}</p>
          <p className="text-xs text-muted-foreground">{t('utilities.emerg.noInfo')}</p>
        </div>
      )}
      {/* Emergency numbers */}
      {!loading && data && numbers.length > 0 && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('utilities.emerg.header', { flag: meta.flag, country: getCountryLabel(country, i18n.language) })}
            </p>
          </div>
          {numbers.map((n, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5 border-b border-border last:border-0">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${n.bg}`}>
                  <n.Icon className={`w-4 h-4 ${n.color}`} />
                </div>
                <span className="text-sm font-medium text-foreground">{n.label}</span>
              </div>
              <span className="text-xl font-medium text-primary tracking-tight">{n.number}</span>
            </div>
          ))}
        </div>
      )}

      {/* Embassy — hide if user is in their own country */}
      {data && data.embassy && (() => {
        const normalizeC = (c) => (c || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isHomeCountry = normalizeC(country) === normalizeC(homeCountry);
        if (isHomeCountry) return null;
        const emb = typeof data.embassy === 'string'
          ? { name: data.embassy.split(':')[0], phone: data.embassy.match(/[+\d][\d\s()-]{6,}/)?.[0] }
          : data.embassy;
        return (
          <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1"><Landmark className="w-4 h-4 text-muted-foreground" /><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('utilities.emerg.embassyOf', { home: getCountryLabel(homeCountry, i18n.language), country: getCountryLabel(country, i18n.language) })}</p></div>
            {emb.name && <p className="text-sm font-semibold text-foreground">{emb.name}</p>}
            {emb.address && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">{emb.address}</p>
              </div>
            )}
            {emb.phone && (
              <a href={`tel:${emb.phone.replace(/\s/g,'')}`} className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm font-semibold text-primary">{emb.phone}</span>
              </a>
            )}
            {emb.emergency_phone && (
              <a href={`tel:${emb.emergency_phone.replace(/\s/g,'')}`} className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <div>
                  <p className="text-label text-muted-foreground">{t('utilities.emerg.emergency24h')}</p>
                  <p className="text-sm font-bold text-primary">{emb.emergency_phone}</p>
                </div>
              </a>
            )}
            {emb.email && (
              <a href={`mailto:${emb.email}`} className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm text-primary">{emb.email}</span>
              </a>
            )}
            {emb.hours && (
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <p className="text-sm text-muted-foreground">{emb.hours}</p>
              </div>
            )}
            {emb.web && (
              <a href={emb.web} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm text-primary font-medium">{t('utilities.emerg.officialSite')}</span>
              </a>
            )}
          </div>
        );
      })()}

      {/* Embajada de la segunda nacionalidad (doble pasaporte) — se calculaba en
          emergencyDB.js pero nunca se llegaba a mostrar aquí */}
      {data && data.secondEmbassy && (() => {
        const emb2 = typeof data.secondEmbassy === 'string'
          ? { name: data.secondEmbassy.split(':')[0], phone: data.secondEmbassy.match(/[+\d][\d\s()-]{6,}/)?.[0] }
          : data.secondEmbassy;
        return (
          <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Landmark className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('utilities.emerg.secondEmbassyOf', { home: getCountryLabel(secondNationality, i18n.language) })}
              </p>
            </div>
            {emb2.name && <p className="text-sm font-semibold text-foreground">{emb2.name}</p>}
            {emb2.address && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">{emb2.address}</p>
              </div>
            )}
            {emb2.phone && (
              <a href={`tel:${emb2.phone.replace(/\s/g,'')}`} className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm font-semibold text-primary">{emb2.phone}</span>
              </a>
            )}
          </div>
        );
      })()}

      {/* Consulados: los 3 primeros (el de la ciudad actual va arriba) y el resto plegado */}
      {!loading && consulates.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t('utilities.emerg.consulates', { count: consulates.length })}
            </p>
          </div>
          <div className="space-y-3">
            {(showAllConsulates ? consulates : consulates.slice(0, 3)).map((c, i) => {
              const isHere = activeCityName && (c.c || '').toLowerCase() === activeCityName.trim().toLowerCase();
              return (
                <div key={`${c.c}-${i}`} className={`rounded-xl p-3 ${isHere ? 'bg-orange-50 dark:bg-orange-950/30 border border-orange-100 dark:border-orange-900/40' : 'bg-secondary/40'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-foreground">{c.c}</p>
                    {isHere && (
                      <span className="text-label bg-primary text-white px-2 py-0.5 rounded-full font-semibold">
                        {t('utilities.emerg.here')}
                      </span>
                    )}
                  </div>
                  {c.a && (
                    <div className="flex items-start gap-2 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground">{c.a}</p>
                    </div>
                  )}
                  {c.p && (
                    <a href={`tel:${c.p.replace(/\s/g,'')}`} className="flex items-center gap-2 mt-1.5">
                      <Phone className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <span className="text-xs font-semibold text-primary">{c.p}</span>
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          {consulates.length > 3 && (
            <button
              onClick={() => setShowAllConsulates(v => !v)}
              className="w-full mt-3 py-2 flex items-center justify-center gap-1 text-xs font-medium text-primary">
              {showAllConsulates
                ? <><ChevronUp className="w-3.5 h-3.5" />{t('utilities.emerg.showLess')}</>
                : <><ChevronDown className="w-3.5 h-3.5" />{t('utilities.emerg.showMore', { count: consulates.length - 3 })}</>}
            </button>
          )}
        </div>
      )}
      {!loading && data && !data.embassy && (() => {
        const normalizeC = (c) => (c || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (normalizeC(country) === normalizeC(homeCountry)) return null;
        const CONSULATE_LINKS = {
          'argentina': 'https://cancilleria.gob.ar/es/servicios/embajadas-y-consulados',
          'colombia': 'https://www.cancilleria.gov.co/tramites_servicios/consulados',
          'mexico': 'https://sre.gob.mx/representaciones',
          'chile': 'https://www.minrel.gob.cl/embajadas-y-consulados',
          'peru': 'https://www.rree.gob.pe/SitePages/Embajadas.aspx',
          'venezuela': 'https://mppre.gob.ve/embajadas-y-consulados/',
          'ecuador': 'https://www.cancilleria.gob.ec/embajadas-y-consulados/',
          'bolivia': 'https://www.cancilleria.gob.bo/',
          'uruguay': 'https://www.gub.uy/ministerio-relaciones-exteriores/',
          'paraguay': 'https://www.mre.gov.py/',
          'brasil': 'https://www.gov.br/mre/pt-br/assuntos/embaixadas-e-consulados',
          'brazil': 'https://www.gov.br/mre/pt-br/assuntos/embaixadas-e-consulados',
          'espana': 'https://www.exteriores.gob.es/es/EmbajadasConsulados',
          'spain': 'https://www.exteriores.gob.es/es/EmbajadasConsulados',
          'portugal': 'https://www.embaixadaportugal.mne.pt',
          'francia': 'https://www.diplomatie.gouv.fr/fr/le-ministere-et-son-reseau/ambassades-et-consulats/',
          'alemania': 'https://www.auswaertiges-amt.de/de/about-us/auslandsvertretungen',
          'italia': 'https://www.esteri.it/it/ambasciate-e-consolati/',
          'reino unido': 'https://www.gov.uk/world',
          'estados unidos': 'https://www.usembassy.gov',
          'china': 'http://www.fmprc.gov.cn/eng/',
        };
        const hn = (homeCountry || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const link = Object.entries(CONSULATE_LINKS).find(([k]) => hn.includes(k))?.[1] 
          || 'https://www.google.com/search?q=embajada+' + encodeURIComponent(homeCountry || '') + '+en+' + encodeURIComponent(country || '');
        return (
          <div className="bg-card rounded-2xl border border-border p-4 text-center">
            <Landmark className="w-7 h-7 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground mb-1">{t('utilities.emerg.noEmbassyTitle')}</p>
            <p className="text-xs text-muted-foreground mb-3">{t('utilities.emerg.noEmbassyHint', { home: getCountryLabel(homeCountry, i18n.language), country: getCountryLabel(country, i18n.language) })}</p>
            <a href={link} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary font-medium">
              {t('utilities.emerg.searchOfficial')}
            </a>
          </div>
        );
      })()}

      {/* Apps de interés */}
      {!loading && data?.useful_apps?.length > 0 && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('utilities.emerg.usefulApps', { country: getCountryLabel(country, i18n.language) })}</p>
          </div>
          {data.useful_apps.map((app, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0">
              {(() => {
                const domains = {
                  'Uber': 'uber.com', 'Grab': 'grab.com', 'Bolt': 'bolt.eu',
                  'Gojek': 'gojek.com', 'Cabify': 'cabify.com', 'DiDi': 'didiglobal.com',
                  'Careem': 'careem.com', 'Rappi': 'rappi.com', 'iFood': 'ifood.com.br',
                  'Google Maps': 'maps.google.com', 'Google Translate': 'translate.google.com',
                  'WhatsApp': 'whatsapp.com', 'Citymapper': 'citymapper.com',
                  'Moovit': 'moovit.com', 'Naver Maps': 'naver.com', 'Naver': 'naver.com',
                  'DB Navigator': 'bahn.de', 'SNCF Connect': 'sncf-connect.com',
                  'Trenitalia': 'trenitalia.com', 'Yandex Go': 'yandex.com',
                  'WeChat': 'wechat.com', 'Alipay': 'alipay.com',
                  'MakeMyTrip': 'makemytrip.com', 'Traveloka': 'traveloka.com',
                  'SBB Mobile': 'sbb.ch', 'PassApp': 'passapp.net',
                  'Doctolib': 'doctolib.fr', 'VPN': 'protonvpn.com',
                  'AlertCops': 'alertcops.com', 'Ola': 'olacabs.com',
                  'InDriver': 'indriver.com', 'inDrive': 'indriver.com',
                  'T-money': 'tmoney.co.kr', 'Suica': 'jreast.co.jp', 'PASMO': 'pasmo.co.jp',
                  'Kakao': 'kakaocorp.com', 'LINE': 'line.me', 'LINE MAN': 'lineman.me',
                  'Snapp': 'snapp.ir', 'BiTaksi': 'bitaksi.com',
                  'Beat': 'free-now.com', 'FreeNow': 'free-now.com',
                  'Angkas': 'angkas.com', 'PickMe': 'pickme.lk',
                  'Little Cab': 'littlecab.co.ke', 'M-Pesa': 'safaricom.co.ke',
                  'MTR Mobile': 'mtr.com.hk', 'MyTransport': 'lta.gov.sg',
                  'RTA Dubai': 'rta.ae', 'Dubai Metro': 'rta.ae', 'Karwa': 'mowasalat.com',
                  'NHS App': 'nhs.uk', 'Mercado Libre': 'mercadolibre.com',
                  'NS ': 'ns.nl', 'CP ': 'cp.pt', 'ÖBB': 'oebb.at',
                  'WienMobil': 'wienerlinien.at', 'BVG': 'bvg.de', 'MVV': 'mvv-muenchen.de',
                  'Italo': 'italotreno.it', 'KOLEO': 'koleo.pl', 'Trafi': 'trafi.com',
                  'BKK Futár': 'bkk.hu', 'PID Lítačka': 'pid.cz', '9292': '9292.nl',
                  'MySOS': 'juntendo.ac.jp', 'Hyperdia': 'hyperdia.com',
                  'IRCTC': 'irctc.co.in', 'MyEG': 'myeg.com.my',
                  'GeoNet NZ': 'geonet.org.nz', 'MetService NZ': 'metservice.com',
                  'MeteoSwiss': 'meteoswiss.admin.ch', 'WeatherCAN': 'weather.gc.ca',
                  'Safetravel IS': 'safetravel.is', 'GovReady': 'govready.io',
                  'CDMX app': 'cdmx.gob.mx', 'Bip!': 'metro.cl',
                  'Trekking Nepal': 'tourism.gov.np', 'Machu Picchu Tickets': 'machupicchu.gob.pe',
                  '99': '99app.com', 'OASA Telematics': 'oasa.gr',
                  '112 app': '112.eu', 'Emergency+': '112australia.org.au',
                  'Hjelp112': '112.no', '112 Sverige': 'sos.se', '112 Suomi': '112.fi',
                  '112 Eesti': 'häirekeskus.ee', 'BE-Alert': 'be-alert.be',
                  'Burgernet': 'burgernet.nl', 'Air Raid Siren UA': 'dsns.gov.ua',
                  'Home Front Command': 'oref.org.il', 'Panic Button SA': 'panicbutton.co.za',
                  '1999 App': 'bangkok.go.th', 'Taiwan Beats': 'emic.gov.tw',
                };
                const key = Object.keys(domains).find(k => app.name?.includes(k));
                const domain = key ? domains[key] : null;
                return (
                  <>
                    {domain ? (
                      <img src={'https://www.google.com/s2/favicons?domain=' + domain + '&sz=64'} alt={app.name} className="w-9 h-9 rounded-xl object-cover flex-shrink-0 bg-secondary" onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }} />
                    ) : null}
                    <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-primary" style={{ display: domain ? 'none' : 'flex' }}>{app.name?.[0]?.toUpperCase() || '?'}</div>
                  </>
                );
              })()}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{app.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{app.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Consejos de seguridad */}
      {!loading && data?.safety_tips?.length > 0 && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('utilities.emerg.safetyTips')}</p>
          </div>
          <div className="px-4 py-3 space-y-2.5">
            {data.safety_tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                <p className="text-sm text-foreground">{tip}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities — wrapper principal con tabs
// ─────────────────────────────────────────────────────────────────────────────
export default function Utilities() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const tripId = searchParams.get('trip_id');
  const initialTab = searchParams.get('tab') || 'tiempo';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [packingSheetOpen, setPackingSheetOpen] = useState(false);
  const [packingCategory, setPackingCategory] = useState('personal');

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => { const r = await base44.entities.Trip.filter({ id: tripId }); return r[0] || null; },
    enabled: !!tripId, staleTime: 30000,
  });

  const { data: tripCities = [] } = useQuery({
    queryKey: ['cities', tripId],
    queryFn: () => base44.entities.City.filter({ trip_id: tripId }, 'order'), // misma queryKey ['cities', tripId] que otras pantallas — unificado para no compartir caché con fetches distintos
    enabled: !!tripId, staleTime: 30000,
  });

  const { data: myProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['myProfile', user?.id],
    queryFn: async () => { const r = await base44.entities.UserProfile.filter({ user_id: user.id }); return r[0] || null; },
    enabled: !!user?.id, staleTime: 300000,
  });

  // Para viajes multipaís, usar la ciudad activa según la fecha de hoy
  const today = format(new Date(), 'yyyy-MM-dd');
  const activeCity = tripCities.find(c => c.start_date <= today && (!c.end_date || c.end_date >= today))
    || tripCities[0];
  const country = activeCity?.country || trip?.country || '';
  const meta = country ? getCountryMeta(country) : {};
  // El registro exige nacionalidad y país de residencia (CreateProfileModal,
  // canStep2), así que en condiciones normales esto siempre debería venir
  // relleno. Antes, mientras la query de perfil aún no había resuelto (o en
  // el caso raro de que de verdad viniera vacío), caía a 'España' a pelo —
  // un usuario angloparlante sin perfil veía requisitos de visado pensados
  // para un pasaporte español, sin ningún aviso de que el dato era una
  // suposición. Ahora se deja en null y RequirementsTab/EmergencyContent
  // distinguen "cargando" de "falta el dato" en vez de inventarse un país.
  const homeCountry = myProfile?.nationality || myProfile?.home_country || myProfile?.country || null;
  const secondNationality = myProfile?.second_nationality || null;

  // `new Date('2026-07-20')` se parsea como medianoche UTC, no local, y sin hora
  // de fin cualquier momento después de medianoche del último día ya contaba
  // como "viaje terminado" — la pestaña Souvenirs desaparecía antes de tiempo,
  // incluso durante el propio día de vuelta. Igual que en Expenses.jsx, se ancla
  // a medianoche/fin de día locales explícitamente.
  const tripInProgress = trip?.start_date && trip?.end_date
    ? new Date() >= new Date(trip.start_date + 'T00:00:00') && new Date() <= new Date(trip.end_date + 'T23:59:59')
    : false;

  const tabs = [
    { key: 'tiempo',      label: t('utilities.weather') },
    // 'requisitos' (visado/vacunas/enchufe/moneda) existía como pantalla completa
    // (RequirementsTab) pero no estaba en esta lista de pestañas — nadie podía
    // llegar a verla desde la UI, aunque toda la lógica y los datos sí funcionaban.
    { key: 'requisitos',  label: t('utilities.requirements') },
    { key: 'emergencias', label: t('utilities.emergency') },
    { key: 'maleta',      label: t('utilities.packing.tabMaleta') },
  ];
  
  // Requisitos del país activo. packingDB (+visaMatrix +visaDB) son ~760 KB que
  // solo se usan aquí: se cargan al abrir la pantalla, no al arrancar la app.
  const [countryReqs, setCountryReqs] = useState(null);
  const [skipVaccines, setSkipVaccines] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!country) { setCountryReqs(null); return; }
    import('@/lib/packingDB')
      .then(({ getCountryRequirements, SKIP_VACCINES }) => {
        if (cancelled) return;
        setCountryReqs(getCountryRequirements(country, homeCountry, secondNationality));
        setSkipVaccines(SKIP_VACCINES || []);
      })
      .catch(() => { if (!cancelled) setCountryReqs(null); });
    return () => { cancelled = true; };
  }, [country, homeCountry, secondNationality]);

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        <div className="px-4 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <Link to={createPageUrl('Home') + '?trip_id=' + tripId}>
                <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors mb-1">
                  <ArrowRight className="w-4 h-4 rotate-180" />{t('utilities.backHome')}
                </button>
              </Link>
              <h1 className="text-xl font-semibold text-foreground">{t('utilities.title')}</h1>
            </div>
            {activeTab === 'maleta' && (
              <button onClick={() => setPackingSheetOpen(true)}
                className="flex items-center gap-1.5 text-primary text-sm font-medium">
                <Plus className="w-4 h-4" /> {t('utilities.packing.itemShort')}
              </button>
            )}
          </div>
          <OTabBar tabs={tabs} activeKey={activeTab} onChange={setActiveTab} />
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {activeTab === 'emergencias' && (
          <EmergencyContent
            country={country}
            homeCountry={homeCountry}
            secondNationality={secondNationality}
            meta={meta}
            activeCityName={activeCity?.name || ''}
            profileLoading={profileLoading}
          />
        )}
        {activeTab === 'maleta' && (
          <PackingTab tripId={tripId} country={country} tripInProgress={tripInProgress} userId={user?.id} tripMembers={trip?.members} externalOpen={packingSheetOpen} onExternalClose={() => setPackingSheetOpen(false)} />
        )}
        {activeTab === 'requisitos' && (
          <RequirementsTab reqs={countryReqs} country={country} homeCountry={homeCountry} meta={meta} skipVaccines={skipVaccines} profileLoading={profileLoading} />
        )}
        {activeTab === 'tiempo' && (
          <div className="space-y-4">
            {tripCities.length > 0 ? (
              tripCities.map(city => (
                <WeatherCard key={city.id} city={city.name} tripCountry={city.country || country} showCityName />
              ))
            ) : country ? (
              <WeatherCard city={trip?.name || country} tripCountry={country} />
            ) : (
              <div className="bg-card rounded-2xl border border-border text-center py-10 px-6">
                <p className="text-sm text-muted-foreground">{t('utilities.noDestination')}</p>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}