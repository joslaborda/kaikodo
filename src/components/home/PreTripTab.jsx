import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, Check, Users, Landmark, ArrowRight } from 'lucide-react';

import { getCountryMeta, normalizeCountry, getCountryLabel } from '@/lib/countryConfig';
import { daysUntil } from '@/lib/tripDays';
import { REQ_ICON_MAP } from './constants';
import MemberAvatarRow from './MemberAvatarRow';

function buildRequirements(countries, originCountry, secondNationality = null, lang = 'es', db = null) {
  if (!db) return [];
  const { COUNTRY_REQUIREMENTS, SKIP_VACCINES, getHolidaysInRange, getVisaInfo } = db;
  const requirements = [];
  const originISO = getCountryMeta(originCountry)?.iso || originCountry;
  const secondISO = secondNationality ? getCountryMeta(secondNationality)?.iso : null;
  const originMeta = getCountryMeta(originCountry);
  const originPlugs = (originMeta?.plug || '').split('/').map(p => p.trim()).filter(Boolean);
  const originCurrency = originMeta?.currency || '';

  countries.forEach(country => {
    const countryData = COUNTRY_REQUIREMENTS[country];
    if (!countryData) return;
    const destISO = getCountryMeta(country)?.iso || country;
    const destMeta = getCountryMeta(country);

    // ── Visa ──────────────────────────────────────────────────────────────
    // Antes esto llamaba getVisaInfo() dos veces por separado (una por
    // pasaporte) y se quedaba con el resultado del segundo pasaporte en
    // cuanto needed===false, sin usar el `note` que ya devuelve
    // getVisaInfo() explicando qué pasa con el OTRO pasaporte. Resultado:
    // con dos nacionalidades (p. ej. España + Reino Unido yendo a Londres)
    // la tarjeta pasaba a describir "Tu país." sin más contexto, mientras
    // el tip estático de packingDB.js seguía diciendo "ETA en gov.uk"
    // como "Recomendado" — dos avisos contradictorios para el mismo
    // requisito. getVisaInfo() ya hace bien la comparación de los dos
    // pasaportes (incluye desempate por días) si se le pasa el tercer
    // argumento, así que basta con delegarle todo el trabajo aquí.
    const best = getVisaInfo(destISO, originISO, secondISO);
    const description = [best?.notes || best?.info, best?.note].filter(Boolean).join(' — ')
      || countryData.visa?.info || '';
    requirements.push({
      id: `visa-${country}`, type: 'visa', country,
      origin: originCountry,
      title: `${getCountryLabel(originCountry, lang)} → ${getCountryLabel(country, lang)}`,
      description,
      level: best?.needed === true ? 'required' : (best?.needed === false ? 'ok' : 'info'),
    });

    // ── Enchufe ───────────────────────────────────────────────────────────
    const destPlugRaw = countryData.adapter?.type || destMeta?.plug || '';
    const destPlugs = destPlugRaw.split(/[/·,]/).map(p => p.trim().replace(/^Tipo\s*/i, '')).filter(Boolean);
    // Check if origin plugs overlap with destination plugs
    const needsAdapter = destPlugs.length > 0 && !destPlugs.some(p => originPlugs.includes(p));
    if (destPlugs.length > 0) {
      requirements.push({
        id: `tech-${country}`, type: 'tech', country,
        title: destPlugRaw.startsWith('Tipo') ? destPlugRaw : `Tipo ${destPlugRaw}`,
        description: countryData.adapter?.info
          ? `Voltaje: ${countryData.adapter.info}`
          : destMeta?.plug ? `Tipo ${destMeta.plug}` : '',
        level: needsAdapter ? 'required' : 'ok',
      });
    }

    // ── Vacunas ───────────────────────────────────────────────────────────
    if (countryData.vaccines?.length) {
      const travelVaccines = countryData.vaccines.filter(v => !SKIP_VACCINES.includes(v.name));
      const required = travelVaccines.filter(v => v.priority === 'obligatoria para entrada');
      const recommended = travelVaccines.filter(v => v.priority !== 'obligatoria para entrada');
      if (required.length) {
        requirements.push({
          id: `vaccine-req-${country}`, type: 'vaccine', country,
          title: required.map(v => v.name).join(', '),
          description: '',
          level: 'required',
        });
      }
      if (recommended.length) {
        requirements.push({
          id: `vaccine-rec-${country}`, type: 'vaccine', country,
          title: recommended.slice(0, 4).map(v => v.name).join(', '),
          description: '',
          level: 'info',
        });
      }
    }

    // ── Divisa ────────────────────────────────────────────────────────────
    const destCurrency = destMeta?.currency || '';
    if (destCurrency && destCurrency !== originCurrency && countryData.currency?.info) {
      requirements.push({
        id: `money-${country}`, type: 'money', country,
        title: countryData.currency.info.split('.')[0], // e.g. "Peso colombiano (COP)"
        description: countryData.currency.info,
        level: 'required',
      });
    }

    // ── Consejos ─────────────────────────────────────────────────────────
    if (countryData.tips?.length) {
      // Filter out tips that are about adapters/plugs since we already show that
      const filteredTips = countryData.tips.filter(tip => {
        const t = tip.toLowerCase();
        return !t.includes('adaptador') && !t.includes('enchufe') && !t.includes('plug') && !t.includes('voltaje');
      });
      if (filteredTips.length) {
        requirements.push({
          id: `safety-${country}`, type: 'safety', country,
          title: filteredTips.slice(0, 2).join(' · '),
          description: '',
          level: 'info',
        });
      }
    }
  });
  return requirements;
}

export default function PreTripTab({ trip, cities, packingItems, documents, myProfile, profiles, onInvite, currentUserEmail }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? undefined : es;
  const tripId = trip?.id;
  const originCountry = myProfile?.home_country || 'España';
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [checkedItems, setCheckedItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`kodo_checklist_${tripId}`) || '{}'); } catch { return {}; }
  });

  const allCountries = useMemo(() => {
    const norm = (c) => (c || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const seen = {};
    const all = cities.length > 0 ? cities.map(c => c.country).filter(Boolean) : [trip?.country].filter(Boolean);
    all.forEach(c => {
      const normalized = normalizeCountry(c) || c; // convert English → Spanish if needed
      const key = norm(normalized);
      if (!seen[key]) seen[key] = normalized;
    });
    return Object.values(seen);
  }, [trip, cities]);

  // Las bases de visados, vacunas y festivos suman ~880 KB y solo se usan en esta
  // pestaña (y solo antes de que empiece el viaje): se cargan al abrirla.
  const [db, setDb] = useState(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import('@/lib/packingDB'),
      import('@/lib/holidaysDB'),
      import('@/lib/visaMatrix'),
    ]).then(([packing, holidays, visa]) => {
      if (cancelled) return;
      setDb({
        COUNTRY_REQUIREMENTS: packing.COUNTRY_REQUIREMENTS,
        SKIP_VACCINES: packing.SKIP_VACCINES,
        getHolidaysInRange: holidays.getHolidaysInRange,
        getVisaInfo: visa.getVisaInfo,
      });
    }).catch(() => { if (!cancelled) setDb(null); });
    return () => { cancelled = true; };
  }, []);

  const requirements = useMemo(() =>
    buildRequirements([...allCountries], originCountry, myProfile?.second_nationality || null, i18n.language, db),
    [allCountries, originCountry, myProfile?.second_nationality, i18n.language, db]
  );

  // Una testeadora reportó que la info de embajada/apps útiles (vive en
  // Utilities.jsx, tab "Emergencias") quedaba enterrada: desde Home había que
  // entrar a "Maleta" y luego cambiar de pestaña a mano para encontrarla — nada
  // en Home avisaba de que existía. Se replica aquí el mismo lazy-load que ya
  // usa Utilities.jsx (emergencyDB pesa ~495 KB, solo se carga si hay destino)
  // para mostrar un aviso directo con link a esa pestaña exacta.
  const destCountry = allCountries[0];
  const [emergencyPreview, setEmergencyPreview] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!destCountry) { setEmergencyPreview(null); return; }
    import('@/lib/emergencyDB').then(({ getHardcodedEmergencyInfo }) => {
      if (cancelled) return;
      setEmergencyPreview(getHardcodedEmergencyInfo(destCountry, originCountry, myProfile?.second_nationality || null));
    }).catch(() => { if (!cancelled) setEmergencyPreview(null); });
    return () => { cancelled = true; };
  }, [destCountry, originCountry, myProfile?.second_nationality]);

  // normalizeCountry() ya deja ambos nombres en la misma forma canónica en
  // español, así que basta comparar en minúsculas (sin el strip de acentos
  // NFD que usa Utilities.jsx, innecesario aquí porque ambos vienen limpios).
  const isHomeCountry = destCountry && destCountry.trim().toLowerCase() === (originCountry || '').trim().toLowerCase();
  const hasEmbassy = !isHomeCountry && !!emergencyPreview?.embassy;
  const appsCount = emergencyPreview?.useful_apps?.length || 0;

  const toggleCheck = (id) => {
    const next = { ...checkedItems, [id]: !checkedItems[id] };
    setCheckedItems(next);
    try { localStorage.setItem(`kodo_checklist_${tripId}`, JSON.stringify(next)); } catch {}
  };

  const visaReqs      = requirements.filter(r => r.type === 'visa');
  const actionableReqs = requirements.filter(r => r.level !== 'ok');
  const displayReqs   = [...visaReqs, ...actionableReqs.filter(r => r.type !== 'visa')];
  const doneCount     = displayReqs.filter(r => r.level !== 'ok' && checkedItems[r.id]).length;
  const packedCount   = packingItems.filter(i => i.packed).length;
  const packedPct     = packingItems.length ? Math.round(packedCount / packingItems.length * 100) : 0;
  const docsCount     = documents?.length || 0;

  const sortedCities = useMemo(() =>
    [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
    [cities]
  );

  const daysLeft = trip?.start_date ? daysUntil(trip.start_date) : null;

  return (
    <div className="space-y-3">
      {daysLeft !== null && daysLeft >= 0 && (
        <div className="bg-card rounded-2xl border border-border p-5 text-center">
          <p className="text-5xl font-semibold text-primary leading-none">{daysLeft}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('onboarding.s4.daysToTrip')}</p>
          {sortedCities.length > 0 && (
            <p className="text-xs text-primary mt-2">
              {t('pretrip.firstStop')}: {sortedCities[0].name}
              {trip?.start_date && ` · ${format(parseISO(trip.start_date), 'dd MMM yyyy', { locale: dateLocale })}`}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link to={createPageUrl('Utilities') + '?trip_id=' + tripId + '&tab=maleta'}>
          <div className="bg-card rounded-2xl border border-border p-4 hover:border-primary/40 transition-colors">
            <p className="text-xs text-muted-foreground mb-1">{t('pretrip.suitcase')}</p>
            <p className="text-2xl font-semibold text-foreground">{packedPct}%</p>
            <div className="mt-2 h-1 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: packedPct + '%' }} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{packedCount}/{packingItems.length} items</p>
          </div>
        </Link>
        <Link to={createPageUrl('Documents') + '?trip_id=' + tripId}>
          <div className="bg-card rounded-2xl border border-border p-4 hover:border-primary/40 transition-colors">
            <p className="text-xs text-muted-foreground mb-1">{t('documents.title')}</p>
            <p className="text-2xl font-semibold text-foreground">{docsCount}</p>
            <p className="text-xs text-muted-foreground mt-1">{docsCount === 0 ? t('pretrip.noneUploaded') : t('pretrip.uploadedCount', { count: docsCount })}</p>
          </div>
        </Link>
      </div>

      {/* Embajada + apps útiles — antes solo se veía entrando a Maleta y
          cambiando de pestaña a mano a "Emergencias"; nada en Home avisaba de
          que existía. Ahora es visible directamente, con link a esa pestaña. */}
      {(hasEmbassy || appsCount > 0) && (
        <Link to={createPageUrl('Utilities') + '?trip_id=' + tripId + '&tab=emergencias'}>
          <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3 hover:border-primary/40 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{t('pretrip.embassyAppsTitle')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {[hasEmbassy ? t('pretrip.emergency') : null, appsCount > 0 ? t('pretrip.embassyAppsCount', { count: appsCount }) : null]
                  .filter(Boolean).join(' · ')}
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
        </Link>
      )}

      {displayReqs.length > 0 && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <p className="text-sm font-semibold text-foreground">{t('onboarding.s4.todo')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('pretrip.passportOf', { country: originCountry })}</p>
            </div>
          </div>
          {(() => {
            const GROUPS = [
              { key: 'visa',    label: t('pretrip.groupVisas'), types: ['visa'] },
              { key: 'vaccine', label: t('pretrip.vaccines'), types: ['vaccine'] },
              { key: 'tech',    label: t('pretrip.groupPlug'), types: ['tech'] },
              { key: 'money',   label: t('pretrip.groupCurrency'),  types: ['money'] },
              { key: 'safety',  label: t('pretrip.groupTips'),types: ['safety', 'info'] },
            ];
            return GROUPS.map(group => {
              const items = displayReqs.filter(r => group.types.includes(r.type));
              if (!items.length) return null;
              const allDone = items.filter(r => checkedItems[r.id]).length === items.length;
              const isCollapsed = collapsedGroups[group.key] ?? allDone;
              return (
                <div key={group.key}>
                  <button onClick={() => setCollapsedGroups(p => ({ ...p, [group.key]: !isCollapsed }))}
                    className="w-full flex items-center justify-between px-4 py-2 bg-secondary/30 border-b border-border hover:bg-secondary/50 transition-colors">
                    <div className="flex items-center gap-2">
                      <p className="text-label font-semibold text-foreground/70 uppercase tracking-wider">{group.label}</p>
                      {allDone && <Check className="w-3 h-3 text-green-600" strokeWidth={2.5} />}
                    </div>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className={"text-muted-foreground transition-transform " + (isCollapsed ? '' : 'rotate-180')}>
                      <polyline points="18 15 12 9 6 15"/>
                    </svg>
                  </button>
                  {!isCollapsed && items.map(req => {
                    const isInfo = req.level === 'info';
                    const isOk   = req.level === 'ok';

                    if (isOk && req.type === 'tech') return null;

                    if (isOk) {
                      return (
                        <div key={req.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                          <span className="text-base shrink-0">{REQ_ICON_MAP[req.type] ? REQ_ICON_MAP[req.type]({className:'text-green-600'}) : null}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground leading-tight">{req.origin} → {req.country}</p>
                            {req.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{req.description}</p>}
                          </div>
                          <span className="text-xs bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium shrink-0 border border-green-200 dark:border-green-900/40">{t('pretrip.visaFree')}</span>
                        </div>
                      );
                    }

                    if (!isInfo) {
                      return (
                        <button key={req.id} onClick={() => toggleCheck(req.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/20 transition-colors text-left">
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${checkedItems[req.id] ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>
                            {checkedItems[req.id] && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <span className="text-base shrink-0">{REQ_ICON_MAP[req.type] ? REQ_ICON_MAP[req.type]({className:'text-primary'}) : null}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium leading-tight ${checkedItems[req.id] ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{req.title}</p>
                            {req.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{req.description}</p>}
                          </div>
                          {!checkedItems[req.id] && (
                            <span className="text-xs bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 px-2 py-0.5 rounded-full font-medium shrink-0 border border-red-200 dark:border-red-900/40">{t('common.required')}</span>
                          )}
                        </button>
                      );
                    }

                    return (
                      <div key={req.id} className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0">
                        <span className="text-base shrink-0 mt-0.5">{REQ_ICON_MAP[req.type] ? REQ_ICON_MAP[req.type]({className:'text-muted-foreground'}) : 'ℹ️'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground leading-tight">{req.title}</p>
                          {req.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{req.description}</p>}
                        </div>
                        {req.type === 'visa'
                          ? <span className="text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium shrink-0 border border-amber-100 dark:border-amber-900/40">{t('pretrip.verify')}</span>
                          : <span className="text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium shrink-0 border border-amber-100 dark:border-amber-900/40">{t('common.recommended')}</span>
                        }
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      )}

      {(() => {
        if (!trip?.start_date || !trip?.end_date || !db) return null;
        const countryList = [...new Set(sortedCities.map(c => c.country).filter(Boolean))];
        const tripHolidays = db.getHolidaysInRange(countryList, trip.start_date, trip.end_date, sortedCities);
        if (!tripHolidays.length) return null;
        return (
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center"><Calendar size={11} className="text-amber-700" /></span>
                {t('pretrip.holidaysInTrip')}
              </p>
              <span className="text-xs font-medium text-amber-800 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full border border-amber-200/60 dark:border-amber-900/40">
                {tripHolidays.length} día{tripHolidays.length > 1 ? 's' : ''}
              </span>
            </div>
            {tripHolidays.map((h, i) => {
              const d = new Date(h.date + 'T12:00:00');
              const day = d.toLocaleDateString('es-ES', { day: 'numeric' });
              const mon = d.toLocaleDateString('es-ES', { month: 'short' });
              return (
                <div key={i} className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
                  <div className="flex-shrink-0 min-w-[38px] text-center bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 rounded-lg py-1.5 px-1">
                    <p className="text-base font-medium text-amber-800 dark:text-amber-300 leading-none">{day}</p>
                    <p className="text-micro text-amber-600 dark:text-amber-500 uppercase tracking-wide mt-1">{mon}</p>
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm font-medium text-foreground leading-snug">{h.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {h.city ? h.city : h.country || ''}{(h.city || h.country) && h.scope ? ` · ${h.scope}` : ''}
                    </p>
                    {h.note && <p className="text-xs text-amber-700 dark:text-amber-500 mt-1.5 pl-2 border-l-2 border-amber-300 dark:border-amber-700 leading-relaxed">{h.note}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4" />{t('pretrip.travelers')}
          </p>
        </div>
        <MemberAvatarRow trip={trip} profiles={profiles} onInvite={onInvite} currentUserEmail={currentUserEmail} />
      </div>
    </div>
  );
}
