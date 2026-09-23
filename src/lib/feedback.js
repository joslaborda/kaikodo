import { base44 } from '@/api/base44Client';
import { getLanguage } from '@/i18n/index.js';

// Dirección donde José recibe el aviso de cada envío — buzón real
// (hello@kaikodo.app) creado aparte para esto, no relacionado con el
// remitente de las invitaciones (RESEND_FROM_ADDRESS), que es solo de
// salida y no admite respuestas. El destinatario real vive fijo en la
// función de backend sendFeedbackEmail, no aquí — esta constante solo se
// usa para el mensaje de log si el envío falla.
const FEEDBACK_INBOX = 'hello@kaikodo.app';

/**
 * sendFeedback — guarda el mensaje en la entidad Feedback (así queda
 * consultable desde el panel de datos de base44 aunque el email falle o se
 * pierda en spam) y, además, manda un aviso por email a FEEDBACK_INBOX para
 * enterarse al momento.
 *
 * El email se manda vía la función de backend sendFeedbackEmail, no
 * llamando a base44.integrations.Core.SendEmail directamente desde aquí —
 * esa integración, expuesta en el cliente, permitía a cualquiera con sesión
 * iniciada mandar correo arbitrario (cualquier destinatario/asunto/cuerpo)
 * gastando créditos de email de la cuenta de Base44 sin ningún control.
 */
// José (24 sep 2026): el registro en Feedback ahora lo crea la función de
// backend (así el límite de envíos no se puede saltar). Aquí solo se llama.
export async function sendFeedback({ feedbackType, message, userName }) {
  const trimmed = (message || '').trim();
  if (!trimmed) throw new Error('El mensaje no puede estar vacío');
  const result = await base44.functions.invoke('sendFeedbackEmail', {
    feedbackType,
    message: trimmed,
    userName,
    appLanguage: getLanguage(),
  });
  const data = result?.data ?? result;
  if (data?.error) throw new Error(data.error);
  if (data?.emailed === false) console.warn(`[sendFeedback] Guardado, pero el aviso a ${FEEDBACK_INBOX} no se envió:`, data.warning);
  return data;
}
