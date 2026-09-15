import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { getTopCities } from '@/lib/countryConfig';
import { searchCitiesGoogle, fetchCityLocation } from '@/lib/cityPlaces';
import { Loader2, ChevronDown, MapPin } from 'lucide-react';

// José (14 sep 2026): antes esto era solo texto libre sobre una lista fija
// de "ciudades top por país" -- un nombre finlandés/chino escrito con una
// errata, o simplemente un pueblo que no salía en esa lista, se guardaba
// tal cual, sin corrección y sin coordenadas. Ahora, además de la lista
// rápida de siempre (sin red, instantánea), se busca en paralelo contra
// Google Places -- que sí entiende variantes/erratas y sabe la ubicación
// real. Elegir una sugerencia de Google llama a onSelectPlace({name,lat,lng})
// además de onChange(name); elegir de la lista rápida intenta enriquecerla
// con coordenadas en segundo plano (silencioso, sin bloquear nada).
//
// FALLBACK: si Google falla por lo que sea (sin red, sin key, tope diario),
// onChange(name) ya se ha llamado ANTES del intento de red -- la ciudad se
// guarda igual, solo que sin coordenadas. Nunca se bloquea la creación de
// una ciudad por esto.
export default function CityInput({ country, value, onChange, onSelectPlace, placeholder = 'Elige o escribe una ciudad...', extraSuggestions = [] }) {
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(value || '');
  const [googleResults, setGoogleResults] = useState([]);
  const [googleSearching, setGoogleSearching] = useState(false);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // Sync filter when value changes externally
  useEffect(() => { setFilter(value || ''); }, [value]);

  // Load cities whenever country changes, clear previous list
  useEffect(() => {
    if (!country) { setCities([]); return; }
    let cancelled = false;
    setCities([]);
    setLoading(true);
    getTopCities(country)
      .then((c) => { if (!cancelled) setCities(c); })
      .catch(() => { if (!cancelled) setCities([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [country]);

  // Búsqueda en Google, debounced -- puramente aditiva, nunca sustituye la
  // lista rápida de arriba ni bloquea nada si falla.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    if (!filter || filter.trim().length < 2) { setGoogleResults([]); setGoogleSearching(false); return; }
    setGoogleSearching(true);
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      searchCitiesGoogle(filter.trim(), controller.signal)
        .then(results => setGoogleResults(results))
        .catch(() => setGoogleResults([]))
        .finally(() => setGoogleSearching(false));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filter]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // extraSuggestions: nombres de ciudad que el propio usuario ya escribió en
  // este viaje (p. ej. una parada repetida) — no dependen de country ni de la
  // lista "top cities", así que se combinan con esa lista en vez de sustituirla.
  // Así se sugieren tanto ciudades conocidas como paradas que el usuario ya usó,
  // incluyendo pueblos pequeños que no salen en ningún listado global.
  const allSuggestions = [...new Set([...(extraSuggestions || []), ...cities])];
  const filtered = filter
    ? allSuggestions.filter((c) => c.toLowerCase().includes(filter.toLowerCase()))
    : allSuggestions;
  // No repetir en "Google" lo que ya sale en la lista rápida.
  const filteredNames = new Set(filtered.map(c => c.toLowerCase()));
  const googleOnly = googleResults.filter(r => !filteredNames.has(r.name.toLowerCase()));

  const handleInput = (e) => {
    const v = e.target.value;
    setFilter(v);
    onChange(v);
    setOpen(true);
  };

  const handleSelect = (city) => {
    setFilter(city);
    onChange(city);
    setOpen(false);
    // Enriquecimiento silencioso en segundo plano -- no bloquea la
    // selección, que ya quedó hecha arriba. Si falla o no encuentra nada,
    // la ciudad se queda igual, sin coordenadas (mismo comportamiento que
    // siempre ha tenido esta lista).
    if (onSelectPlace) {
      searchCitiesGoogle([city, country].filter(Boolean).join(', '))
        .then(results => {
          const match = results[0];
          if (!match) return null;
          return fetchCityLocation(match.placeId);
        })
        .then(loc => { if (loc) onSelectPlace({ name: city, lat: loc.lat, lng: loc.lng, photoRef: loc.photoName }); })
        .catch(() => {});
    }
  };

  const handleSelectGoogle = (result) => {
    setFilter(result.name);
    onChange(result.name);
    setOpen(false);
    if (onSelectPlace) {
      fetchCityLocation(result.placeId)
        .then(loc => { if (loc) onSelectPlace({ name: result.name, lat: loc.lat, lng: loc.lng, photoRef: loc.photoName }); })
        .catch(() => {});
    }
  };

  const showDropdown = open && (filtered.length > 0 || googleOnly.length > 0 || googleSearching);

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Input
          value={filter}
          onChange={handleInput}
          onFocus={() => setOpen(true)}
          placeholder={loading ? 'Cargando ciudades...' : placeholder}
          className="bg-input border-border text-foreground pr-8"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {showDropdown && (
        <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto bg-card border border-border rounded-xl shadow-lg">
          {filtered.map((city) => (
            <li
              key={'top-' + city}
              onMouseDown={() => handleSelect(city)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-orange-50 hover:text-primary transition-colors"
            >
              {city}
            </li>
          ))}
          {googleOnly.map((r) => (
            <li
              key={'g-' + r.placeId}
              onMouseDown={() => handleSelectGoogle(r)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-orange-50 hover:text-primary transition-colors flex items-start gap-2"
            >
              <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span>
                <span className="block">{r.name}</span>
                {r.secondaryText && <span className="block text-xs text-muted-foreground">{r.secondaryText}</span>}
              </span>
            </li>
          ))}
          {googleSearching && filtered.length === 0 && googleOnly.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />Buscando...
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
