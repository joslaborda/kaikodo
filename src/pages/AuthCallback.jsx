import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

const NATIVE_SCHEME_CALLBACK = 'com.kaikodo.app://auth-callback';

/**
 * AuthCallback — página real en https://kaikodo.app/auth-callback.
 *
 * Por qué existe: con Android App Links / iOS Universal Links configurados
 * (ver AndroidManifest.xml, App.entitlements, public/.well-known/*), el
 * sistema operativo intercepta un enlace a esta URL ANTES de que llegue a
 * cargarse como página web — abre la app nativa directamente, sin pasar por
 * aquí y sin ningún botón que tocar. Esta página solo se ve de verdad
 * cuando esa interceptación no ocurre: verificación aún no propagada,
 * SHA256/Team ID todavía no configurados, o un dispositivo/navegador que no
 * la soporta. Es el mismo overlay de "vuelve a la app" que antes vivía
 * inyectado a mano dentro de nativeAuth.js, ahora como una página real
 * (necesaria porque un enlace https, a diferencia del custom scheme de
 * antes, si no se intercepta CARGA como página normal en vez de quedarse
 * "colgado" esperando).
 *
 * Interceptada en App.jsx antes del gate de auth (igual que
 * ForgotPassword/ResetPassword) porque llega sin sesión activa.
 */
export default function AuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const target = code ? `${NATIVE_SCHEME_CALLBACK}?code=${encodeURIComponent(code)}` : null;

  useEffect(() => {
    // Si esto carga DENTRO de la app nativa (no debería pasar -- el
    // WebView de la app no navega aquí por su cuenta), no hay nada que
    // relayar: listenForLoginCallback ya captura la apertura del enlace
    // directamente, sin pasar por esta página.
    if (Capacitor.isNativePlatform()) return;
    if (!target) return;
    // Intento automático de volver a la app -- el botón de abajo es el
    // respaldo si el navegador bloquea la redirección automática al
    // custom scheme (algunos exigen un toque explícito del usuario).
    try { window.location.href = target; } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#faf7f2', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 30, fontWeight: 600, color: '#181818', letterSpacing: '-0.02em' }}>kaikodo</div>
      {target ? (
        <>
          <div style={{ fontSize: 15, color: '#555', maxWidth: 280 }}>Sesión iniciada. Toca el botón para volver a la app.</div>
          <button
            type="button"
            onClick={() => { window.location.href = target; }}
            style={{ background: '#c1541f', color: '#fff', border: 'none', borderRadius: 999, padding: '14px 30px', fontSize: 16, fontWeight: 600 }}
          >
            Volver a la app
          </button>
        </>
      ) : (
        <div style={{ fontSize: 15, color: '#555', maxWidth: 280 }}>No se ha podido completar el inicio de sesión. Vuelve a la app e inténtalo de nuevo.</div>
      )}
    </div>
  );
}
