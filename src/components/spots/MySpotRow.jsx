import { Navigation } from 'lucide-react';
import GooglePlaceCard, { googlePlaceIdOf, isGoogleCardControl } from './GooglePlaceCard';
import { TYPE_CONFIG, getMapsUrl } from './spotsHelpers';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// Fila de comentarios eliminada (14 sep 2026) -- ver comentario en
// SpotCard.jsx sobre por qué se quitó la función de comentarios de spots.

export default
function MySpotRow({ spot, onTap, onAssignDay }) {
  const { t } = useTranslation();
  const tc = TYPE_CONFIG[spot.type] || TYPE_CONFIG.custom;

  // Un alojamiento no se asigna a un día (src/lib/cityStay.js): nunca "Sin día".
  const isStay = spot.type === 'hotel';
  const hasDate = !isStay && !!spot.assigned_date;
  const placeId = googlePlaceIdOf(spot);
  const online = useOnlineStatus();
  // Con ficha de Google, su botón "Maps" ya lleva al sitio y la ficha ya
  // dice qué es: categoría · ciudad y "Cómo llegar" solo sin ficha (spot
  // manual o sin conexión, donde Cómo llegar abre los mapas offline del móvil).
  const showOwnMeta = !placeId || !online;

  // José (23 sep 2026): términos EEA de Google Maps Platform. Nombre, foto y
  // estrellas de un sitio de Google los pinta Google (Places UI Kit, carga
  // diferida), no salen de nuestra base de datos. Sin place id (spot manual)
  // o sin conexión se ve la fila de siempre con los datos propios del spot.
  const ownHeader = (
    <div className="flex items-center gap-3 min-w-0">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tc.color}`}>{tc.Icon && <tc.Icon size={16} />}</div>
      <p className={`text-sm font-medium truncate ${spot.visited ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
        {spot.title}
      </p>
    </div>
  );

  // "Asignar día": botón visible en el estilo de la app. NO abre la ficha del
  // spot (cada ficha de Google que se carga se cobra): abre directamente el
  // selector de día y hora.
  const dayControl = spot.visited ? (
    <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">{t('spots.card.visited')}</span>
  ) : isStay ? (
    <span className="text-xs bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full font-medium">{t('spots.stayBadge')}</span>
  ) : (
    <button type="button" onClick={() => (onAssignDay ? onAssignDay(spot) : onTap(spot))}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary bg-card border border-primary rounded-full px-3 py-1.5 hover:bg-orange-50 transition-colors">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      {hasDate ? spot.assigned_date : t('spots.assignDayBtn')}
    </button>
  );

  return (
    <div className="relative bg-card border-b border-border last:border-0">
      {/* Fila pulsable: abre el detalle del spot. */}
      <button onClick={e => { if (isGoogleCardControl(e)) return; onTap(spot); }}
        className={`w-full block px-4 pt-3 text-left hover:bg-secondary/20 transition-colors ${showOwnMeta ? 'pb-1' : 'pb-3'}`}>
        <GooglePlaceCard placeId={placeId} variant="compact" orientation="horizontal" fallback={ownHeader} />
      </button>

      {showOwnMeta ? (
        // Sin ficha de Google (spot manual o sin conexión): categoría · ciudad,
        // Cómo llegar (abre los mapas del móvil, útil offline) y el botón.
        <div className="flex items-center gap-3 px-4 pb-3 pt-1">
          <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
            {t(tc.tk)}
            {spot.city_name ? ' · ' + spot.city_name : ''}
          </span>
          {(spot.address || (spot.lat && spot.lng)) && (
            <a href={getMapsUrl(spot)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors p-1 -m-1 rounded-lg">
              <Navigation className="w-3.5 h-3.5" />{t('spots.sheet.directions')}
            </a>
          )}
          {dayControl}
        </div>
      ) : (
        // José (23 sep 2026): con ficha de Google, el botón va en el hueco de
        // abajo a la derecha de la ficha, a la altura de "Google Maps" (esa
        // línea solo tiene la atribución a la izquierda, así que no tapa nada
        // de Google). La card queda con la altura de la ficha.
        <div className="absolute right-4 bottom-4">{dayControl}</div>
      )}
    </div>
  );
}
