import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

// José (21 sep 2026) — paso 2 del plan (docs/ARQUITECTURA.md §5): los
// documentos del viaje (Ticket) se pedían desde 6 sitios distintos bajo 3
// claves de caché distintas ('allDocs', 'documents', 'tickets'). Cada pantalla
// podía tener una versión distinta de la misma lista — la causa de que "un
// billete que ya está subido no salga" en una y sí en otra. Ahora hay UNA sola
// consulta y UNA sola clave: lo que se sube/edita/borra en cualquier pantalla
// se refleja en todas a la vez.
//
// El filtrado "qué veo yo" NO va aquí (lo hace el backend con el rls de
// Ticket.jsonc) ni el "qué entra en mi Ruta" (docHolders.js): esta función solo
// trae los datos.
export const tripDocsKey = (tripId) => ['tripDocs', tripId];

export function useTripDocs(tripId, { enabled = true, staleTime = 30000 } = {}) {
  return useQuery({
    queryKey: tripDocsKey(tripId),
    queryFn: () => base44.entities.Ticket.filter({ trip_id: tripId }, '-date'),
    enabled: !!tripId && enabled,
    staleTime,
    // El caché persistido en localStorage pinta primero la lista de la última
    // vez: sin esto no se veía un billete recién subido por otro viajero hasta
    // pasar el staleTime.
    refetchOnMount: 'always',
  });
}

// Único sitio desde el que se invalida — cualquier cambio en un documento
// (crear, editar, borrar, reordenar, enlazar a un alojamiento) llama a esto.
export function invalidateTripDocs(queryClient, tripId) {
  return queryClient.invalidateQueries({ queryKey: tripDocsKey(tripId) });
}
