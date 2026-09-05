import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { base44 } from '@/api/base44Client';

// Nombre del evento global que se dispara cuando cualquier query/mutation
// falla con 401/403 (token caducado a mitad de sesión — habitual en un viaje
// largo con conexión intermitente). AuthContext.jsx escucha este evento para
// forzar logout + redirección al login; antes, si el token caducaba mientras
// la app seguía abierta, las peticiones fallaban en silencio y las pantallas
// se quedaban vacías o rotas sin ningún aviso. Se dispara como CustomEvent en
// vez de importar AuthContext directamente aquí para evitar un ciclo de
// imports (AuthContext.jsx ya importa este archivo).
export const AUTH_EXPIRED_EVENT = 'kodo:auth-expired';

function isAuthError(error) {
  const status = error?.status ?? error?.response?.status ?? error?.data?.status;
  return status === 401 || status === 403;
}

// Evita confundir "tu sesión ya no vale" con "esta fila concreta no te es
// accesible por RLS" — ambos casos llegan como 401/403 en este backend (p.
// ej. si expulsan a alguien de un viaje mientras tiene la pantalla abierta,
// su siguiente Trip.get(tripId) falla con 403 por rls, no porque su token
// haya caducado). Antes, CUALQUIER 401/403 de CUALQUIER query/mutation
// disparaba un logout completo — regresión real: perder acceso a un solo
// recurso ya no debería cerrar toda la sesión. Al ver un 401/403, se
// reconfirma en tiempo real con auth.me(): si la sesión sigue siendo válida,
// era un rechazo de ESTE recurso concreto y no se dispara el evento (la
// pantalla/mutation que falló ya muestra su propio error); solo si auth.me()
// también falla se considera la sesión realmente caducada.
let expiryCheckInFlight = null;
function handleQueryError(error) {
  if (!isAuthError(error)) return;
  if (expiryCheckInFlight) return; // ya hay una comprobación en curso
  expiryCheckInFlight = base44.auth.me()
    .then(() => {
      // La sesión sigue siendo válida — el 401/403 era de este recurso
      // concreto (rls, permisos de la acción...), no de la sesión.
    })
    .catch(() => {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    })
    .finally(() => {
      expiryCheckInFlight = null;
    });
}

export const queryClientInstance = new QueryClient({
  defaultOptions: {
    queries: {
      // Antes en false. Kaikōdo es una app de viajes COMPARTIDOS — varios
      // viajeros editan el mismo viaje desde dispositivos distintos, sin
      // ningún mecanismo de tiempo real (websocket/push) que avise a los
      // demás de un cambio. Con esto en false, la única forma de refrescar
      // datos de otro viajero era esperar a que venciera el staleTime de
      // cada query (5 min por defecto) — de ahí el bug real reportado:
      // Carlos cambia las fechas del viaje, y en el móvil de quien fue
      // invitado la app seguía mostrando el viaje viejo (fechas y foto de
      // portada, que se deriva de trip/cities — ver src/lib/tripImage.js)
      // durante minutos, incluso cerrando y abriendo la app. Con esto en
      // true, volver a la app (cambiar de pestaña/app y regresar, algo muy
      // habitual en móvil al recibir una notificación o cambiar de app)
      // dispara un refetch en segundo plano de cualquier query ya stale —
      // sigue sin ser tiempo real, pero cierra el hueco más común sin tener
      // que esperar minutos. Coste: alguna petición de red extra al volver
      // a primer plano, aceptable frente al bug de datos obsoletos en una
      // app colaborativa.
      refetchOnWindowFocus: true,
      retry: 1,
      // Cache data for 24 hours — survives reloads offline
      gcTime: 1000 * 60 * 60 * 24,
      staleTime: 1000 * 60 * 5, // 5 min before refetch
    },
  },
  queryCache: new QueryCache({ onError: handleQueryError }),
  mutationCache: new MutationCache({ onError: handleQueryError }),
});

// Persist cache to localStorage so data survives page reloads offline
export const QUERY_CACHE_LS_KEY = 'kodo-query-cache';

// Nota: createSyncStoragePersister NO impone ningún límite de tamaño real —
// el comentario anterior ("Max 4MB") era aspiracional, no una comprobación
// real. Si se supera la cuota del navegador (~5-10MB típico), el guardado
// falla en silencio (sin log ni aviso) y la app deja de actualizar su copia
// offline. throttleTime evita escribir en cada cambio, pero no evita el
// fallo por cuota.
const localStoragePersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: QUERY_CACHE_LS_KEY,
  throttleTime: 2000,
});

// logout() en AuthContext.jsx llama a queryClientInstance.clear() para
// vaciar la caché en memoria, pero el guardado a localStorage está
// throttled (hasta 2s de retraso) — si la página navega fuera antes de que
// se dispare ese guardado diferido, el contenido anterior queda intacto en
// disco pese a haber "cerrado sesión". Este helper borra la clave de
// localStorage de forma síncrona, sin depender del throttle.
export function clearPersistedQueryCache() {
  try {
    window.localStorage.removeItem(QUERY_CACHE_LS_KEY);
  } catch {
    // localStorage inaccesible (modo privado, cuota, etc.) — nada que limpiar.
  }
}

// Fix (24-ago): antes esto llamaba a persistQueryClient() directamente, que
// restaura la caché de forma asíncrona SIN que nada bloquee el primer
// render de la app — con conexión esto pasa desapercibido (todo vuelve a
// pedirse a la red igualmente), pero offline se convertía en una carrera de
// condición real: si una pantalla (p. ej. TripsList) lanzaba su query antes
// de que la restauración terminara, esa query fallaba sin red antes de que
// hubiera nada que mostrar, y para cuando la restauración sí completaba
// react-query no siempre volvía a pintar esos datos — resultado: "Crea tu
// primer viaje" con la app en modo offline aunque la caché sí tuviera el
// viaje guardado. persistOptions se exporta aquí para que App.jsx use
// PersistQueryClientProvider (mismo paquete, patrón oficial) en vez de
// QueryClientProvider — ese provider expone un estado "restaurando" que
// react-query respeta automáticamente: ninguna query dispara su fetch hasta
// que la restauración desde localStorage ha terminado.
export const persistOptions = {
  persister: localStoragePersister,
  // Keep cache for 24 hours
  maxAge: 1000 * 60 * 60 * 24,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      // Persist all successful queries. Auth itself isn't a react-query
      // query in this app (see AuthContext.jsx), so there's no key to
      // exclude here — the real safeguard against leaking one user's
      // cached data (trips, expenses, messages...) into the next session
      // on a shared device is clearing the whole cache on logout, done in
      // AuthContext.logout().
      return query.state.status === 'success';
    },
  },
};
