import { WifiOff, Navigation } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// José (21 sep 2026, probando offline en el build nativo): sin conexión el mapa
// caía a Leaflet, que también necesita internet para bajar sus teselas — solo
// se veía un rectángulo vacío y con otro estilo. Sin conexión no se dibuja
// ningún mapa: se enseñan los sitios de igual forma, con "Cómo llegar", que abre
// la app de mapas del móvil (esa sí puede tener mapas descargados).
//
// points: [{ key, label, lat, lng, badge? }]
export default function OfflineMapNotice({ points = [], className = '' }) {
  const { t } = useTranslation();
  return (
    <div className={`rounded-2xl border border-border bg-card p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
          <WifiOff className="w-4 h-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground leading-tight">{t('offline.mapUnavailable')}</p>
          <p className="text-xs text-muted-foreground">{t('offline.mapUnavailableHint')}</p>
        </div>
      </div>
      <div className="divide-y divide-border">
        {points.map((p) => (
          <div key={p.key} className="flex items-center gap-3 py-2">
            {p.badge != null && (
              <span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-semibold flex items-center justify-center shrink-0">{p.badge}</span>
            )}
            <span className="flex-1 min-w-0 text-sm text-foreground truncate">{p.label}</span>
            <a href={`https://maps.google.com/?q=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary font-medium shrink-0">
              <Navigation className="w-3.5 h-3.5" />{t('spots.sheet.directions')}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
