import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@/i18n/index.js' // Initialize i18n before anything renders
import { initPushNotifications, clearDeliveredNotifications } from '@/lib/pushNotifications'
import { initNotificationTapHandler } from '@/lib/localReminders'
import { relayNativeLoginIfNeeded } from '@/lib/nativeAuth'

// No-op en web (PWA en navegador) - solo pide permiso y arranca OneSignal
// dentro del shell nativo de Capacitor. Ver src/lib/pushNotifications.js.
initPushNotifications()

// Deep-link al documento exacto al tocar un recordatorio de vuelo/tren/
// evento (ver src/lib/localReminders.js). Registrado aqui, antes de montar
// React, para no perder el toque cuando la app estaba completamente cerrada.
initNotificationTapHandler()

// Limpia notificaciones entregadas + badge del icono al arrancar (cubre el
// caso de que la app estuviera cerrada del todo cuando llegaron) y cada vez
// que vuelve a primer plano - evita que el badge se quede "pegado" con un
// numero aunque ya no haya nada pendiente dentro de la app. isNativePlatform
// ya se comprueba dentro de clearDeliveredNotifications, asi que en web/PWA
// esto no hace nada. El import dinamico evita cargar @capacitor/app (y
// romper el build de Base44, que no lo tiene instalado) fuera del shell nativo.
clearDeliveredNotifications()
if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
        import('@capacitor/app').then(({ App: CapacitorApp }) => {
                    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
                                    if (isActive) clearDeliveredNotifications()
                    })
        })
}

function mountApp() {
        ReactDOM.createRoot(document.getElementById('root')).render(
                    <App />
                    )
}

// relayNativeLoginIfNeeded() intenta saltar al esquema personalizado desde
// el navegador in-app tras el login (ver src/lib/nativeAuth.js). Si lo
// consigue, no montamos React aqui - pero le pasamos mountApp como red de
// seguridad para que, si el salto no lo recoge nadie, la app se monte
// igualmente pasado un instante en vez de quedarse en blanco para siempre.
if (!relayNativeLoginIfNeeded(mountApp)) {
        mountApp()
}
