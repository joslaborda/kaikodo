import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * sendFeedbackEmail — manda el aviso interno a FEEDBACK_INBOX cuando alguien
 * envía feedback desde la app.
 *
 * Antes esta llamada a base44.integrations.Core.SendEmail se hacía
 * directamente desde el cliente (ver src/lib/feedback.js) — eso dejaba esa
 * integración expuesta en el navegador: cualquiera con sesión iniciada podía
 * invocarla a mano con CUALQUIER destinatario/asunto/cuerpo (no solo
 * FEEDBACK_INBOX), gastando créditos de email de la cuenta de Base44 sin
 * pasar por ningún control. Aquí el destinatario está fijo en el propio
 * código del backend, no lo decide el cliente, así que como mucho se podría
 * forzar el envío de avisos falsos a FEEDBACK_INBOX — molesto, pero no un
 * vector para mandar correo arbitrario a terceros con la marca de Kaikōdo.
 *
 * El registro en la entidad Feedback lo sigue creando el cliente directamente
 * (RLS ya lo permite: create solo exige coincidir con el propio usuario) —
 * esta función solo se encarga del aviso por email, que es la parte que
 * necesitaba una integración sensible.
 *
 * Límite: aunque exige sesión, una cuenta (comprometida, o simplemente un
 * script) podía llamar a esto en bucle y mandar cientos de avisos,
 * gastando créditos de SendEmail sin ningún tope. Se cuenta sobre los
 * propios registros de Feedback ya creados por ese email (no hace falta
 * ninguna entidad nueva): máximo 5 avisos cada 10 minutos por persona,
 * de sobra para un uso legítimo -- nadie manda feedback repetidamente en
 * ráfaga.
 */

const FEEDBACK_INBOX = "hello@kaikodo.app";
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 5;

const TYPE_LABEL: Record<string, string> = {
  bug: "Bug",
  suggestion: "Sugerencia",
  other: "Otro",
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const service = base44.asServiceRole;
    const windowStartIso = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const recent = await service.entities.Feedback.filter({ user_email: user.email });
    const recentCount = recent.filter((f: any) => f.created_date && f.created_date >= windowStartIso).length;
    if (recentCount >= RATE_MAX_PER_WINDOW) {
      return Response.json({ error: "Demasiados envíos seguidos, inténtalo en unos minutos" }, { status: 429 });
    }

    const { feedbackType, message, userEmail, userName, appLanguage } = await req.json();
    const trimmed = String(message || "").trim();
    if (!trimmed) {
      return Response.json({ error: "El mensaje no puede estar vacío" }, { status: 400 });
    }

    const typeLabel = TYPE_LABEL[feedbackType] || feedbackType || "Feedback";
    const from = userName || userEmail || user.email;

    await base44.integrations.Core.SendEmail({
      to: FEEDBACK_INBOX,
      subject: `[Kaikōdo] ${typeLabel} de ${from}`,
      body: `Tipo: ${typeLabel}
De: ${userName || "(sin nombre)"} <${userEmail || user.email}>
Idioma app: ${appLanguage || "?"}

Mensaje:
${trimmed}`,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
