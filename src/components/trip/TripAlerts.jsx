import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { differenceInDays, parseISO, isValid } from 'date-fns';
import { isDocForUser } from '@/lib/docHolders';

/**
 * TripAlerts — componente sin UI propia.
 * Calcula cuántos transportes salen hoy dentro de las próximas 4h y lo reporta
 * vía onUrgentCount (alimenta el indicador del tab "Hoy" en OTabBar).
 * Las tarjetas de alerta visibles viven en los tabs Hoy/Inicio.
 */
export default function TripAlerts({ tripId, cities, trip, currentUserEmail, onUrgentCount }) {
  // Tick cada minuto para que la ventana de 4h se mantenga fresca
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets', tripId],
    queryFn: () => base44.entities.Ticket.filter({ trip_id: tripId }),
    enabled: !!tripId,
    staleTime: 60000,
  });

  useEffect(() => {
    const today = new Date();
    const urgentCount = tickets
      // Solo billetes que YO voy a usar (used_by) — el tren de otro viajero no
      // debe encender mi indicador de "sale pronto".
      .filter(t => ['flight', 'train', 'bus'].includes(t.category) && t.date && t.time && (!currentUserEmail || isDocForUser(t, currentUserEmail)))
      .reduce((count, t) => {
        const d = parseISO(t.date);
        if (!isValid(d)) return count;
        if (differenceInDays(d, today) !== 0) return count;
        const [h, m] = String(t.time).split(':').map(Number);
        const dep = new Date(d);
        dep.setHours(h || 0, m || 0, 0, 0);
        const diffMin = (dep - today) / 60000;
        return (diffMin >= 0 && diffMin <= 240) ? count + 1 : count;
      }, 0);
    onUrgentCount?.(urgentCount);
  }, [tickets, onUrgentCount, currentUserEmail]);

  return null;
}
