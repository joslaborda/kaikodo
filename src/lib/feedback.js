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
export async function sendFeedback({ feedbackType, message, userEmail, userName }) {
  const trimmed = (message || '').trim();
  if (!trimmed) throw new Error('El mensaje no puede estar vacío');

  const record = await base44.entities.Feedback.create({
    feedback_type: feedbackType,
    message: trimmed,
    user_email: userEmail || '',
    user_name: userName || '',
    app_language: getLanguage(),
    status: 'new',
  });

  // El email es "best effort" — si falla (p. ej. el buzón hello@ aún no
  // está verificado del todo), el registro en Feedback ya se guardó, así
  // que no se pierde el mensaje del usuario por un fallo de envío.
  try {
    const result = await base44.functions.invoke('sendFeedbackEmail', {
      feedbackType,
      message: trimmed,
      userEmail,
      userName,
      appLanguage: getLanguage(),
    });
    const data = result?.data ?? result;
    if (data?.error) throw new Error(data.error);
  } catch (e) {
    console.warn(`[sendFeedback] Email de aviso a ${FEEDBACK_INBOX} no enviado (el registro sí se guardó):`, e?.message);
  }

  return record;
}