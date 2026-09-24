package com.kaikodo.app;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

/**
 * José (24 sep 2026): traductor por voz nativo.
 *
 * El WebView de Android no trae reconocimiento de voz (webkitSpeechRecognition
 * no funciona dentro de una app) ni síntesis de voz fiable, así que el
 * traductor por voz no podía funcionar en Android. Este plugin usa el
 * SpeechRecognizer y el TextToSpeech del propio sistema.
 *
 * API (idéntica en iOS, ver KaikodoSpeechPlugin en AppDelegate.swift):
 *  - requestAccess()      -> { granted, available }
 *  - start({ lang })      -> empieza a escuchar; emite 'result' { text }
 *                            con TODO lo dicho hasta ahora (no por trozos)
 *  - stop()               -> { text } final
 *  - speak({ text, lang, rate }) / stopSpeaking()
 *  - evento 'error' { code }: 'not-allowed' | 'unavailable' | 'network' | 'error'
 *
 * El reconocedor de Android se corta solo tras un silencio. Mientras el
 * usuario no pulse "parar", se vuelve a lanzar y se va acumulando el texto,
 * para que se comporte como el modo continuo de la web.
 */
@CapacitorPlugin(
    name = "KaikodoSpeech",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class KaikodoSpeechPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean active = false;
    private String lang = "es-ES";
    private final StringBuilder committed = new StringBuilder();
    private String partial = "";
    private int clientErrors = 0;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    // ── Permisos ───────────────────────────────────────────────────────────────
    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            resolveAccess(call, true);
        } else {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
        }
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        resolveAccess(call, getPermissionState("microphone") == PermissionState.GRANTED);
    }

    private void resolveAccess(PluginCall call, boolean granted) {
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(ret);
    }

    // ── Reconocimiento ─────────────────────────────────────────────────────────
    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("not-allowed", "not-allowed");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("unavailable", "unavailable");
            return;
        }
        lang = call.getString("lang", "es-ES");
        main.post(() -> {
            try {
                destroyRecognizer();
                committed.setLength(0);
                partial = "";
                clientErrors = 0;
                active = true;
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(listener);
                listen();
                call.resolve();
            } catch (Exception e) {
                active = false;
                call.reject("error", "error");
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            active = false;
            String text = fullText();
            destroyRecognizer();
            JSObject ret = new JSObject();
            ret.put("text", text);
            call.resolve(ret);
        });
    }

    private void listen() {
        if (recognizer == null) return;
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        recognizer.startListening(intent);
    }

    private void relisten() {
        if (!active) return;
        main.postDelayed(() -> {
            if (!active || recognizer == null) return;
            try { recognizer.cancel(); listen(); } catch (Exception ignored) { }
        }, 150);
    }

    private String fullText() {
        String base = committed.toString().trim();
        String p = partial == null ? "" : partial.trim();
        if (p.isEmpty()) return base;
        return base.isEmpty() ? p : base + " " + p;
    }

    private void emitText() {
        JSObject ev = new JSObject();
        ev.put("text", fullText());
        notifyListeners("result", ev);
    }

    private void emitError(String code) {
        active = false;
        destroyRecognizer();
        JSObject ev = new JSObject();
        ev.put("code", code);
        notifyListeners("error", ev);
    }

    private static String first(Bundle b) {
        if (b == null) return "";
        ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return (list == null || list.isEmpty() || list.get(0) == null) ? "" : list.get(0);
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int eventType, Bundle params) { }

        @Override public void onPartialResults(Bundle b) {
            if (!active) return;
            clientErrors = 0;
            partial = first(b);
            emitText();
        }

        @Override public void onResults(Bundle b) {
            if (!active) return;
            clientErrors = 0;
            String seg = first(b).trim();
            if (!seg.isEmpty()) {
                if (committed.length() > 0) committed.append(' ');
                committed.append(seg);
            }
            partial = "";
            emitText();
            relisten();
        }

        @Override public void onError(int error) {
            if (!active) return;
            switch (error) {
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                case SpeechRecognizer.ERROR_CLIENT:
                    // El reconocedor se ha quedado en mal estado: se recrea. Si
                    // pasa muchas veces seguidas, se para con error en vez de
                    // quedarse en bucle.
                    if (++clientErrors > 5) { emitError("error"); break; }
                    destroyRecognizer();
                    try {
                        recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                        recognizer.setRecognitionListener(this);
                    } catch (Exception e) { emitError("error"); break; }
                    relisten();
                    break;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                    // Silencio: se sigue escuchando mientras no pulsen parar.
                    if (partial != null && !partial.trim().isEmpty()) {
                        if (committed.length() > 0) committed.append(' ');
                        committed.append(partial.trim());
                        partial = "";
                    }
                    relisten();
                    break;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                    emitError("not-allowed");
                    break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                case SpeechRecognizer.ERROR_SERVER:
                    emitError("network");
                    break;
                default:
                    emitError("error");
            }
        }
    };

    private void destroyRecognizer() {
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) { }
            try { recognizer.destroy(); } catch (Exception ignored) { }
            recognizer = null;
        }
    }

    // ── Lectura en voz alta ────────────────────────────────────────────────────
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String l = call.getString("lang", "es-ES");
        Double rate = call.getDouble("rate", 0.9);
        if (text == null || text.trim().isEmpty()) { call.resolve(); return; }
        main.post(() -> {
            if (tts != null && ttsReady) {
                say(text, l, rate);
                call.resolve();
                return;
            }
            tts = new TextToSpeech(getContext(), status -> {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (ttsReady) { say(text, l, rate); call.resolve(); }
                else call.reject("unavailable", "unavailable");
            });
        });
    }

    private void say(String text, String l, Double rate) {
        tts.setLanguage(Locale.forLanguageTag(l));
        tts.setSpeechRate(rate == null ? 0.9f : rate.floatValue());
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "kaikodo-tts");
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        main.post(() -> { if (tts != null) tts.stop(); call.resolve(); });
    }

    @Override
    protected void handleOnDestroy() {
        active = false;
        main.post(() -> {
            destroyRecognizer();
            if (tts != null) { tts.shutdown(); tts = null; ttsReady = false; }
        });
    }
}
