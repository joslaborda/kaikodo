import { Pencil, Navigation } from 'lucide-react';
import GooglePlaceCard, { googlePlaceIdOf, isGoogleCardControl } from './GooglePlaceCard';
import { TYPE_CONFIG, getMapsUrl } from './spotsHelpers';
import { useTranslation } from 'react-i18next';

// Fila de comentarios eliminada (14 sep 2026) -- ver comentario en
// SpotCard.jsx sobre por qué se quitó la función de comentarios de spots.

export default
function MySpotRow({ spot, onTap }) {
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
        <GooglePlaceCard placeId={placeId} variant="compact" fallback={ownHeader} />
        {hasDate && (
          <p className="text-xs text-primary mt-0.5 flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {spot.assigned_date}
          </p>
        )}
      </button>

      {/* Categoría · ciudad, estado del día y Cómo llegar en una sola línea. */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-1">
        <button type="button" onClick={() => onTap(spot)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
          <span className="text-xs text-muted-foreground truncate">
            {t(tc.tk)}
            {spot.city_name ? ' · ' + spot.city_name : ''}
          </span>
          {spot.visited ? (
            <span className="shrink-0 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{t('spots.card.visited')}</span>
          ) : isStay ? (
            <span className="shrink-0 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">{t('spots.stayBadge')}</span>
          ) : hasDate ? (
            <span className="shrink-0 text-xs bg-orange-100 text-primary px-2 py-0.5 rounded-full font-medium">{t('spots.assigned')}</span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground/60">{t('spots.noDay')}</span>
          )}
          <Pencil className="shrink-0 w-3.5 h-3.5 text-muted-foreground/40" />
        </button>
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
