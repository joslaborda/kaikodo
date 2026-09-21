import { useState, useEffect, useRef } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle, WifiOff, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

// Antes: montado activamente en Layout.jsx pero con todo el texto en
// español fijo (a diferencia de su vecino OfflineIndicator.jsx, que sí
// estaba traducido) — un usuario en inglés lo veía en español.
export default function SyncIndicator() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  // José (21 sep 2026): esta tarjeta de "Modo offline" no tenía forma de cerrarse y
  // tapaba la pantalla mientras no hubiera red. Ahora se puede cerrar (X) y se
  // esconde sola a los 8 s; vuelve a aparecer solo si se pierde y se recupera la red.
  const [dismissed, setDismissed] = useState(false);
  const queryClient = useQueryClient();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      setDismissed(false);
      const id = setTimeout(() => setDismissed(true), 8000);
      return () => clearTimeout(id);
    }
    if (!wasOffline.current) return undefined;
    wasOffline.current = false;
    let cancelled = false;
    (async () => {
      setIsSyncing(true);
      await queryClient.invalidateQueries(); // datos frescos al recuperar la red
      if (cancelled) return;
      setIsSyncing(false);
      setLastSync(new Date());
      setTimeout(() => setLastSync(null), 3000);
    })();
    return () => { cancelled = true; };
  }, [isOnline, queryClient]);

  // Check what's cached
  const queryCache = queryClient.getQueryCache();
  const cachedQueries = queryCache.getAll();
  const syncedEntities = cachedQueries
    .filter(q => q.state.data)
    .map(q => q.queryKey[0])
    .filter((v, i, a) => a.indexOf(v) === i);

  return (
    <AnimatePresence>
      {((!isOnline && !dismissed) || isSyncing || lastSync) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-24 md:bottom-4 left-4 z-40 max-w-xs"
        >
          <div className="bg-white/95 dark:bg-muted/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-border dark:border-border p-4">
            {!isOnline && (
              <div className="flex items-start gap-3">
                <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                  <WifiOff className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <button onClick={() => setDismissed(true)} aria-label={t('common.close')}
                    className="float-right -mt-1 -mr-1 ml-2 w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <p className="font-semibold text-foreground dark:text-white text-sm">
                    {t('syncIndicator.offline')}
                  </p>
                  <p className="text-xs text-foreground dark:text-muted-foreground mt-1">
                    {t('syncIndicator.synced', { count: syncedEntities.length })}
                  </p>
                </div>
              </div>
            )}

            {isSyncing && (
              <div className="flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />
                <div>
                  <p className="font-semibold text-foreground dark:text-white text-sm">
                    {t('syncIndicator.syncing')}
                  </p>
                  <p className="text-xs text-foreground dark:text-muted-foreground">
                    {t('syncIndicator.updatingData')}
                  </p>
                </div>
              </div>
            )}

            {lastSync && !isSyncing && (
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-semibold text-foreground dark:text-white text-sm">
                    {t('syncIndicator.synced2')}
                  </p>
                  <p className="text-xs text-foreground dark:text-muted-foreground">
                    {t('syncIndicator.allUpToDate')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}