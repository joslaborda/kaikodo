const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

const toSnakeCase = (str) => {
		return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
		if (isNode) {
					return defaultValue;
		}
		const storageKey = `base44_${toSnakeCase(paramName)}`;
		const urlParams = new URLSearchParams(window.location.search);
		const searchParam = urlParams.get(paramName);
		if (removeFromUrl) {
					urlParams.delete(paramName);
					const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
															   }${window.location.hash}`;
					window.history.replaceState({}, document.title, newUrl);
		}
		if (searchParam) {
					storage.setItem(storageKey, searchParam);
					return searchParam;
		}
		if (defaultValue) {
					storage.setItem(storageKey, defaultValue);
					return defaultValue;
		}
		const storedValue = storage.getItem(storageKey);
		if (storedValue) {
					return storedValue;
		}
		return null;
}

// José (17 sep 2026) — hallazgo CRÍTICO del escáner de seguridad de Base44:
// `app_base_url` se leía como cualquier otro parámetro genérico de arriba
// (URL -> localStorage -> se usa como serverUrl del SDK en base44Client.js,
// ver ahí, Y como el host base del login nativo en nativeAuth.js). Eso
// significa que un enlace tipo
// "https://kaikodo.app/?app_base_url=https://dominio-malicioso.com" hacía
// que TODAS las peticiones futuras del SDK -- incluido el Bearer token de
// sesión en cada llamada -- se mandaran a ese dominio en vez de a Base44, y
// quedaba guardado en el propio localStorage del dispositivo, así que
// seguía activo en visitas posteriores aunque la víctima no volviera a
// tocar el enlace.
//
// No se puede simplemente ignorar siempre este parámetro y forzar cadena
// vacía (mismo origen): nativeAuth.js (openNativeLogin/openProviderLogin)
// necesita de verdad que esto apunte al host real de la API de Base44 (NO
// a kaikodo.app) para poder abrir el login nativo en el navegador del
// sistema -- y ese host cambia según dónde se sirva esta misma build (ver
// comentario de nativeAuth.js sobre el dominio temporal
// "kodo-jc.base44.app"). Forzarlo a '' rompería el login nativo por
// completo.
//
// El arreglo correcto es una lista blanca con new URL() (nunca regex, ver
// codebase-rules): solo se acepta un valor que sea realmente un host de
// Base44 (termina en ".base44.app") o el propio dominio de la app
// (kaikodo.app) -- cualquier otra cosa (el ataque de arriba, o basura) se
// descarta y se cae al valor seguro por defecto ('', mismo origen). Se
// limpia también cualquier valor ya envenenado que hubiera quedado en
// localStorage de una visita anterior a un enlace malicioso.
const TRUSTED_APP_BASE_URL_SUFFIXES = ['.base44.app', 'kaikodo.app'];
function isTrustedAppBaseUrl(value) {
		if (!value) return false;
		try {
					const host = new URL(value).hostname;
					return TRUSTED_APP_BASE_URL_SUFFIXES.some(
								suffix => host === suffix || host.endsWith(suffix.startsWith('.') ? suffix : `.${suffix}`)
					);
		} catch {
					return false;
		}
}
const getSafeAppBaseUrl = () => {
		const candidate = getAppParamValue("app_base_url");
		if (isTrustedAppBaseUrl(candidate)) return candidate;
		if (candidate && !isNode) {
					// Descartado por no ser un host de confianza -- limpia el rastro en
					// vez de dejarlo ahí para la próxima carga.
					try { storage.removeItem('base44_app_base_url'); } catch {}
		}
		return '';
}

const getAppParams = () => {
		if (getAppParamValue("clear_access_token") === 'true') {
					storage.removeItem('base44_access_token');
					storage.removeItem('token');
		}
		const urlHadFreshAccessToken = !isNode && new URLSearchParams(window.location.search).has('access_token');
		return {
					appId: getAppParamValue("app_id", { defaultValue: import.meta.env.VITE_BASE44_APP_ID }),
					token: getAppParamValue("access_token", { removeFromUrl: true }),
					fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
					functionsVersion: getAppParamValue("functions_version", { defaultValue: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION }),
					appBaseUrl: getSafeAppBaseUrl(),
					urlHadFreshAccessToken,
		}
}


export const appParams = {
		...getAppParams()
}
Object.defineProperty(appParams, 'token', {
			get() {
									if (isNode) return null;
									return storage.getItem('base44_access_token');
			},
			set(value) {
									if (isNode) return;
									if (value) {
																			storage.setItem('base44_access_token', value);
																			storage.setItem('token', value);
									} else {
																			storage.removeItem('base44_access_token');
									}
			},
			enumerable: true,
			configurable: true,
});
