import { base44 } from '@/api/base44Client';
import { notify } from '@/lib/notifications';
import { searchUserProfiles } from '@/lib/userProfiles';
import { getLanguage } from '@/i18n/index.js';

// Ya no se usa para crear invitaciones (eso ahora genera su propio token
// dentro de createTripInvite, en el backend). Se deja exportada por si algo
// más la importa, pero no participa en la seguridad del flujo de invitación.
export function generateInviteToken() {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

export async function sendTripInvite({ tripId, email, targetUserId, role, tripName, inviterEmail, inviterName }) {
  const normalizedEmail = email ? email.trim().toLowerCase() : undefined;

  // Solo para rellenar el email bonito (destino/fechas) — ya no decide nada
  // de seguridad, eso lo hace createTripInvite server-side. Si fallara (p.
  // ej. el propio Trip.read ahora exige ser miembro), el email se manda
  // igual con estos campos vacíos gracias al optional chaining de abajo.
  const trip = await base44.entities.Trip.get(tripId).catch(() => null);

  // Crear (o renovar si ya había una pendiente) la invitación en el backend,
  // no aquí. TripInvite.create está cerrado a "false" en el rls (ver
  // base44/entities/TripInvite.jsonc) precisamente porque crearla desde el
  // cliente permitía a cualquier usuario autenticado invitarse a sí mismo a
  // CUALQUIER viaje ajeno con un trip_id cualquiera, sin ser miembro. La
  // función createTripInvite valida server-side que quien invita ya es
  // miembro del viaje, y decide el email/invited_by/rol final — el rol que
  // se manda aquí es solo una preferencia, no una concesión.
  let createResult;
  try {
    createResult = await base44.functions.invoke('createTripInvite', {
      tripId,
      email: normalizedEmail,
      targetUserId,
      role: role || 'editor',
    });
  } catch (e) {
    // Igual que en acceptTripInvite: algunas versiones del SDK lanzan en vez
    // de resolver con el error en el body (p. ej. el 403 de "no eres
    // miembro de este viaje").
    const serverError = e?.response?.data?.error || e?.data?.error;
    throw new Error(serverError || e?.message || 'No se pudo crear la invitación.');
  }
  const data = createResult?.data ?? createResult;
  if (data?.error) throw new Error(data.error);
  const invite = data.invite;
  const inviteToken = invite.invite_token;
  // El email definitivo del invitado lo decide el backend (createTripInvite):
  // puede venir de `email` (invitar por email conocido) o resolverse ahí
  // server-side a partir de `targetUserId` (invitar por username, donde el
  // email del invitado nunca pasa por el navegador de quien invita). A
  // partir de aquí se usa invite.email para todo lo que necesite el email
  // real (enviar el correo, crear la notificación in-app).
  const targetEmail = invite.email;

  // URL de aceptación
  const inviteUrl = `${window.location.origin}/Invites?token=${inviteToken}`;

  // Enviar email — Resend primero (HTML de verdad, con un <a href> real y
  // clicable), vía la función de backend sendInviteEmail. El SendEmail
  // nativo de base44 solo admite texto plano: probamos ya que aunque la URL
  // llegue íntegra como texto suelto, ningún cliente la convierte sola en
  // enlace clicable (Outlook la muestra en texto normal). Si Resend aún no
  // está configurado (falta RESEND_API_KEY en Secretos, o el dominio no está
  // verificado), se cae al SendEmail de texto plano como red de seguridad
  // para no dejar la invitación sin ningún correo mientras se termina de
  // montar Resend.
  let emailSent = false;
  try {
    const result = await base44.functions.invoke('sendInviteEmail', {
      to: targetEmail,
      tripName,
      inviterName,
      inviterEmail,
      inviteUrl,
      destination: trip?.destination,
      country: trip?.country,
      startDate: trip?.start_date,
      endDate: trip?.end_date,
      // Idioma activo de quien invita — el destinatario a menudo no tiene
      // cuenta todavía, así que no hay otro idioma que consultar.
      lang: getLanguage()
    });
    const data = result?.data ?? result;
    if (data?.error) throw new Error(data.error);
    emailSent = true;
  } catch (e) {
    console.warn('[sendTripInvite] Resend falló, usando SendEmail de reserva:', e?.message);
    try {
      await base44.integrations.Core.SendEmail({
        to: targetEmail,
        subject: `${inviterName || inviterEmail} te invita a "${tripName}" en Kaikōdo ✈️`,
        body: `Hola,

${inviterName || inviterEmail} te ha invitado a unirte al viaje "${tripName}" en Kaikōdo.

Para aceptar la invitación, abre este enlace:

${inviteUrl}

Si el enlace no se abre solo al tocarlo, cópialo y pégalo en el navegador.

Si aún no tienes cuenta en Kaikōdo, el mismo enlace te lleva a crearla con este email (${targetEmail}) — la invitación aparecerá automáticamente en cuanto entres.

¡Buen viaje! 🧳`
      });
      emailSent = true;
    } catch (e2) {
      console.warn('[sendTripInvite] Email no enviado (ni Resend ni SendEmail):', e2?.message);
    }
  }

  // Si el usuario ya existe en Kaikōdo, crear notificación in-app
  // Usamos UserProfile.filter por email para no necesitar User.list() (que puede estar restringido)
  try {
    // UserProfile.read se cerró en el rls — se lee vía función backend con
    // un email ya conocido (el que se está invitando), así que la respuesta
    // sí incluye user_id — ver src/lib/userProfiles.js.
    const profiles = await searchUserProfiles({ emails: [targetEmail] });
    if (profiles.length > 0 && profiles[0].user_id) {
      await notify({
        userId: profiles[0].user_id,
        type: 'trip_invite',
        actor: { display_name: inviterName || inviterEmail, email: inviterEmail },
        tripId,
        tripName,
        refId: invite.id,
        refExtra: { token: inviteToken }
      });
    }
  } catch (e) {
    // Silencioso — la notificación in-app es opcional
    console.warn('[sendTripInvite] Notificación in-app no creada:', e?.message);
  }

  return { invite, emailSent, inviteUrl };
}

// La aceptación en sí corre en el backend (base44/functions/acceptTripInvite),
// no aquí. Motivo: para poder cerrar Trip.update a "solo miembros actuales",
// esta era la única operación que necesitaba saltarse esa regla (el invitado
// se añade a sí mismo justo antes de ser miembro) — y de paso, la sincronización
// de trip_members en los datos ya existentes del viaje necesita permisos de
// servicio para no depender de que el nuevo miembro ya figure en cada registro
// (que es justo lo que está intentando arreglar). El email tampoco lo manda
// el cliente: lo toma la función de la sesión autenticada, así no se puede
// aceptar una invitación ajena falseando el email.
export async function acceptTripInvite(inviteId, inviteToken) {
  let result;
  try {
    result = await base44.functions.invoke('acceptTripInvite', { inviteId, inviteToken });
  } catch (e) {
    // Algunas versiones del SDK lanzan en vez de resolver con el error en el body.
    const serverError = e?.response?.data?.error || e?.data?.error;
    const err = new Error(serverError || e?.message || 'No se pudo unir al viaje.');
    const code = e?.response?.data?.code || e?.data?.code;
    if (code) err.code = code;
    throw err;
  }

  const data = result?.data ?? result;
  if (data?.error) {
    const err = new Error(data.error);
    if (data.code) err.code = data.code;
    throw err;
  }
  return data.trip;
}

// Igual que acceptTripInvite: TripInvite.update está cerrado del todo en el
// rls (ver base44/entities/TripInvite.jsonc — permitir cualquier update a
// quien coincidiera en email/invited_by dejaba reescribir trip_id/role de la
// invitación, no solo el status). Rechazar corre en el backend, con
// asServiceRole, tocando solo status/responded_date.
export async function declineTripInvite(inviteId, inviteToken) {
  const invite = await base44.entities.TripInvite.get(inviteId);
  if (!invite) throw new Error('Invitación inválida o expirada');

  let result;
  try {
    result = await base44.functions.invoke('respondToTripInvite', { inviteId, inviteToken, action: 'decline' });
  } catch (e) {
    const serverError = e?.response?.data?.error || e?.data?.error;
    throw new Error(serverError || e?.message || 'No se pudo rechazar la invitación.');
  }
  const data = result?.data ?? result;
  if (data?.error) throw new Error(data.error);

  return invite;
}