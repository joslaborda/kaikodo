import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { TERMS_VERSION } from '@/lib/termsVersion';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';

// José (22 sep 2026): "el mecanismo que crees que tienes para gestionar un
// cambio de términos no existe" — CreateProfileModal.jsx solo pedía
// consentimiento en el alta; profile.terms_version se guardaba pero nadie
// lo volvía a mirar nunca, así que subir TERMS_VERSION no tenía ningún
// efecto. Este gate es lo que faltaba: se monta en App.jsx (mismo sitio que
// el gate de email sin verificar) para CUALQUIER usuario ya onboarded cuyo
// profile.terms_version no coincida con la versión actual — no solo en la
// pantalla de inicio, así que no hay ruta/deep-link que lo esquive.
//
// Duerme del todo mientras TERMS_VERSION no cambie: hoy, con el valor tal
// cual está en el repo, ningún usuario ve esto.
//
// Sin scroll ni lectura obligatoria del documento entero (eso ya vive en
// /Terms y /Privacy, enlazados aquí) — mismo criterio que el consentimiento
// del onboarding: checkbox + enlaces, no hace falta reinventar el patrón.
export default function TermsReacceptGate({ profile, onAccepted }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { logout } = useAuth();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAccept = async () => {
    if (!checked || saving) return;
    setSaving(true);
    try {
      await base44.entities.UserProfile.update(profile.id, {
        terms_accepted_at: new Date().toISOString(),
        terms_version: TERMS_VERSION,
      });
      onAccepted();
    } catch (e) {
      toast({ title: t('common.error'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6">
        <h1 className="text-lg font-bold text-foreground mb-2">{t('terms.reaccept.title')}</h1>
        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{t('terms.reaccept.body')}</p>

        <label className="flex items-start gap-2.5 cursor-pointer mb-5">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-border text-primary flex-shrink-0"
          />
          <span className="text-xs text-muted-foreground leading-relaxed">
            {t('onboarding.slide0.termsPrefix')}{' '}
            <Link to={createPageUrl('Terms')} target="_blank" rel="noopener noreferrer"
              className="text-primary font-medium underline" onClick={e => e.stopPropagation()}>
              {t('onboarding.slide0.termsLabel')}
            </Link>
            {' '}{t('onboarding.slide0.termsAnd')}{' '}
            <Link to={createPageUrl('Privacy')} target="_blank" rel="noopener noreferrer"
              className="text-primary font-medium underline" onClick={e => e.stopPropagation()}>
              {t('onboarding.slide0.privacyLabel')}
            </Link>
          </span>
        </label>

        <button
          onClick={handleAccept}
          disabled={!checked || saving}
          className="w-full h-11 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-50 mb-2"
        >
          {saving ? '…' : t('terms.reaccept.accept')}
        </button>
        {/* José (22 sep 2026): salida honesta -- si no acepta, no se le deja
            usar la app (mismo criterio que el onboarding), pero tampoco se le
            deja atrapado sin ninguna acción posible más que aceptar. */}
        <button
          onClick={() => logout()}
          disabled={saving}
          className="w-full h-9 rounded-full text-xs font-medium text-muted-foreground disabled:opacity-50"
        >
          {t('terms.reaccept.logout')}
        </button>
      </div>
    </div>
  );
}
