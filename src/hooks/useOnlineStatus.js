import { useState, useEffect } from 'react';

// José (21 sep 2026, probando el build nativo): el aviso "Modo offline" no se
// podía quitar. Toda la app leía navigator.onLine una vez y solo cambiaba con los
// eventos 'online'/'offline' — en el WebView del móvil esos eventos a veces no
// llegan (al volver de segundo plano o al cambiar de wifi a datos), y el estado
// se quedaba en "sin conexión" para siempre aunque hubiera red.
//
// Un solo sitio para saber si hay conexión, y con red de seguridad:
//  · navigator.onLine + eventos, como antes;
//  · al volver a primer plano se vuelve a mirar;
//  · mientras se cree "sin conexión", cada pocos segundos se comprueba de verdad
//    (una petición mínima a un servidor externo): si responde, hay red y se sale
//    del modo offline aunque el navegador no lo haya avisado.
// La comprobación es a un host externo a propósito: en la app nativa la propia
// web vive en local y una petición a ella siempre "funcionaría" sin red.
const PROBE_URL = 'https://www.gstatic.com/generate_204';

async function reallyOnline() {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
  try {
    await fetch(PROBE_URL, { mode: 'no-cors', cache: 'no-store', signal: ctrl?.signal });
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    const recheck = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, []);

  // Red de seguridad: si se cree offline, comprobarlo de verdad de vez en cuando.
  useEffect(() => {
    if (online) return undefined;
    let cancelled = false;
    const probe = async () => { if (await reallyOnline() && !cancelled) setOnline(true); };
    probe();
    const id = setInterval(probe, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [online]);

  return online;
}
