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
					appBaseUrl: getAppParamValue("app_base_url", { defaultValue: import.meta.env.VITE_BASE44_APP_BASE_URL }),
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
