import { useMemo, useCallback, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getActiveCity } from '@/lib/tripContext';
import { getCountryMeta } from '@/lib/countryConfig';

export function useTripContext(tripId) {
  const storageKey = tripId ? `kodo_active_city_${tripId}` : null;

  const [overrideCityId, setOverrideCityIdState] = useState(() => {
    if (!storageKey) return null;
    return localStorage.getItem(storageKey) || null;
  });

  // Resincronizar cuando cambia storageKey (cambio de viaje activo). Antes
  // esto vivía en un useEffect, que corre DESPUÉS del primer render con el
  // nuevo storageKey — durante ese frame, activeCity (más abajo) se
  // calculaba todavía con el overrideCityId del viaje anterior, casi nunca
  // válido para el nuevo viaje. "Ajustar estado durante el render" (patrón
  // documentado de React: comparar contra un ref y llamar al setter en el
  // cuerpo del componente, no en un efecto) lo aplica de forma síncrona
  // antes de pintar, sin ese frame de por medio.
  const prevStorageKeyRef = useRef(storageKey);
  if (prevStorageKeyRef.current !== storageKey) {
    prevStorageKeyRef.current = storageKey;
    const saved = storageKey ? localStorage.getItem(storageKey) : null;
    setOverrideCityIdState(saved || null);
  }

  const setOverrideCityId = useCallback((cityId) => {
    setOverrideCityIdState(cityId);
    if (storageKey) {
      if (cityId) localStorage.setItem(storageKey, cityId);
      else localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  const clearOverride = useCallback(() => {
    setOverrideCityId(null);
  }, [setOverrideCityId]);

  // staleTime explícito (30s) — antes heredaba el default global de 5 min
  // (query-client.js), demasiado para datos COMPARTIDOS entre viajeros: si
  // Carlos cambia las fechas/ciudades del viaje desde su móvil, tu copia en
  // caché podía tardar hasta 5 minutos en considerarse "vieja" y volver a
  // pedirse, aunque cerraras y abrieras la app — el remount por sí solo no
  // fuerza un refetch si react-query todavía cree que los datos son
  // frescos. Este es el mismo valor que ya usa Cities.jsx para 'trip'.
  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => base44.entities.Trip.get(tripId),
    enabled: !!tripId, staleTime: 30000,
  });

  const { data: cities = [] } = useQuery({
    queryKey: ['cities', tripId],
    queryFn: () => base44.entities.City.filter({ trip_id: tripId }, 'order'),
    enabled: !!tripId, staleTime: 30000,
  });

  const activeCity = useMemo(
    () => getActiveCity({ cities, overrideCityId, nowDate: new Date() }),
    [cities, overrideCityId]
  );

  // Meta del país activo (idioma, moneda, flag…) basado en activeCity
  const activeMeta = useMemo(() => {
    const country = activeCity?.country || trip?.country || '';
    return getCountryMeta(country);
  }, [activeCity, trip]);

  // Ruta completa (países únicos en orden cronológico)
  const countryRoute = useMemo(() => {
    const sorted = [...cities].sort((a, b) => {
      if (a.start_date && b.start_date) return a.start_date.localeCompare(b.start_date);
      return (a.order ?? 0) - (b.order ?? 0);
    });
    const seen = new Set();
    const route = [];
    for (const c of sorted) {
      const country = c.country || trip?.country || '';
      if (country && !seen.has(country)) { seen.add(country); route.push(country); }
    }
    return route;
  }, [cities, trip]);

  return { trip, cities, activeCity, activeMeta, countryRoute, overrideCityId, setOverrideCityId, clearOverride };
}