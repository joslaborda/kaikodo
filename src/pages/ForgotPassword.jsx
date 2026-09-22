import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { useTranslation } from "react-i18next";
import KaikodoCaptcha from "@/components/auth/KaikodoCaptcha";

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // José (22 sep 2026) -- auditoría de seguridad: esta página independiente
  // (/forgot-password, alcanzable sin sesión -- ver App.jsx) llama al mismo
  // auth.resetPasswordRequest que el tab "olvidé mi contraseña" de
  // LoginScreen.jsx, pero sin el captcha propio que ahí sí protege ese envío.
  // Cualquiera podía saltarse por completo la protección anti-abuso yendo
  // directo a esta URL en vez de usar el formulario de dentro de la app.
  // Mismo patrón que LoginScreen.jsx: token de un solo uso, se resetea tras
  // cada intento.
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!captchaToken) return;
    setLoading(true);
    try {
      const verifyRes = await base44.functions.invoke('verifyCaptcha', { token: captchaToken });
      if (!verifyRes?.data?.success) {
        setError(t('auth.errors.captchaFailed'));
        return;
      }
      await base44.auth.resetPasswordRequest(email);
      setSent(true);
    } catch {
      // Always show success regardless -- no confirmar/negar si el email existe.
      setSent(true);
    } finally {
      setLoading(false);
      setCaptchaKey(k => k + 1);
    }
  };

  return (
    <AuthLayout
      icon={Mail}
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.body')}
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          <ArrowLeft className="w-3 h-3 inline mr-1" />{t('auth.buttons.backToLogin')}
        </Link>
      }
    >
      {sent ? (
        <p className="text-sm text-foreground text-center">
          {t('auth.forgot.sentGeneric')}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.fields.email')}</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <KaikodoCaptcha active={true} resetKey={captchaKey} onToken={setCaptchaToken} />
          <Button type="submit" className="w-full h-12 font-medium" disabled={loading || !captchaToken}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('auth.forgot.sending')}
              </>
            ) : (
              t('auth.buttons.sendResetLink')
            )}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}