import { useState, useEffect, useRef } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { WifiOff, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function OfflineIndicator() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOffline = useRef(false);

  // "Conexión restaurada" durante 3 s cuando se vuelve a tener red.
  useEffect(() => {
    if (!isOnline) { wasOffline.current = true; setShowReconnected(false); return undefined; }
    if (wasOffline.current) {
      wasOffline.current = false;
      setShowReconnected(true);
      const id = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [isOnline]);

  if (isOnline && !showReconnected) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[9999] px-4 py-3 flex items-center justify-center gap-2 shadow-lg transition-all duration-300 ${
        showReconnected
          ? 'bg-green-600 text-white'
          : 'bg-gray-900 text-white'
      }`}
    >
      {showReconnected ? (
        <>
          <Wifi className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">{t('offline.restored')}</span>
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">{t('offline.offline')}</span>
        </>
      )}
    </div>
  );
}
