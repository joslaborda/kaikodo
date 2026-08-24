import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { isNative, openProviderLogin } from '@/lib/nativeAuth';
import KaikodoCaptcha from '@/components/auth/KaikodoCaptcha';
import Logo from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

// Icono de Google — SVG oficial de 4 colores, sin depender de ningún paquete
// de iconos extra solo para este botón.
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 6.1 29.5 4 24 4 16.1 4 9.2 8.5 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.3 35.7 26.8 36.5 24 36.5c-5.2 0-9.6-3.5-11.2-8.3l-6.5 5C9.1 39.5 16 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.9 2.6-2.7 4.8-5 6.3l6.2 5.2C39.8 36.8 43 31 43 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}

// Extrae un mensaje legible de un error del SDK de base44 (createAxiosClient
// suele adjuntar { status, data: { message } }) sin reventar si el shape es
// distinto (p. ej. un error de red plano de axios/fetch).
function extractErrorMessage(err, fallback) {
    return fallback || err?.data?.message || err?.message || 'Error';
}

/**
 * LoginScreen — pantalla de login/registro propia de Kaikōdo, construida
 * directamente sobre el SDK de base44 (auth.loginViaEmailPassword,
 * auth.register + auth.verifyOtp, auth.resetPasswordRequest,
 * auth.loginWithProvider) en vez de depender de la pantalla /login
 * genérica hospedada por base44 (flujo "Pública, inicio de sesión
 * requerido", ahora marcado como obsoleto en el propio panel de base44).
 *
 * Se monta directamente en App.jsx cuando authError.type === 'auth_required'
 * (ver AuthenticatedApp) — sustituye al antiguo navigateToLogin() que sacaba
 * al usuario de la app. Tras un login/registro con éxito, llama a onSuccess
 * (checkAppState de AuthContext) para que la app vuelva a comprobar el
 * estado de auth y monte el resto de la app con normalidad.
 *
 * Google en la app nativa (iOS/Capacitor) no puede hacerse con un
 * window.location.href normal dentro del WebView (Google bloquea OAuth
 * embebido en WebViews) — reutiliza el mismo mecanismo de navegador in-app +
 * relay por custom URL scheme que ya usa el login por email/password nativo
 * (ver src/lib/nativeAuth.js, openProviderLogin). El login por email/
 * contraseña, en cambio, es una llamada de API normal (fetch/XHR) y
 * funciona igual en web y en nativo sin ningún tratamiento especial.
 */
export default function LoginScreen({ onSuccess }) {
  const { t } = useTranslation();
  // 'login' | 'register' | 'otp' | 'forgot'
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // ── Captcha propio de Kaikōdo (ver src/lib/captcha.js) ───────────────
  // Widget solo en registro y "olvidé contraseña" (no en login normal).
  // KaikodoCaptcha resuelve el reto de prueba-de-trabajo internamente y
  // avisa via onToken; *CaptchaKey solo sirve para forzar un reto nuevo
  // tras cada intento de envío (los retos son de un solo uso).
  const [captchaToken, setCaptchaToken] = useState('');
  const [forgotCaptchaToken, setForgotCaptchaToken] = useState('');
  const [registerCaptchaKey, setRegisterCaptchaKey] = useState(0);
  const [forgotCaptchaKey, setForgotCaptchaKey] = useState(0);

  // Limpia los tokens al cambiar de pestaña (son de un solo uso).
  useEffect(() => {
    setCaptchaToken('');
    setForgotCaptchaToken('');
  }, [mode]);

  const resetMessages = () => { setError(''); setInfo(''); };

  const switchTab = (nextMode) => {
    resetMessages();
    setMode(nextMode);
  };
  // Fix: el SDK de base44 (loginViaEmailPassword) llama internamente a
  // auth.logout() en CUALQUIER 401 — incluida una contraseña incorrecta,
  // el caso más común de un login que falla — y logout() hace un
  // window.location.href de página completa a un endpoint de logout de
  // base44. Eso saca al usuario de la SPA con una recarga brusca en vez de
  // dejar que el catch de abajo muestre "contraseña incorrecta" como un
  // error normal en pantalla; visto desde fuera, "el login da error" o "no
  // arranca bien". Como auth.logout es una propiedad de instancia (no de
  // prototipo), la anulamos sin efecto solo mientras dura el intento de
  // login/verificación, y la restauramos justo después pase lo que pase.
  const withoutAutoLogoutOn401 = async (fn) => {
    const originalLogout = base44.auth.logout;
    base44.auth.logout = async () => {};
    try {
      return await fn();
    } finally {
      base44.auth.logout = originalLogout;
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    resetMessages();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) { setError(t('auth.errors.missingFields')); return; }
    setLoading(true);
    try {
      await withoutAutoLogoutOn401(() => base44.auth.loginViaEmailPassword(trimmedEmail, password));
      onSuccess?.();
    } catch (err) {
      setError(extractErrorMessage(err, t('auth.errors.loginFailed')));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    resetMessages();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password || !confirmPassword) { setError(t('auth.errors.missingFields')); return; }
    if (password !== confirmPassword) { setError(t('auth.errors.passwordMismatch')); return; }
    if (password.length < 8) { setError(t('auth.errors.passwordTooShort')); return; }
    if (!captchaToken) { return; }
    setLoading(true);
    try {
      // Verifica el token del captcha propio antes de crear la cuenta (los
      // retos son de un solo uso y se comprueban en backend).
      const verifyRes = await base44.functions.invoke('verifyCaptcha', { token: captchaToken });
      if (!verifyRes?.data?.success) {
        setError(t('auth.errors.turnstileFailed'));
        return;
      }
      // register() manda un código OTP por email pero NO deja al usuario
      // logueado todavía (a diferencia de loginViaEmailPassword) — hay que
      // verificar el código en el siguiente paso antes de poder entrar.
      await base44.auth.register({ email: trimmedEmail, password });
      setMode('otp');
      setInfo(t('auth.otp.sent', { email: trimmedEmail }));
    } catch (err) {
      setError(extractErrorMessage(err, t('auth.errors.registerFailed')));
    } finally {
      setLoading(false);
      // Fuerza un reto nuevo para el siguiente intento (single-use).
      setRegisterCaptchaKey(k => k + 1);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    resetMessages();
    const trimmedEmail = email.trim();
    const trimmedCode = otpCode.trim();
    if (!trimmedCode) { setError(t('auth.errors.missingOtp')); return; }
    setLoading(true);
    try {
      await base44.auth.verifyOtp({ email: trimmedEmail, otpCode: trimmedCode });
            // Verificar el OTP confirma la cuenta pero, igual que register(), no
      // guarda sesión por sí solo — hace falta un login explícito justo
      // después, con la misma contraseña que se acaba de establecer. Mismo
      // fix que en handleLogin: sin esto, un 401 aquí (p. ej. contraseña
      // rechazada por el motivo que sea justo tras verificar) sacaría al
      // usuario de la app ya verificado pero sin sesión — exactamente el
      // patrón de cuentas que aparecen como "nunca inició sesión".
      await withoutAutoLogoutOn401(() => base44.auth.loginViaEmailPassword(trimmedEmail, password));
      onSuccess?.();
    } catch (err) {
      setError(extractErrorMessage(err, t('auth.errors.otpFailed')));
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    resetMessages();
    try {
      await base44.auth.resendOtp(email.trim());
      setInfo(t('auth.otp.resent'));
    } catch (err) {
      setError(extractErrorMessage(err, t('auth.errors.otpFailed')));
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    resetMessages();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setError(t('auth.errors.missingEmail')); return; }
    if (!forgotCaptchaToken) { return; }
    setLoading(true);
    try {
      const verifyRes = await base44.functions.invoke('verifyCaptcha', { token: forgotCaptchaToken });
      if (!verifyRes?.data?.success) {
        setError(t('auth.errors.turnstileFailed'));
        return;
      }
      await base44.auth.resetPasswordRequest(trimmedEmail);
      setInfo(t('auth.forgot.sent'));
    } catch (err) {
      // Por seguridad (no confirmar/negar si un email existe) muchos backends
      // devuelven éxito siempre en este endpoint, pero cubrimos el caso de
      // fallo real (red caída, etc.) igualmente.
      setError(extractErrorMessage(err, t('auth.errors.forgotFailed')));
    } finally {
      setLoading(false);
      setForgotCaptchaKey(k => k + 1);
    }
  };

  const handleGoogle = async () => {
    resetMessages();
    setGoogleLoading(true);
    try {
      if (isNative()) {
        // Abre un navegador in-app (Capacitor Browser) y vuelve a la app via
        // el mismo relay de custom URL scheme que el login por email ya usa
        // — ver listenForLoginCallback en AuthContext.jsx.
        await openProviderLogin('google');
      } else {
        // En web, loginWithProvider() hace un redirect de página completa a
        // base44 (que gestiona el OAuth con Google) y vuelve aquí mismo con
        // ?access_token= en la URL — appParams.js ya sabe leerlo al recargar.
        const returnUrl = `${window.location.origin}${window.location.pathname}`;
        base44.auth.loginWithProvider('google', returnUrl);
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const anyLoading = loading || googleLoading;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2">
            <Logo className="h-6 w-auto text-foreground" style={{ display: 'block' }} />
            <span className="text-[10px] font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5 leading-none">{t('common.beta')}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">{t('auth.tagline')}</p>
        </div>

        {(mode === 'login' || mode === 'register') && (
          <>
            <div className="flex bg-secondary rounded-[10px] p-[3px] mb-6">
              <button
                type="button"
                onClick={() => switchTab('login')}
                className={`flex-1 text-center py-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'login' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
              >
                {t('auth.tabs.login')}
              </button>
              <button
                type="button"
                onClick={() => switchTab('register')}
                className={`flex-1 text-center py-2 rounded-lg text-sm font-semibold transition-colors ${mode === 'register' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
              >
                {t('auth.tabs.register')}
              </button>
            </div>

            {error && (
              <p className="text-sm mb-4 text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
            )}
            {info && (
              <p className="text-sm mb-4 text-primary bg-secondary border border-border rounded-lg px-3 py-2">{info}</p>
            )}

            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-3 mb-3.5">
                <div>
                  <Label htmlFor="login-email" className="text-xs text-muted-foreground mb-1.5 block">{t('auth.fields.email')}</Label>
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder={t('auth.fields.emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-[42px] rounded-[10px]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label htmlFor="login-password" className="text-xs text-muted-foreground">{t('auth.fields.password')}</Label>
                    <button type="button" onClick={() => switchTabForgot()} className="text-xs text-primary font-medium">
                      {t('auth.buttons.forgotPassword')}
                    </button>
                  </div>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-[42px] rounded-[10px]"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={anyLoading}
                  className="h-11 rounded-full bg-primary hover:bg-primary/90 text-white font-semibold mt-1"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.buttons.login')}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="flex flex-col gap-3 mb-3.5">
                <div>
                  <Label htmlFor="register-email" className="text-xs text-muted-foreground mb-1.5 block">{t('auth.fields.email')}</Label>
                  <Input
                    id="register-email"
                    type="email"
                    autoComplete="email"
                    placeholder={t('auth.fields.emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-[42px] rounded-[10px]"
                  />
                </div>
                <div>
                  <Label htmlFor="register-password" className="text-xs text-muted-foreground mb-1.5 block">{t('auth.fields.password')}</Label>
                  <Input
                    id="register-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-[42px] rounded-[10px]"
                  />
                </div>
                <div>
                  <Label htmlFor="register-confirm" className="text-xs text-muted-foreground mb-1.5 block">{t('auth.fields.confirmPassword')}</Label>
                  <Input
                    id="register-confirm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-[42px] rounded-[10px]"
                  />
                </div>
                <KaikodoCaptcha active={mode === 'register'} resetKey={registerCaptchaKey} onToken={setCaptchaToken} />
                <Button
                  type="submit"
                  disabled={anyLoading || !captchaToken}
                  className="h-11 rounded-full bg-primary hover:bg-primary/90 text-white font-semibold mt-1"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.buttons.register')}
                </Button>
              </form>
            )}

            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] font-medium text-muted-foreground">{t('auth.buttons.or')}</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleGoogle}
              disabled={anyLoading}
              className="h-11 rounded-full w-full font-semibold gap-2"
            >
              {googleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><GoogleIcon /> {t('auth.buttons.google')}</>}
            </Button>
          </>
        )}

        {mode === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-center mb-1">{t('auth.otp.title')}</h2>
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
            )}
            {info && (
              <p className="text-sm text-primary bg-secondary border border-border rounded-lg px-3 py-2">{info}</p>
            )}
            <div>
              <Label htmlFor="otp-code" className="text-xs text-muted-foreground mb-1.5 block">{t('auth.fields.otpCode')}</Label>
              <Input
                id="otp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                className="h-[42px] rounded-[10px] text-center tracking-[0.3em] font-semibold"
              />
            </div>
            <Button type="submit" disabled={anyLoading} className="h-11 rounded-full bg-primary hover:bg-primary/90 text-white font-semibold mt-1">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.buttons.verify')}
            </Button>
            <div className="flex items-center justify-between mt-1">
              <button type="button" onClick={handleResendOtp} className="text-xs text-primary font-medium">
                {t('auth.buttons.resendOtp')}
              </button>
              <button type="button" onClick={() => switchTab('login')} className="text-xs text-muted-foreground font-medium">
                {t('auth.buttons.backToLogin')}
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-center mb-1">{t('auth.forgot.title')}</h2>
            <p className="text-xs text-muted-foreground text-center mb-1">{t('auth.forgot.body')}</p>
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>
            )}
            {info && (
              <p className="text-sm text-primary bg-secondary border border-border rounded-lg px-3 py-2">{info}</p>
            )}
            <div>
              <Label htmlFor="forgot-email" className="text-xs text-muted-foreground mb-1.5 block">{t('auth.fields.email')}</Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                placeholder={t('auth.fields.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-[42px] rounded-[10px]"
              />
            </div>
            <KaikodoCaptcha active={mode === 'forgot'} resetKey={forgotCaptchaKey} onToken={setForgotCaptchaToken} />
            <Button type="submit" disabled={anyLoading || !forgotCaptchaToken} className="h-11 rounded-full bg-primary hover:bg-primary/90 text-white font-semibold mt-1">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('auth.buttons.sendResetLink')}
            </Button>
            <button type="button" onClick={() => switchTab('login')} className="text-xs text-muted-foreground font-medium text-center mt-1">
              {t('auth.buttons.backToLogin')}
            </button>
          </form>
        )}
      </div>
    </div>
  );

  // Declarada al final (function hoisting no aplica a const, así que esta
  // función auxiliar usa una function declaration normal) solo para no
  // reordenar el bloque JSX de arriba al añadirla.
  function switchTabForgot() {
    resetMessages();
    setMode('forgot');
  }
}