import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { appParams } from '@/lib/app-params';
import { base44 } from '@/api/base44Client';

const CALLBACK_URL = 'com.kaikodo.app://auth-callback';
// Fix (24-ago-2026, cierre completo del hallazgo #3): con Android App Links
// / iOS Universal Links configurados (AndroidManifest.xml,
// App.entitlements, public/.well-known/*), navegar a esta URL https hace
// que el sistema operativo abra la app nativa DIRECTAMENTE, sin pasar por
// ningún navegador ni mostrar ningún botón de "vuelve a la app" — eso solo
// se ve como respaldo (ver src/pages/AuthCallback.jsx) si la verificación
// del dominio todavía no está activa en ese dispositivo.
const HTTPS_CALLBACK_PATH = '/auth-callback';
// Fix (26-ago-2026): este link tiene que apuntar SIEMPRE al dominio propio
// verificado para Universal Links/App Links (kaikodo.app) -- nunca a
// appParams.appBaseUrl. Ese valor depende de donde se ejecute este mismo
// código: cuando relayNativeLoginIfNeeded() corre en el navegador externo
// tras volver de Google, puede estar cargando la copia de la web en el
// dominio temporal de Base44 (kodo-jc.base44.app), donde
// VITE_BASE44_APP_BASE_URL no está disponible -- appBaseUrl sale `null` y
// el link roto queda literalmente "null/auth-callback" (bug real visto en
// producción). Aunque esa variable sí tuviera valor, el sistema operativo
// solo intercepta este link como Universal Link en el dominio exacto que
// configuramos (kaikodo.app), así que hay que fijarlo aquí sí o sí.
const CUSTOM_DOMAIN = 'https://kaikodo.app';

// Fix (24-ago-2026, hallazgo crítico #3 de la auditoría 19-ago): antes este
// scheme llevaba el access_token real en texto plano
// (com.kaikodo.app://auth-callback?access_token=...). com.kaikodo.app:// es
// un custom scheme SIN verificar (no Android App Link con autoVerify, no
// iOS Universal Link) — en Android, cualquier otra app instalada puede
// declarar el mismo scheme y competir por recibir ese intent. Cierre
// completo necesitaría App Links/Universal Links verificados (huellas
// SHA256 del certificado de firma, fuera del alcance de este cambio).
// Mientras tanto, este fix cierra la fuga real (el token) con un
// intercambio de un solo uso estilo PKCE (RFC 7636): el "code" que sí viaja
// por el scheme sin verificar no vale nada por sí solo — canjearlo exige el
// code_verifier original, que nunca sale del almacenamiento local de esta
// misma app nativa. Una app maliciosa que intercepte el intent solo obtiene
// un código inútil sin el verifier.
const PKCE_VERIFIER_KEY = 'kodo_native_pkce_verifier';

export function isNative() {
        return Capacitor.isNativePlatform();
}

// --- PKCE helpers ---------------------------------------------------------

function randomVerifier() {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        return base64url(bytes);
}

function base64url(bytes) {
        let str = '';
        for (const b of bytes) str += String.fromCharCode(b);
        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64Url(input) {
        const data = new TextEncoder().encode(input);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return base64url(new Uint8Array(digest));
}

// --- Arranque del login nativo (se ejecuta dentro de la app nativa) ------

export async function openNativeLogin() {
        if (!isNative()) return;
        const returnUrl = `${appParams.appBaseUrl}/`;
        const loginUrl = `${appParams.appBaseUrl}/login?from_url=${encodeURIComponent(returnUrl)}`;
        try {
                    await Browser.open({ url: loginUrl });
        } catch {}
}

export async function openProviderLogin(provider = 'google') {
        if (!isNative()) return;

        const verifier = randomVerifier();
        try { localStorage.setItem(PKCE_VERIFIER_KEY, verifier); } catch {}
        const challenge = await sha256Base64Url(verifier);

        // El challenge (público, no el verifier) viaja embebido en from_url:
        // Base44 lo trata como URL de destino opaca y le añade access_token al
        // redirigir de vuelta tras el login, así que sobrevive el viaje de ida
        // y vuelta por el navegador externo sin que Base44 necesite soporte
        // especial para él.
        const returnUrl = `${appParams.appBaseUrl}/?native_pkce_challenge=${encodeURIComponent(challenge)}`;
        const providerPath = provider === 'google' ? '' : `/${provider}`;
        const loginUrl = `${appParams.appBaseUrl}/api/apps/auth${providerPath}/login?app_id=${appParams.appId}&from_url=${encodeURIComponent(returnUrl)}`;
        try {
                    await Browser.open({ url: loginUrl });
        } catch {}
}

function buildHttpsCallbackUrl(code) {
        return `${CUSTOM_DOMAIN}${HTTPS_CALLBACK_PATH}?code=${encodeURIComponent(code)}`;
}

function showBrokenRelayScreen(onFallback) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#faf7f2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px;text-align:center;';

const title = document.createElement('div');
        title.textContent = 'kaikodo';
        title.style.cssText = 'font-size:30px;font-weight:600;color:#181818;letter-spacing:-0.02em;';

const msg = document.createElement('div');
        msg.textContent = 'No se ha podido completar el inicio de sesion. Vuelve a la app e intentalo de nuevo.';
        msg.style.cssText = 'font-size:15px;color:#555;max-width:280px;';

const btn = document.createElement('button');
        btn.textContent = 'Entendido';
        btn.style.cssText = 'background:#c1541f;color:#fff;border:none;border-radius:999px;padding:14px 30px;font-size:16px;font-weight:600;';
        btn.onclick = () => {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    if (onFallback) onFallback();
        };

overlay.appendChild(title);
        overlay.appendChild(msg);
        overlay.appendChild(btn);
        document.body.appendChild(overlay);
}

async function exchangeChallengeForCode(challenge, accessToken) {
        try {
                    const res = await base44.functions.invoke('createNativeAuthCode', {
                                code_challenge: challenge,
                                access_token: accessToken,
                    });
                    return res?.data?.code || res?.code || null;
        } catch {
                    return null;
        }
}

// --- Vuelta del navegador externo tras el login (se ejecuta en el navegador
//     del sistema, NO dentro de la app nativa) -----------------------------

export function relayNativeLoginIfNeeded(onFallback) {
        if (typeof window === 'undefined') return false;
        if (isNative()) return false;
    // Fix: antes esto se disparaba con solo ver un base44_access_token en
    // localStorage, y ese token sigue ahi en cualquier visita futura de
    // alguien ya logueado (abrir el link de restablecer contrasena, volver
    // a entrar en la web dias despues...), no solo justo tras volver de
    // loguearse en el navegador nativo. Solo tiene sentido "volver a la app
    // nativa" si esta carga concreta acaba de recibir el token por la URL.
    if (!appParams.urlHadFreshAccessToken) return false;
        if (window.self !== window.top) return false;
        const token = localStorage.getItem('base44_access_token');
        if (!token) return false;

        const params = new URLSearchParams(window.location.search);
        const challenge = params.get('native_pkce_challenge');
        if (challenge) {
                    params.delete('native_pkce_challenge');
                    const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
                    window.history.replaceState({}, document.title, cleanUrl);
        }

        if (!challenge) {
                    // Sin challenge no significa "el login nativo falló" -- significa
                    // "esto no es un login nativo". Cualquier login normal en la propia
                    // web (p. ej. "Continuar con Google" en kaikodo.app desde un
                    // navegador de escritorio o móvil normal, sin pasar por la app)
                    // también deja un access_token fresco en la URL al volver, y antes
                    // esto disparaba la pantalla de error "no se pudo completar el
                    // inicio de sesión" sobre un login que en realidad había ido bien
                    // (bug ya presente antes de esta sesión). No hay nada que relayar
                    // aquí: se deja continuar el login web con normalidad.
                    return false;
        }

        exchangeChallengeForCode(challenge, token).then((code) => {
                    if (!code) {
                                showBrokenRelayScreen(onFallback);
                                return;
                    }
                    // Navegación real (no un overlay inyectado): si el dispositivo tiene
                    // el App Link/Universal Link verificado, el sistema operativo
                    // intercepta esto antes de que llegue a cargar como página y abre
                    // la app nativa directamente -- onFallback ni se llega a necesitar
                    // en ese caso. Si no se intercepta, carga de verdad
                    // /auth-callback (src/pages/AuthCallback.jsx), que muestra el
                    // mismo botón de respaldo de siempre.
                    window.location.href = buildHttpsCallbackUrl(code);
        });

        return true;
}

// --- Escucha en la app nativa de la vuelta del navegador -----------------

export function listenForLoginCallback(onToken) {
        if (!isNative()) return () => {};
        const handlePromise = App.addListener('appUrlOpen', ({ url }) => {
                    if (!url) return;
                    // Acepta tanto el custom scheme (com.kaikodo.app://auth-callback,
                    // respaldo) como el link https real (App Link/Universal Link,
                    // interceptado directamente por el sistema operativo antes de
                    // llegar a cargar como página) -- ambos llevan el mismo "code".
                    const isCustomScheme = url.startsWith(CALLBACK_URL);
                    const isHttpsCallback = url.startsWith(`${CUSTOM_DOMAIN}${HTTPS_CALLBACK_PATH}`);
                    if (!isCustomScheme && !isHttpsCallback) return;
                    try {
                                const parsed = new URL(url);
                                const code = parsed.searchParams.get('code');
                                if (!code) return;

                                let verifier = null;
                                try { verifier = localStorage.getItem(PKCE_VERIFIER_KEY); } catch {}
                                if (!verifier) return; // No es nuestro propio intento de login en curso: ignorar.
                                try { localStorage.removeItem(PKCE_VERIFIER_KEY); } catch {}

                                base44.functions.invoke('exchangeNativeAuthCode', { code, code_verifier: verifier })
                                            .then((res) => {
                                                        const token = res?.data?.access_token || res?.access_token || null;
                                                        if (token) {
                                                                    Browser.close().catch(() => {});
                                                                    onToken(token);
                                                        }
                                            })
                                            .catch(() => {});
                    } catch {}
        });
        return () => {
                    handlePromise.then(handle => handle.remove()).catch(() => {});
        };
}
