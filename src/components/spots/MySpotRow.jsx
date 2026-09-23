import { Navigation } from 'lucide-react';
import GooglePlaceCard, { googlePlaceIdOf, isGoogleCardControl } from './GooglePlaceCard';
import { TYPE_CONFIG, getMapsUrl } from './spotsHelpers';
import { useTranslation } from 'react-i18next';

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

  return (
    <div className="bg-card border-b border-border last:border-0">
      {/* Main row — clickable to open sheet */}
      {/* José (23 sep 2026): la ficha de Google ocupa TODO el ancho de la fila.
          En móvil, con "Sin día" y el lápiz a su derecha, se quedaba estrecha
          y Google oculta la foto en fichas estrechas; el estado y el lápiz
          bajan a la línea de abajo, junto a categoría · ciudad y Cómo llegar. */}
      <button onClick={e => { if (isGoogleCardControl(e)) return; onTap(spot); }} className="w-full block px-4 pt-3 pb-1 text-left hover:bg-secondary/20 transition-colors">
        {/* Vertical: foto arriba a todo lo ancho. En horizontal, en móvil,
            Google no enseñaba la foto (José, 23 sep 2026). */}
        <GooglePlaceCard placeId={placeId} variant="compact" orientation="vertical" fallback={ownHeader} />
      </button>

      {/* José (23 sep 2026): "Asignar día" es un botón visible en el estilo de
          la app (borde naranja, fondo blanco) y NO abre la ficha del spot --
          abre directamente el selector de día (cada ficha de Google que se
          carga se cobra). Debajo, categoría · ciudad y Cómo llegar. */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-1">
        {spot.visited ? (
          <span className="shrink-0 text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">{t('spots.card.visited')}</span>
        ) : isStay ? (
          <span className="shrink-0 text-xs bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full font-medium">{t('spots.stayBadge')}</span>
        ) : (
          <button type="button" onClick={() => (onAssignDay ? onAssignDay(spot) : onTap(spot))}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-primary bg-card border border-primary rounded-full px-3 py-1.5 hover:bg-orange-50 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {hasDate ? spot.assigned_date : t('spots.assignDayBtn')}
          </button>
        )}
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
      </div>
    </div>
  );
}
