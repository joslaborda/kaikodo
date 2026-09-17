import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kaikodo.app',
  appName: 'Kaikōdo',
  webDir: 'dist',
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    // overlay:false reserva el espacio de la barra de estado (no se pinta
    // encima del contenido) y le da el mismo fondo que el resto de la app
    // (--kodo-bg / #f8f6f3). style:'LIGHT' pone los iconos (hora,
    // batería...) en oscuro, legibles sobre ese fondo claro.
    StatusBar: {
      overlay: false,
      style: 'LIGHT',
      backgroundColor: '#f8f6f3'
    }
  }
};

export default config;