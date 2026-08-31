import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { useTranslation } from "react-i18next";

export default function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  // Fix #3: no hay forma de confirmar aquí qué nombre de parámetro usa
  // realmente la plantilla de email de base44 (auth.resetPasswordRequest
  // la genera del lado del servidor) sin disparar un envío real -- se
  // aceptan los dos nombres más plausibles en vez de apostar por uno solo.
  const resetToken = searchParams.get("token") || searchParams.get("resetToken") || searchParams.get("reset_token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Mitigación temporal de un bug conocido de Base44 (no arreglable desde
  // este repo): tras un reset, el login puede fallar con "contraseña
  // incorrecta" durante unos segundos porque el cambio tarda en propagarse
  // a la capa de validación de login. En vez de redirigir directo al login
  // (como se hacía antes), se muestra esta pantalla de éxito con el aviso.
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError(t('resetPassword.mismatchError'));
      return;
    }
    // Mínimo 8 caracteres, misma validación que el registro (LoginScreen.jsx).
    if (newPassword.length < 8) {
      setError(t('resetPassword.tooShortError'));
      return;
    }
    setLoading(true);
    try {
      await base44.auth.resetPassword({ resetToken, newPassword });
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  const goToLogin = () => {
    // "/login" no es una página propia -- cualquier ruta sin sesión activa
    // muestra LoginScreen igualmente (ver App.jsx), así que sirve, pero se
    // usa "/" por ser la que sí existe siempre como página real.
    window.location.href = "/";
  };

  if (success) {
    return (
      <AuthLayout
        icon={CheckCircle2}
        title={t('resetPassword.successTitle')}
        subtitle={t('resetPassword.successSubtitle')}
      >
        <p className="text-sm text-foreground text-center mb-6">
          {t('resetPassword.successWarning')}
        </p>
        <Button type="button" className="w-full h-12 font-medium" onClick={goToLogin}>
          {t('resetPassword.continueButton')}
        </Button>
      </AuthLayout>
    );
  }

  if (!resetToken) {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title={t('resetPassword.invalidTitle')}
        subtitle={t('resetPassword.invalidSubtitle')}
        footer={
          <Link to="/forgot-password" className="text-primary font-medium hover:underline">
            {t('resetPassword.requestNewLink')}
          </Link>
        }
      >
        <p className="text-sm text-foreground text-center">
          {t('resetPassword.invalidBody')}
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={Lock}
      title={t('resetPassword.title')}
      subtitle={t('resetPassword.subtitle')}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t('resetPassword.newPasswordLabel')}</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t('resetPassword.confirmLabel')}</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t('resetPassword.buttonLoading')}
            </>
          ) : (
            t('resetPassword.button')
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}