import { useState, useEffect, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, CheckCircle2, XCircle, Check, Languages, Plane, Hotel, Shield, Utensils, Ticket, MapPin, CloudSun } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeUsername, validateUsername, checkUsernameAvailability } from '@/lib/username';
import { searchUserProfiles } from '@/lib/userProfiles';
import { getCountryMeta, normalizeCountry, getOriginCountryOptions } from '@/lib/countryConfig';
import { useTranslation } from 'react-i18next';
import { setLanguage, getLanguage } from '@/i18n/index.js';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

// José (22 sep 2026): movida a src/lib/termsVersion.js -- compartida ahora
// con el gate de re-aceptación en App.jsx (TermsReacceptGate), que es el
// mecanismo que este comentario decía que debía existir y no existía.
import { TERMS_VERSION } from '@/lib/termsVersion';

// ── País list ─────────────────────────────────────────────────────────────────
const HISPANO_FIRST = ['España','México','Colombia','Argentina','Perú','Venezuela','Chile','Ecuador','Guatemala','Cuba','Bolivia','República Dominicana','Honduras','Paraguay','El Salvador','Nicaragua','Costa Rica','Panamá','Uruguay','Puerto Rico','Guinea Ecuatorial'];
const ALL_COUNTRIES_RAW = ['Afganistán','Albania','Alemania','Andorra','Angola','Antigua y Barbuda','Arabia Saudí','Argelia','Argentina','Armenia','Aruba','Australia','Austria','Azerbaiyán','Bahamas','Bahréin','Bangladés','Barbados','Bélgica','Belice','Benín','Bielorrusia','Bolivia','Bosnia y Herzegovina','Botswana','Brasil','Brunéi','Bulgaria','Burkina Faso','Burundi','Bután','Cabo Verde','Camboya','Camerún','Canadá','Chad','Chile','China','Chipre','Colombia','Comoras','Congo','Corea del Norte','Corea del Sur','Costa Rica','Costa de Marfil','Croacia','Cuba','Curazao','Dinamarca','Dominica','Ecuador','Egipto','El Salvador','Emiratos Árabes Unidos','Eritrea','Eslovaquia','Eslovenia','España','Estados Unidos','Estonia','Etiopía','Filipinas','Finlandia','Fiyi','Francia','Gabón','Gambia','Georgia','Ghana','Gibraltar','Granada','Grecia','Guatemala','Guinea','Guinea Ecuatorial','Guinea-Bisáu','Guyana','Guyana Francesa','Haití','Honduras','Hungría','India','Indonesia','Irak','Irán','Irlanda','Islandia','Israel','Italia','Jamaica','Japón','Jordania','Kazajistán','Kenia','Kirguistán','Kiribati','Kosovo','Kuwait','Laos','Lesoto','Letonia','Líbano','Liberia','Libia','Liechtenstein','Lituania','Luxemburgo','Madagascar','Malaui','Malasia','Maldivas','Malí','Malta','Marruecos','Martinica','Mauritania','Mauricio','México','Micronesia','Moldavia','Mónaco','Mongolia','Montenegro','Mozambique','Myanmar','Namibia','Nepal','Nicaragua','Níger','Nigeria','Noruega','Nueva Zelanda','Omán','Pakistán','Palaos','Panamá','Papúa Nueva Guinea','Paraguay','Países Bajos','Perú','Polonia','Portugal','Puerto Rico','Qatar','Reino Unido','República Centroafricana','República Checa','República del Congo','República Dominicana','Ruanda','Rumanía','Rusia','Saint-Martin','Samoa','San Cristóbal y Nieves','San Marino','San Vicente','Santa Lucía','Santo Tomé y Príncipe','Senegal','Serbia','Seychelles','Sierra Leona','Singapur','Sint Maarten','Somalia','Sri Lanka','Sudáfrica','Sudán','Sudán del Sur','Suecia','Suiza','Surinam','Tailandia','Taiwan','Tayikistán','Tanzania','Timor Oriental','Togo','Tonga','Trinidad y Tobago','Túnez','Turkmenistán','Turquía','Tuvalu','Ucrania','Uganda','Uruguay','Uzbekistán','Vanuatu','Venezuela','Vietnam','Yemen','Yibuti','Zambia','Zimbabue','Esuatini'];
const SORTED_COUNTRIES = [...HISPANO_FIRST, ...ALL_COUNTRIES_RAW.filter(n => !HISPANO_FIRST.includes(n)).sort((a, b) => a.localeCompare(b, 'es'))];
// Lista de países en el idioma activo. `name` es el canónico español (lo que se
// guarda en BD); `label` es el nombre traducido que ve el usuario. Los países
// hispanohablantes van primero por relevancia para la base de usuarios actual.
function buildCountries(lang) {
  // nacionalidad/residencia: sin subdivisiones (ver getOriginCountryOptions)
  const opts = getOriginCountryOptions(lang);
  const byName = new Map(opts.map(o => [o.value, o]));
  const first = HISPANO_FIRST.filter(n => byName.has(n));
  const rest = opts.filter(o => !HISPANO_FIRST.includes(o.value))
                   .sort((a, b) => a.label.localeCompare(b.label, (lang || 'es').split('-')[0]));
  const ordered = [...first.map(n => byName.get(n)), ...rest];
  return ordered.map(o => {
    const meta = getCountryMeta(o.value);
    return { name: o.value, label: o.label, flag: meta.flag || '🌍', currency: meta.currency || 'USD' };
  });
}

// ── Slides de features (3-6) ──────────────────────────────────────────────────
const FEATURE_SLIDES = [
  { id: 'grupo' },
  { id: 'preparativos' },
  { id: 'gastos' },
  { id: 'hoy' },
];

// ── Selector de país ──────────────────────────────────────────────────────────
function CountryPicker({ value, onChange, placeholder }) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const COUNTRIES = useMemo(() => buildCountries(i18n.language), [i18n.language]);
  const filtered = search
    ? COUNTRIES.filter(c => {
        const q = search.toLowerCase();
        // se busca por nombre traducido y por canónico español
        return c.label.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
      })
    : COUNTRIES;
  // se normaliza por si en BD hay un nombre de una lista antigua ('Yemen' → 'Yemén')
  const selected = COUNTRIES.find(c => c.name === normalizeCountry(value));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl border text-sm text-left transition-colors ${value ? 'border-primary bg-card' : 'border-border bg-secondary/40'}`}
      >
        {selected ? (
          <span className="flex items-center gap-2 font-medium text-foreground">
            <span className="text-lg">{selected.flag}</span>
            <span>{selected.label}</span>
            {selected.currency && (
              <span className="text-xs text-primary font-semibold ml-1">{selected.currency} ✓</span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground flex-shrink-0">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('settings.searchCountry')}
              className="w-full px-3 py-2 text-sm bg-secondary rounded-xl outline-none border border-border focus:border-primary/50"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map(country => (
              <button
                key={country.name}
                type="button"
                onClick={() => { onChange(country); setOpen(false); setSearch(''); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-secondary/60 ${value === country.name ? 'bg-orange-50 dark:bg-orange-950/20 text-primary font-semibold' : 'text-foreground'}`}
              >
                <span className="text-base flex-shrink-0">{country.flag}</span>
                <span className="flex-1">{country.label}</span>
                <span className="text-xs text-muted-foreground">{country.currency}</span>
                {value === country.name && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">{t('common.noResults')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Slide idioma (slide -1, antes de todo) ────────────────────────────────────
function SlideIdioma({ onSelect }) {
  const [selected, setSelected] = useState(getLanguage());

  const handleContinue = () => {
    setLanguage(selected);
    onSelect(selected);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-orange-100 dark:bg-orange-950/30 flex items-center justify-center mb-6">
        <Languages className="w-8 h-8 text-primary" strokeWidth={1.5} />
      </div>
      <h2 className="text-2xl font-black text-foreground text-center leading-tight mb-2">
        {selected === 'es' ? 'Elige tu idioma' : 'Choose your language'}
      </h2>
      <p className="text-sm text-muted-foreground text-center mb-10">
        {selected === 'es' ? 'Puedes cambiarlo después en ajustes' : 'You can change this later in settings'}
      </p>

      <div className="w-full space-y-3 mb-10">
        <button
          onClick={() => setSelected('es')}
          className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition-all ${
            selected === 'es'
              ? 'border-primary bg-orange-50 dark:bg-orange-950/20'
              : 'border-border bg-card'
          }`}
        >
          <span className="text-2xl">🇪🇸</span>
          <div className="flex-1 text-left">
            <p className="text-base font-semibold text-foreground">Español</p>
            <p className="text-xs text-muted-foreground">Spanish</p>
          </div>
          {selected === 'es' && <Check className="w-5 h-5 text-primary flex-shrink-0" />}
        </button>

        <button
          onClick={() => setSelected('en')}
          className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition-all ${
            selected === 'en'
              ? 'border-primary bg-orange-50 dark:bg-orange-950/20'
              : 'border-border bg-card'
          }`}
        >
          <span className="text-2xl">🇬🇧</span>
          <div className="flex-1 text-left">
            <p className="text-base font-semibold text-foreground">English</p>
            <p className="text-xs text-muted-foreground">Inglés</p>
          </div>
          {selected === 'en' && <Check className="w-5 h-5 text-primary flex-shrink-0" />}
        </button>
      </div>

      <button
        onClick={handleContinue}
        className="w-full py-3.5 rounded-full bg-primary text-white text-sm font-bold transition-colors"
      >
        {selected === 'es' ? 'Continuar' : 'Continue'}
      </button>
    </div>
  );
}


function ProgressDots({ current, total }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${i === current ? 'bg-primary w-4' : i < current ? 'bg-primary/40 w-1.5' : 'bg-border w-1.5'}`}
        />
      ))}
    </div>
  );
}

// ── Slide feature: Grupo ──────────────────────────────────────────────────────
function SlideGrupo() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col">
      <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">3 / 6</p>
      <h2 className="text-2xl font-black text-foreground leading-tight mb-2">{t('onboarding.s3.title1')}<br />{t('onboarding.s3.title2')}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
        {t('onboarding.s3.body')}
      </p>

      {/* Demo: documentos compartidos */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Header miembros */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-1">
            {['C','M','A'].map((l, i) => (
              <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-card ${i === 0 ? 'bg-primary' : i === 1 ? 'bg-violet-500' : 'bg-cyan-600'}`}
                style={{ marginLeft: i > 0 ? -6 : 0 }}>
                {l}
              </div>
            ))}
            <span className="text-xs text-muted-foreground ml-2">{t('onboarding.s3.travelers')}</span>
          </div>
          <span className="text-xs bg-orange-50 dark:bg-orange-950/20 text-primary border border-orange-200 dark:border-orange-900/40 px-2.5 py-1 rounded-full font-semibold">{t('onboarding.s3.invite')}</span>
        </div>

        {/* Docs compartidos */}
        <div className="divide-y divide-border">
          {[
            { Icon: Plane, bg: 'bg-blue-50', name: 'MAD → NRT · Iberia', sub: '09:45 · 12 mar', vis: t('documents.visibility.group'), visCls: 'bg-green-100 text-green-700' },
            { Icon: Hotel, bg: 'bg-purple-50', name: 'Park Hyatt Tokyo', sub: 'Check-in 12 mar', vis: t('documents.visibility.personal'), visCls: 'bg-secondary text-muted-foreground' },
            { Icon: Shield, bg: 'bg-secondary', name: t('onboarding.s4.insurance'), sub: 'Válido 12–24 mar', vis: t('documents.visibility.selected'), visCls: 'bg-blue-100 text-blue-700' },
          ].map((doc, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${doc.bg}`}><doc.Icon className="w-4 h-4 text-muted-foreground" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground leading-snug truncate">{doc.name}</p>
                <p className="text-xs text-muted-foreground">{doc.sub}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${doc.visCls}`}>{doc.vis}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Slide feature: Preparativos ───────────────────────────────────────────────
function SlidePreparativos() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col">
      <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">4 / 6</p>
      <h2 className="text-2xl font-black text-foreground leading-tight mb-2">{t('onboarding.s4.title1')}<br />{t('onboarding.s4.title2')}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
        {t('onboarding.s4.body')}
      </p>

      {/* Countdown */}
      <div className="bg-card border border-border rounded-2xl p-4 text-center mb-3">
        <p className="text-5xl font-semibold text-primary leading-none">47</p>
        <p className="text-xs text-muted-foreground mt-1">{t('onboarding.s4.daysToTrip')}</p>
        <p className="text-xs text-primary mt-1.5">{t('onboarding.s4.firstStop')}</p>
      </div>

      {/* Grid maleta + docs */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-card border border-border rounded-2xl p-3">
          <p className="text-xs text-muted-foreground mb-0.5">{t('onboarding.s5.packing')}</p>
          <p className="text-2xl font-semibold text-foreground">34%</p>
          <div className="mt-1.5 h-1 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: '34%' }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">6/18 items</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-3">
          <p className="text-xs text-muted-foreground mb-0.5">{t('onboarding.s5.documents')}</p>
          <p className="text-2xl font-semibold text-foreground">3</p>
          <p className="text-xs text-muted-foreground mt-3">3 subidos</p>
        </div>
      </div>

      {/* Checklist exacto al código */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div>
            <p className="text-sm font-semibold text-foreground">{t('onboarding.s4.todo')}</p>
            <p className="text-xs text-muted-foreground">{t('onboarding.s4.passport')}</p>
          </div>
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{t('onboarding.s4.allSet')}</span>
        </div>
        {/* Visados: level ok → solo informativo, badge verde */}
        <div className="flex items-center gap-2 px-4 py-2 bg-secondary/30 border-b border-border">
          <div style={{ height: 2.5, width: 20, background: 'hsl(var(--primary))', borderRadius: 2 }} />
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t('onboarding.s4extra.visaCategory')}</p>
          <Check className="w-3 h-3 text-green-500 ml-auto" />
        </div>
        <div className="flex items-start gap-3 px-4 py-2.5 border-b border-border">
          <Shield className="w-3.5 h-3.5 text-green-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground leading-tight">{t('onboarding.s4.noVisa')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('onboarding.s4.noVisaSub')}</p>
          </div>
          <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 border border-green-200">ok</span>
        </div>
        {/* Equipamiento: level info → sin checkbox, badge recomendado */}
        <div className="flex items-center gap-2 px-4 py-2 bg-secondary/30 border-b border-border">
          <div style={{ height: 2.5, width: 20, background: 'hsl(var(--primary))', borderRadius: 2 }} />
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t('onboarding.s4extra.equipmentCategory')}</p>
        </div>
        <div className="flex items-start gap-3 px-4 py-2.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2" className="mt-0.5 flex-shrink-0"><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground leading-tight">{t('onboarding.s4extra.adapterItem')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('onboarding.s4extra.adapterItemSub')}</p>
          </div>
          <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 border border-amber-100">recom.</span>
        </div>
      </div>
    </div>
  );
}

// ── Slide feature: Gastos ─────────────────────────────────────────────────────
function SlideGastos() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col">
      <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">5 / 6</p>
      <h2 className="text-2xl font-black text-foreground leading-tight mb-2">{t('onboarding.s5.title1')}<br />{t('onboarding.s5.title2')}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
        {t('onboarding.s5.body')}
      </p>

      {/* Balance */}
      <div className="bg-card border border-border rounded-2xl px-4 py-3 mb-3 flex items-baseline justify-between">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">{t('onboarding.s5.yourBalance')}</p>
          <p className="text-3xl font-semibold text-green-600">+€25.00</p>
        </div>
        <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-semibold">{t('onboarding.s5.owedToYou')}</span>
      </div>

      {/* Gastos */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden mb-3">
        {[
          { Icon: Utensils, bg: 'bg-orange-50', name: t('onboarding.s5.dinner'), sub: t('onboarding.s5.paidBy', { name: 'Carlos' }), amount: '€60.00' },
          { Icon: Ticket, bg: 'bg-orange-50', name: 'TeamLab Planets', sub: t('onboarding.s5.paidBy', { name: 'José' }), amount: '€80.00' },
        ].map((g, i, arr) => (
          <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${g.bg}`}><g.Icon className="w-4 h-4 text-muted-foreground" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground leading-snug">{g.name}</p>
              <p className="text-xs text-muted-foreground">{g.sub}</p>
            </div>
            <p className="text-sm font-semibold text-foreground flex-shrink-0">{g.amount}</p>
          </div>
        ))}
      </div>

      {/* Balances — quién debe a quién */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-2 bg-secondary/30 border-b border-border">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t('onboarding.s5.owedToYouLabel')}</p>
        </div>
        {[
          { initial: 'M', color: 'bg-violet-500', text: 'María debe a Carlos', amount: '€15.00' },
          { initial: 'A', color: 'bg-cyan-600', text: 'Ana debe a Carlos', amount: '€15.00' },
        ].map((b, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-border">
            <div className={`w-7 h-7 rounded-full ${b.color} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}>{b.initial}</div>
            <p className="text-sm font-medium text-foreground flex-1">{b.text}</p>
            <p className="text-sm font-bold text-red-500 flex-shrink-0">{b.amount}</p>
          </div>
        ))}
        <div className="px-4 py-2 bg-secondary/30 border-b border-border">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t('onboarding.s5.youOwe')}</p>
        </div>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white flex-shrink-0">J</div>
          <p className="text-sm font-medium text-foreground flex-1">{t('onboarding.s5.example')}</p>
          <p className="text-sm font-bold text-red-500 flex-shrink-0">€5.00</p>
        </div>
      </div>
    </div>
  );
}

// ── Slide feature: Hoy + Spots ────────────────────────────────────────────────
function SlideHoy() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col">
      <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">6 / 6</p>
      <h2 className="text-2xl font-black text-foreground leading-tight mb-2">{t('onboarding.s6.title1')}<br />{t('onboarding.s6.title2')}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
        {t('onboarding.s6.body')}
      </p>

      {/* DayCard HOY fiel al código */}
      <div className="bg-card border-2 border-orange-200 rounded-2xl overflow-hidden mb-3">
        <div className="flex items-center justify-between px-4 py-2.5 bg-orange-50 border-b border-orange-200">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold text-primary uppercase tracking-widest">{t('onboarding.s6.today')}</span>
            <span className="text-sm font-semibold text-foreground">Tokio</span>
            <span className="text-xs text-muted-foreground">14 mar · 3</span>
          </div>
          <span className="inline-flex items-center gap-1"><CloudSun className="w-4 h-4 text-muted-foreground" /><span className="text-xs font-semibold text-foreground">18°</span></span>
        </div>
        {/* Timeline items */}
        {[
          { time: '09:45', Icon: Plane, iconBg: 'bg-blue-50', name: 'MAD → NRT · Iberia', sub: t('onboarding.s6.flightSub'), hasLine: true },
          { time: '14:00', Icon: MapPin, iconBg: 'bg-orange-50', name: 'Tsukiji Fish Market', sub: t('onboarding.s6.spotSub'), hasLine: true },
          { time: null, Icon: Utensils, iconBg: 'bg-orange-50', name: 'Sukiyabashi Jiro', sub: t('onboarding.s6.restaurantSub'), hasLine: false },
        ].map((item, i) => (
          <div key={i} className={`flex items-start gap-0 px-4 py-2 ${i < 2 ? 'border-b border-border' : ''}`}>
            <div className="w-10 flex-shrink-0 flex flex-col items-end pt-0.5 gap-1">
              {item.time
                ? <span className="text-[10px] font-semibold text-primary leading-none">{item.time}</span>
                : <div className="w-2 h-2 rounded-full bg-border mt-1" />}
              {item.hasLine && <div className="w-px h-5 bg-border mr-1.5" />}
            </div>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mx-2 ${item.iconBg}`}><item.Icon className="w-4 h-4 text-muted-foreground" /></div>
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-sm font-medium text-foreground leading-snug truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Spots buscador */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex border-b border-border">
          <div className="flex-1 py-2 text-center border-b-2 border-primary -mb-px">
            <span className="text-xs font-bold text-primary">{t('common.search')}</span>
          </div>
          <div className="flex-1 py-2 text-center">
            <span className="text-xs text-muted-foreground">{t('spots.mySpots')}</span>
          </div>
        </div>
        <div className="px-3 py-2.5">
          <div className="bg-secondary border border-border rounded-xl px-3 py-2 flex items-center gap-2 mb-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground flex-shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span className="text-xs text-muted-foreground">{t('onboarding.s6.searchExample')}</span>
          </div>
          {/* José (24 sep 2026): igual que el buscador real ahora -- cada
              resultado es una ficha (nombre, estrellas, tipo, abierto) con el
              botón naranja "Guardar" abajo a la derecha. Datos de ejemplo:
              sin atribución de Google, porque no son datos de Google. */}
          {[
            { name: 'Ramen Ichiran Shibuya', rating: '4,5', count: '8.214', sub: t('onboarding.s6.ramenSub'), open: true, saved: false },
            { name: 'TeamLab Planets', rating: '4,7', count: '31.052', sub: t('onboarding.s6.teamlabSub'), open: true, saved: true },
          ].map((spot, i, arr) => (
            <div key={i} className={`relative py-2.5 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
              <p className="text-xs font-semibold text-foreground leading-snug truncate pr-2">{spot.name}</p>
              <p className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                {spot.rating} <span className="text-amber-500">★</span> <span className="text-primary">({spot.count})</span>
              </p>
              <p className="text-[10px] text-muted-foreground">{spot.sub}</p>
              {spot.open && <p className="text-[10px] text-green-700">{t('onboarding.s6.open')}</p>}
              <div className="absolute right-0 bottom-2.5">
                {spot.saved
                  ? <span className="text-[10px] text-muted-foreground px-2 py-1">{t('onboarding.s6.saved')}</span>
                  : <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary bg-card border border-primary rounded-full px-2 py-0.5">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      {t('common.save')}
                    </span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function CreateProfileModal({ user, open, onComplete }) {
  const { t } = useTranslation();
  // slide: -1=idioma, 0=perfil, 1=pasaporte, 2..5=features
  const [slide, setSlide] = useState(-1);
  const TOTAL_SLIDES = 6; // profile slides only (sin idioma en dots)

  // Step 1
  const [displayName, setDisplayName] = useState(user?.full_name || '');
  const [username, setUsername] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState(null);
  const [usernameError, setUsernameError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Step 2
  const [nationality, setNationality] = useState('España');
  const [homeCountry, setHomeCountry] = useState('España');
  const [homeCurrency, setHomeCurrency] = useState('EUR');
  const [secondNationality, setSecondNationality] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  // Username debounce check
  useEffect(() => {
    if (!username) { setAvailable(null); setUsernameError(''); return; }
    const err = validateUsername(username);
    if (err) { setUsernameError(t(`common.usernameErrors.${err}`)); setAvailable(null); return; }
    setUsernameError('');
    setChecking(true);
    const timer = setTimeout(async () => {
      const ok = await checkUsernameAvailability(username, user?.id);
      setAvailable(ok);
      setChecking(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [username, user?.id]);

  const handleNationalitySelect = useCallback((country) => {
    setNationality(country.name);
  }, []);

  const handleResidenceSelect = useCallback((country) => {
    setHomeCountry(country.name);
    setHomeCurrency(country.currency);
  }, []);

  const handleSecondNationalitySelect = useCallback((country) => {
    setSecondNationality(country.name);
  }, []);

  const canStep1 = displayName.trim().length >= 2 && !validateUsername(username) && available === true && termsAccepted;
  const canStep2 = !!nationality && !!homeCountry;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Guarda de idempotencia: este modal se abre cuando `myProfile` (en
      // TripsList.jsx) todavía es null, pero esa comprobación vive en una
      // query de React Query que puede ejecutarse antes de que el perfil
      // recién creado se haya propagado, o quedar abierta en una pestaña ya
      // vieja. Sin este chequeo, un segundo envío de este formulario para un
      // user_id que YA tiene perfil crea una fila UserProfile duplicada (con
      // el mismo user_id/email pero username distinto) — es exactamente lo
      // que encontramos al re-onboardear la cuenta de QA en esta sesión:
      // dos perfiles para el mismo user_id, y cualquier UI que liste
      // "miembros por email" (selector de "quién ve este documento",
      // MembersPanel, etc.) los mostraba como dos personas distintas.
      // Se busca por user_id vía función backend (no rls-restringido) y, si
      // ya existe un perfil, no se crea uno nuevo: se reutiliza el existente
      // y se continúa el flujo como si se acabara de crear.
      const existing = await searchUserProfiles({ userIds: [user.id] });
      if (existing.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['myProfile', user.id] });
        setSlide(2); // go to features
        setSaving(false);
        return;
      }
      const ok = await checkUsernameAvailability(username, user?.id);
      if (!ok) { setError(t('onboarding.slide0.usernameTaken')); setSaving(false); setAvailable(false); return; }
      const created = await base44.entities.UserProfile.create({
        user_id: user.id,
        // invites.js/NotificationBell/Invites.jsx comparan y filtran email en
        // minúsculas; si aquí se guarda tal cual venga de base44.auth, un
        // email con mayúsculas rompe esas comparaciones desde el primer día.
        email: (user.email || '').toLowerCase(),
        username,
        username_normalized: username,
        display_name: displayName.trim(),
        home_country: homeCountry,
        home_currency: homeCurrency,
        nationality,
        second_nationality: secondNationality || null,
        language: getLanguage(),
        // Consentimiento RGPD: sin esto, la cuenta se creaba sin ningún
        // registro de que el usuario hubiese aceptado nada. canStep1 ya
        // exige termsAccepted antes de poder llegar aquí (slide 0 → 1), pero
        // se guarda igualmente la fecha/versión exacta por si hace falta
        // demostrar consentimiento informado más adelante.
        terms_accepted_at: new Date().toISOString(),
        terms_version: TERMS_VERSION,
      });
      // El check de arriba (y el del debounce mientras se escribe) es
      // "comprobar y luego crear" sin ninguna transacción — sin una
      // restricción de unicidad a nivel de esquema, dos personas pidiendo el
      // mismo username casi a la vez podían pasar ambas el check y crear dos
      // UserProfile con el mismo username_normalized, rompiendo la asunción
      // de unicidad que usa el resto de la app (MembersPanel/InviteModal
      // buscan por username_normalized y asumen que el primer resultado es
      // el correcto). Tras crear, se relee por username_normalized: si
      // aparece OTRO perfil además del propio, es que se perdió la carrera —
      // se borra el que se acaba de crear aquí y se pide reintentar con otro
      // username, en vez de dejar el duplicado en la base de datos.
      // UserProfile.read se cerró en el rls a "solo tu propio perfil" — un
      // .filter() directo aquí ya nunca vería el duplicado de otra persona
      // (justo lo que este chequeo necesita detectar), así que se relee vía
      // función backend igual que el resto de búsquedas por username.
      const afterCreate = await searchUserProfiles({ usernameQuery: username, exact: true });
      const dupes = afterCreate.filter(p => p.id !== created.id && p.user_id !== user.id);
      if (dupes.length > 0) {
        await base44.entities.UserProfile.delete(created.id).catch(() => {});
        setError(t('onboarding.slide0.usernameTaken'));
        setAvailable(false);
        setSaving(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['myProfile', user.id] });
      setSlide(2); // go to features
    } catch {
      setError(t('errors.generic'));
      setSaving(false);
    }
  };

  const featureSlides = [SlideGrupo, SlidePreparativos, SlideGastos, SlideHoy];
  const isLanguageSlide = slide === -1;
  const isFeatureSlide = slide >= 2;
  const isLastSlide = slide === TOTAL_SLIDES - 1;
  const FeatureComponent = isFeatureSlide ? featureSlides[slide - 2] : null;

  if (!open) return null;

  // Language slide — fullscreen, no header/dots
  if (isLanguageSlide) {
    return (
      <div className="fixed inset-0 z-[200] bg-background flex flex-col">
        <SlideIdioma onSelect={() => setSlide(0)} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-12 pb-4 flex-shrink-0">
        <ProgressDots current={slide} total={TOTAL_SLIDES} />
        {isFeatureSlide && !isLastSlide && (
          <button
            onClick={() => setSlide(TOTAL_SLIDES - 1)}
            className="text-sm text-muted-foreground font-medium"
          >
            {t('common.skip')}
          </button>
        )}
        {!isFeatureSlide && (
          <span className="text-xs text-muted-foreground font-medium">{t('onboarding.mandatory')}</span>
        )}
        {isLastSlide && <div className="w-10" />}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col">

        {/* SLIDE 0: Perfil */}
        {slide === 0 && (
          <div className="flex-1 flex flex-col">
            <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">{t('onboarding.step', { current: 1, total: 6 })}</p>
            <h2 className="text-2xl font-black text-foreground leading-tight mb-2">{t('onboarding.slide0.title')}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              {t('onboarding.slide0.subtitle')}
            </p>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{t('onboarding.slide0.nameLabel')}</p>
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder=""
                  className={`w-full px-4 py-3 rounded-2xl border text-sm font-medium text-foreground outline-none transition-colors ${displayName.trim() ? 'border-primary bg-card' : 'border-border bg-secondary/40'} focus:border-primary`}
                />
              </div>

              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{t('onboarding.slide0.usernameLabel')}</p>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">@</span>
                  <input
                    value={username}
                    onChange={e => { setUsername(normalizeUsername(e.target.value)); setAvailable(null); }}
                    placeholder=""
                    maxLength={30}
                    autoCapitalize="none"
                    autoCorrect="off"
                    className={`w-full pl-8 pr-10 py-3 rounded-2xl border text-sm font-medium text-foreground outline-none transition-colors ${available === true ? 'border-primary bg-card' : available === false ? 'border-red-400 dark:border-red-500 bg-red-50 dark:bg-red-950/30' : 'border-border bg-secondary/40'} focus:border-primary`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {checking && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    {!checking && available === true && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    {!checking && available === false && <XCircle className="w-4 h-4 text-red-500" />}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">{t('onboarding.slide0.usernameHint')}</p>
                {usernameError && <p className="text-xs text-red-500 mt-0.5">{usernameError}</p>}
                {!checking && !usernameError && available === false && (
                  <p className="text-xs text-red-500 mt-0.5">{t('onboarding.slide0.usernameTaken')}</p>
                )}
                {!checking && !usernameError && available === true && (
                  <p className="text-xs text-green-600 mt-0.5">{t('onboarding.slide0.usernameAvailable')}</p>
                )}
              </div>

              {/* Consentimiento RGPD: bloquea el registro hasta aceptar
                  explícitamente — antes no existía ningún checkbox ni
                  registro de consentimiento en todo el flujo de alta. */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={e => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-border text-primary flex-shrink-0"
                />
                <span className="text-xs text-muted-foreground leading-relaxed">
                  {t('onboarding.slide0.termsPrefix')}{' '}
                  <Link to={createPageUrl('Terms')} target="_blank" rel="noopener noreferrer"
                    className="text-primary font-medium underline" onClick={e => e.stopPropagation()}>
                    {t('onboarding.slide0.termsLabel')}
                  </Link>
                  {' '}{t('onboarding.slide0.termsAnd')}{' '}
                  <Link to={createPageUrl('Privacy')} target="_blank" rel="noopener noreferrer"
                    className="text-primary font-medium underline" onClick={e => e.stopPropagation()}>
                    {t('onboarding.slide0.privacyLabel')}
                  </Link>
                </span>
              </label>
            </div>
          </div>
        )}

        {/* SLIDE 1: Pasaporte */}
        {slide === 1 && (
          <div className="flex-1 flex flex-col">
            <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">{t('onboarding.step', { current: 2, total: 6 })}</p>
            <h2 className="text-2xl font-black text-foreground leading-tight mb-2">{t('onboarding.slide1.title')}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              {t('onboarding.slide1.subtitle')}
            </p>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{t('onboarding.slide1.nationalityLabel')}</p>
                <CountryPicker
                  value={nationality}
                  onChange={handleNationalitySelect}
                  placeholder={t('onboarding.slide1.nationalityPlaceholder')}
                />
              </div>

              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{t('onboarding.slide1.residenceLabel')}</p>
                <CountryPicker
                  value={homeCountry}
                  onChange={handleResidenceSelect}
                  placeholder={t('onboarding.slide1.residencePlaceholder')}
                />
                <p className="text-xs text-muted-foreground mt-1.5">{t('onboarding.slide1.residenceHint')}</p>
              </div>

              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                  {t('onboarding.slide1.secondPassportLabel')} <span className="font-normal text-muted-foreground normal-case tracking-normal">— {t('common.optional')}</span>
                </p>
                <CountryPicker
                  value={secondNationality}
                  onChange={handleSecondNationalitySelect}
                  placeholder={t('onboarding.slide1.secondPassportPlaceholder')}
                />
                {secondNationality && (
                  <button
                    onClick={() => setSecondNationality('')}
                    className="text-xs text-muted-foreground mt-1.5 underline"
                  >
                    {t('onboarding.slide1.removeSecond')}
                  </button>
                )}
                <p className="text-xs text-muted-foreground mt-1.5">{t('onboarding.slide1.secondPassportHint')}</p>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          </div>
        )}

        {/* SLIDES 2-5: Features */}
        {isFeatureSlide && FeatureComponent && (
          <FeatureComponent />
        )}
      </div>

      {/* Bottom CTA — fixed */}
      <div className="px-5 pb-8 pt-3 flex-shrink-0 border-t border-border bg-background">
        {slide === 0 && (
          <>
            <button
              onClick={() => setSlide(1)}
              disabled={!canStep1}
              className="w-full py-3.5 rounded-full bg-primary text-white text-sm font-bold disabled:bg-border disabled:text-muted-foreground transition-colors"
            >
              {t('common.next')}
            </button>
            {!canStep1 && (
              <p className="text-xs text-muted-foreground text-center mt-2">
                {displayName.trim().length >= 2 && !validateUsername(username) && available === true && !termsAccepted
                  ? t('onboarding.slide0.termsRequired')
                  : t('onboarding.slide0.fillAll')}
              </p>
            )}
          </>
        )}

        {slide === 1 && (
          <button
            onClick={handleSave}
            disabled={!canStep2 || saving}
            className="w-full py-3.5 rounded-full bg-primary text-white text-sm font-bold disabled:bg-border disabled:text-muted-foreground transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" />{t('common.loading')}</> : t('common.next')}
          </button>
        )}

        {isFeatureSlide && !isLastSlide && (
          <button
            onClick={() => setSlide(s => s + 1)}
            className="w-full py-3.5 rounded-full bg-primary text-white text-sm font-bold transition-colors"
          >
            {t('common.next')}
          </button>
        )}

        {isLastSlide && (
          <button
            onClick={() => onComplete?.()}
            className="w-full py-3.5 rounded-full bg-primary text-white text-sm font-bold transition-colors"
          >
            {t('common.start')}
          </button>
        )}
      </div>
    </div>
  );
}
