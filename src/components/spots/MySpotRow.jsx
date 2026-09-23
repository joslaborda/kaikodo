import { Pencil, Navigation } from 'lucide-react';
import GooglePlaceCard, { googlePlaceIdOf } from './GooglePlaceCard';
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
      <button onClick={() => onTap(spot)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/20 transition-colors">
        <div className="flex-1 min-w-0">
          <GooglePlaceCard placeId={placeId} variant="compact" interactive={false} fallback={ownHeader} />
          <p className="text-xs text-muted-foreground mt-0.5">
            {t(tc.tk)}
            {spot.city_name ? ' · ' + spot.city_name : ''}
          </p>
          {hasDate && (
            <p className="text-xs text-primary mt-0.5 flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {spot.assigned_date}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {spot.visited ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{t('spots.card.visited')}</span>
          ) : isStay ? (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">{t('spots.stayBadge')}</span>
          ) : hasDate ? (
            <span className="text-xs bg-orange-100 text-primary px-2 py-0.5 rounded-full font-medium">{t('spots.assigned')}</span>
          ) : (
            <span className="text-xs text-muted-foreground/60">{t('spots.noDay')}</span>
          )}
          <Pencil className="w-3.5 h-3.5 text-muted-foreground/40" />
        </div>
      </button>

      {/* Cómo llegar (el Like se quitó el 23 sep 2026: no tenía uso en un viaje) */}
      <div className="flex items-center gap-4 px-4 pb-3">
        {(spot.address || (spot.lat && spot.lng)) && (
          <a href={getMapsUrl(spot)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors p-1 -m-1 rounded-lg ml-auto">
            <Navigation className="w-3.5 h-3.5" />{t('spots.sheet.directions')}
          </a>
        )}
      </div>
    </div>
  );
}
