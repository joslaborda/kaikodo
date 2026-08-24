import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck } from 'lucide-react';
import { solveCaptchaChallenge } from '@/lib/captcha';

/**
 * KaikodoCaptcha — verificación anti-bot propia, sin ningún script ni
 * iframe de terceros (ver src/lib/captcha.js para el porqué: Cloudflare
 * Turnstile no funcionaba de forma fiable dentro del WebView nativo).
 * Resuelve un reto de prueba-de-trabajo en cuanto se monta (o cuando
 * `active` pasa a true, o cuando cambia `resetKey`) y llama a onToken con
 * el resultado. onToken('') mientras no hay token válido -- el formulario
 * que lo usa debe mantener el botón de envío deshabilitado hasta que
 * llegue un token no vacío, igual que antes con turnstileToken.
 *
 * resetKey: cualquier valor que cambie fuerza un reto nuevo -- los retos
 * son de un solo uso, así que hace falta uno nuevo tras cada intento de
 * envío (éxito o fallo). LoginScreen.jsx incrementa un contador para esto.
 */
export default function KaikodoCaptcha({ active, onToken, resetKey }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('idle'); // idle | solving | done | error
  const [progress, setProgress] = useState(0);
  const runIdRef = useRef(0);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const run = () => {
    const runId = ++runIdRef.current;
    setStatus('solving');
    setProgress(0);
    onTokenRef.current('');
    solveCaptchaChallenge({
      onProgress: (p) => { if (runIdRef.current === runId) setProgress(p); },
    })
      .then((token) => {
        if (runIdRef.current !== runId) return;
        if (token) { setStatus('done'); onTokenRef.current(token); }
        else { setStatus('error'); onTokenRef.current(''); }
      })
      .catch(() => {
        if (runIdRef.current !== runId) return;
        setStatus('error'); onTokenRef.current('');
      });
  };

  useEffect(() => {
    if (!active) { runIdRef.current++; setStatus('idle'); return; }
    run();
    return () => { runIdRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, resetKey]);

  if (!active) return null;

  return (
    <div className="min-h-[52px] flex items-center justify-center gap-2 text-xs text-muted-foreground border border-border rounded-[10px] px-3 py-2.5 bg-secondary/40">
      {status === 'solving' && (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
          <span>{t('auth.captcha.verifying')}{progress > 0 ? ` ${progress}%` : ''}</span>
        </>
      )}
      {status === 'done' && (
        <>
          <ShieldCheck className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
          <span>{t('auth.captcha.verified')}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <span>{t('auth.captcha.failed')}</span>
          <button type="button" onClick={run} className="text-primary font-medium underline">
            {t('auth.captcha.retry')}
          </button>
        </>
      )}
    </div>
  );
}
