# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# --- Capacitor / plugins (añadido al activar minifyEnabled, 27-ago-2026) ---
# Capacitor 3.2.3+ trae sus propias reglas base para el bridge, pero hay un
# bug conocido y bien documentado (ionic-team/capacitor#5741) donde el
# release build igualmente falla en runtime con "Could not find class by
# class path: ...Plugin" si no se refuerza explícitamente. Sin esto, R8
# puede recortar/renombrar clases de plugin accedidas por reflexión desde el
# bridge JS<->nativo -- y como solo pasa en release (nunca en debug), es
# justo el tipo de rotura que no se ve hasta que ya está en Play Store.
-keep public class * extends com.getcapacitor.Plugin
-keep class com.getcapacitor.** { *; }
-dontwarn com.google.android.gms.**
# OneSignal (push) trae sus propias consumer-rules en el AAR, pero se
# refuerza igual como red de seguridad -- mismo motivo que arriba.
-keep class com.onesignal.** { *; }
# El proyecto usa onesignal-cordova-plugin (confirmado en package.json,
# via capacitor-cordova-android-plugins) -- NO extiende com.getcapacitor.
# Plugin como los plugins nativos de Capacitor, extiende
# org.apache.cordova.CordovaPlugin, así que necesita su propia regla.
-keep class org.apache.cordova.** { *; }

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
