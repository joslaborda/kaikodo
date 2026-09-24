import { Capacitor, registerPlugin } from '@capacitor/core';

// José (24 sep 2026): puente al reconocimiento y la lectura de voz NATIVOS
// del móvil (plugin propio de la app, "KaikodoSpeech"):
//  - Android: android/app/src/main/java/com/kaikodo/app/KaikodoSpeechPlugin.java
//  - iOS:     ios/App/App/AppDelegate.swift (clase KaikodoSpeechPlugin)
// Dentro de la app nativa, el reconocimiento de voz del WebView no sirve
// (Android no lo trae; en iOS daba "permiso denegado" sin llegar a pedirlo).
// En la web se sigue usando la Web Speech API del navegador.

const KaikodoSpeech = registerPlugin('KaikodoSpeech');

export function isNativeSpeechAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('KaikodoSpeech');
}

export async function requestSpeechAccess() {
  return KaikodoSpeech.requestAccess();
}

// Empieza a escuchar. onText recibe TODO lo reconocido hasta ahora; onError
// recibe un código ('not-allowed' | 'unavailable' | 'no-speech' | 'network' |
// 'error'). Devuelve { stop } -> Promise<string> con el texto final.
export async function startNativeListening({ lang, onText, onError }) {
  const handles = [];
  const cleanup = () => { handles.splice(0).forEach(h => { try { h.remove(); } catch { /* noop */ } }); };
  handles.push(await KaikodoSpeech.addListener('result', e => onText?.(e?.text || '')));
  handles.push(await KaikodoSpeech.addListener('error', e => { cleanup(); onError?.(e?.code || 'error'); }));
  try {
    await KaikodoSpeech.start({ lang });
  } catch (e) {
    cleanup();
    throw e;
  }
  return {
    stop: async () => {
      try {
        const res = await KaikodoSpeech.stop();
        return res?.text || '';
      } finally {
        cleanup();
      }
    },
  };
}

export function nativeSpeak(text, lang, rate = 0.9) {
  return KaikodoSpeech.speak({ text, lang, rate }).catch(() => {});
}

export function nativeStopSpeaking() {
  return KaikodoSpeech.stopSpeaking().catch(() => {});
}
