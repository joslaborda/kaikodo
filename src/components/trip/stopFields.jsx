import { useState, useRef, useEffect, useMemo, forwardRef } from 'react';
import { Search, Loader2, MapPin } from 'lucide-react';
import { normalizeCountry, getCountryOptions, searchCountries, getCountryLabel, getCountryIso } from '@/lib/countryConfig';
import { searchCitiesGoogle, fetchCityLocation } from '@/lib/cityPlaces';
import { useTranslation } from 'react-i18next';

// José (24 sep 2026): piezas de las paradas compartidas entre el formulario de
// viaje nuevo (NewTripModal) y Ajustes del viaje (SettingsDialog): buscador de
// ciudad (Google, el país sale de la sugerencia) y campo de país para
// ciudades escritas a mano.

// Abreviaturas con las que Google devuelve algunos países.
const GOOGLE_COUNTRY_ALIASES = {
  'EE. UU.': 'Estados Unidos', 'EE.UU.': 'Estados Unidos', 'EEUU': 'Estados Unidos', 'USA': 'Estados Unidos',
  'UK': 'Reino Unido', 'EAU': 'Emiratos Árabes', 'UAE': 'Emiratos Árabes',
};
export function countryFromSecondary(secondaryText) {
  const last = (secondaryText || '').split(',').pop()?.trim();
  if (!last) return '';
  const canon = normalizeCountry(GOOGLE_COUNTRY_ALIASES[last] || last);
  return getCountryIso(canon) ? canon : '';
}

// ─── Inline country autocomplete (free-text + suggestions from catalog) ───────
export const CountryField = forwardRef(function CountryField({ value, onChange, hasError }, externalRef) {
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

// ─── Buscador de ciudad (Google, sin restringir por país) ─────────────────────
// Elegir una sugerencia da ciudad + país + coordenadas. Escribir y pulsar
// "Usar «X»" crea la parada solo con el nombre (y entonces se pide el país).
export function CitySearch({ initial = '', placeholder, autoFocus = false, onPick, onCancel }) {
  const { t } = useTranslation();
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    abortRef.current?.abort();
    const text = q.trim();
    if (text.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => {
      searchCitiesGoogle(text, controller.signal)
        .then(r => setResults(r))
        .catch(() => {})
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q]);

  useEffect(() => {
    const handler = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); onCancel?.(); } };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCancel]);

  const pickGoogle = (r) => {
    const base = { city: r.name, country: countryFromSecondary(r.secondaryText), placeId: r.placeId, lat: null, lng: null };
    onPick(base);
    setQ(''); setResults([]); setOpen(false);
    // Coordenadas en segundo plano: no bloquean nada (mismo fallback que CityInput).
    fetchCityLocation(r.placeId)
      .then(loc => { if (loc) onPick({ ...base, lat: loc.lat, lng: loc.lng }, { coordsOnly: true }); })
      .catch(() => {});
  };
  const pickRaw = () => {
    const name = q.trim();
    if (!name) return;
    onPick({ city: name, country: '', placeId: null, lat: null, lng: null });
    setQ(''); setResults([]); setOpen(false);
  };

  const showDrop = open && q.trim().length >= 2;
  return (
    <div className="relative flex-1 min-w-0" ref={boxRef}>
      <div className="relative">
        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (results[0]) pickGoogle(results[0]); else pickRaw(); }
            if (e.key === 'Escape') { setOpen(false); onCancel?.(); }
          }}
          placeholder={placeholder}
          autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false}
          className="w-full h-10 border border-border bg-card rounded-xl pl-9 pr-8 text-sm outline-none focus:border-primary transition-colors"
        />
        {searching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {showDrop && (
        <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto bg-card border border-border rounded-xl shadow-lg">
          {results.map(r => (
            <li key={r.placeId} onMouseDown={e => { e.preventDefault(); pickGoogle(r); }}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block text-foreground">{r.name}</span>
                {r.secondaryText && <span className="block text-xs text-muted-foreground truncate">{r.secondaryText}</span>}
              </span>
            </li>
          ))}
          {!searching && (
            <li onMouseDown={e => { e.preventDefault(); pickRaw(); }}
              className="px-3 py-2 text-xs text-primary font-medium cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-950/30 border-t border-border">
              {t('trip.new.useQuery', { q: q.trim() })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

