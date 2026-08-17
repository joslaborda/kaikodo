import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { appParams } from '@/lib/app-params';

const CALLBACK_URL = 'com.kaikodo.app://auth-callback';

export function isNative() {
        return Capacitor.isNativePlatform();
}

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
        const returnUrl = `${appParams.appBaseUrl}/`;
        const providerPath = provider === 'google' ? '' : `/${provider}`;
        const loginUrl = `${appParams.appBaseUrl}/api/apps/auth${providerPath}/login?app_id=${appParams.appId}&from_url=${encodeURIComponent(returnUrl)}`;
        try {
                    await Browser.open({ url: loginUrl });
        } catch {}
}

function buildCallbackUrl(token) {
        return `${CALLBACK_URL}?access_token=${encodeURIComponent(token)}`;
}

function showReturnToAppScreen(token, onFallback) {
        const callbackUrl = buildCallbackUrl(token);
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#faf7f2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px;text-align:center;';

const title = document.createElement('div');
        title.textContent = 'kaikodo';
        title.style.cssText = 'font-size:30px;font-weight:600;color:#181818;letter-spacing:-0.02em;';

const msg = document.createElement('div');
        msg.textContent = 'Sesion iniciada. Toca el boton para volver a la app.';
        msg.style.cssText = 'font-size:15px;color:#555;max-width:280px;';

const btn = document.createElement('button');
        btn.textContent = 'Volver a la app';
        btn.style.cssText = 'background:#c1541f;color:#fff;border:none;border-radius:999px;padding:14px 30px;font-size:16px;font-weight:600;';

const debug = document.createElement('div');
        debug.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;font-size:10px;color:#999;word-break:break-all;';
        debug.textContent = `debug: token=${token.slice(0, 10)}... native=${isNative()}`;

let finished = false;
        const finish = () => {
                    if (finished) return;
                    finished = true;
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    if (onFallback) onFallback();
        };

btn.onclick = () => {
        window.location.href = callbackUrl;
        setTimeout(finish, 1500);
};

overlay.appendChild(title);
        overlay.appendChild(msg);
        overlay.appendChild(btn);
        overlay.appendChild(debug);
        document.body.appendChild(overlay);

setTimeout(finish, 15000);
}

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
        try {
                    window.location.href = buildCallbackUrl(token);
        } catch {}
        showReturnToAppScreen(token, onFallback);
        return true;
}

export function listenForLoginCallback(onToken) {
        if (!isNative()) return () => {};
        const handlePromise = App.addListener('appUrlOpen', ({ url }) => {
                    if (!url || !url.startsWith(CALLBACK_URL)) return;
                    try {
                                    const parsed = new URL(url);
                                    const token = parsed.searchParams.get('access_token');
                                    if (token) {
                                                        Browser.close().catch(() => {});
                                                        onToken(token);
                                    }
                    } catch {}
        });
        return () => {
                    handlePromise.then(handle => handle.remove()).catch(() => {});
        };
}
