import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * sendInviteEmail — manda el email de invitación a un viaje con HTML real
 * (fondo cremita de la app + tarjeta blanca, botón naranja clicable de
 * verdad), usando Resend en vez del SendEmail nativo de base44.
 *
 * Por qué: base44.integrations.Core.SendEmail solo admite body de texto
 * plano — no hay forma de mandar un <a href>, y confirmamos que ni siquiera
 * la URL en texto plano se convierte sola en enlace clicable en Outlook.
 *
 * Compatibilidad de email — importante: esto NO es una página web. Muchos
 * clientes (sobre todo Outlook de escritorio, que ya nos dio problemas)
 * usan un motor de render muy limitado: no soportan flexbox/grid, no
 * cargan fuentes de iconos externas, y el soporte de SVG inline es
 * irregular. Por eso aquí, a diferencia del resto de la app:
 *  - El logo va como imagen PNG incrustada (data URI), generada a partir
 *    del SVG real de marca — no como SVG inline ni como texto estilizado
 *    (ver comentario junto a LOGO_DATA_URI más abajo).
 *  - El layout usa <table> en vez de <div> con flex.
 *  - No hay iconos de fuente, solo texto.
 *
 * Idioma: se manda en el idioma que tenga activo quien invita en ese
 * momento (parámetro `lang`, 'es' o 'en') — el destinatario a menudo no
 * tiene cuenta todavía, así que no hay otro idioma que consultar.
 *
 * La API key de Resend vive en los secretos del proyecto (RESEND_API_KEY) y
 * nunca llega al navegador. Requiere sesión iniciada (igual que
 * acceptTripInvite) para que no se pueda usar este endpoint para mandar
 * correo arbitrario sin autenticar.
 */

// Dominio real de la app — se usa para RECONSTRUIR el link del botón/texto
// del email server-side, en vez de confiar en la URL completa que manda el
// cliente. Antes se validaba el token contra una TripInvite real, pero el
// dominio de `inviteUrl` no se comprobaba: alguien podía llamar a esta
// función directamente (no por la UI) con un token real pero un dominio
// ajeno (ej. "https://dominio-malicioso.com/phish?token=<token real>"), y el
// email oficial de Kaikōdo (remitente verificado, pasa SPF/DKIM) llegaba con un
// botón/enlace apuntando a un sitio de phishing. Configurable por si cambia
// el dominio; con fallback al dominio de producción conocido.
const APP_ORIGIN = (Deno.env.get("KODO_APP_URL") || "https://kaikodo.app").replace(/\/$/, "");

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Por defecto usa el remitente de pruebas de Resend — solo entrega al email
// con el que se creó la cuenta de Resend. Para invitar a cualquier persona
// real hace falta un dominio propio verificado en Resend y fijar
// RESEND_FROM_ADDRESS (p. ej. "Kaikōdo <invites@mail.kaikodo.app>") en
// Secretos.
const FROM_ADDRESS = Deno.env.get("RESEND_FROM_ADDRESS") || "Kaikōdo <onboarding@resend.dev>";

// Logo real (el SVG de marca que dio José) convertido a PNG e incrustado
// como data URI — así no depende de subir el archivo a ningún sitio. Se usa
// una imagen y no el SVG inline ni el texto estilizado que había antes:
//  - SVG inline: Outlook de escritorio no lo soporta, se vería roto. Además
//    la mayoría de webmail (Gmail, Yahoo, el propio Outlook.com) tampoco
//    soportan SVG inline — lo eliminan directamente, así que ni siquiera
//    serviría solo para Outlook.com.
//  - Texto estilizado: Outlook.com (web) reescribe el color del texto en su
//    "modo oscuro" (aunque el email pida explícitamente modo claro).
//
// El problema de fondo: una imagen no se ve afectada por esa reescritura de
// color (Outlook.com no toca píxeles), pero tampoco se adapta sola — el PNG
// queda con el mismo color siempre. Como no hay forma fiable de servir dos
// versiones distintas según el modo (Outlook.com no usa @media, usa su
// propio motor interno, y nuestro intento anterior de forzar colores vía
// CSS con [data-ogsc]/[data-ogsb] no tuvo efecto en la prueba real), se usa
// un gris medio (#757575) en vez del negro original (#1b1917) para las
// letras: se lee razonablemente bien tanto en la tarjeta clara (modo
// normal) como en la tarjeta oscura que pinta Outlook.com — no es perfecto
// en ninguno de los dos, pero es el único enfoque que funciona en todos los
// clientes sin apostar por una técnica que ya falló una vez. El acento del
// macrón se deja en el naranja de marca (#ba532d) en ambos casos.
const LOGO_DATA_URI = "data:image/png;base64,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";

const STRINGS: Record<string, Record<string, string>> = {
  es: {
    invitedBy: "te invita a un viaje",
    button: "Ver invitación",
    linkHint: "¿El botón no funciona? Copia este enlace:",
    noAccount: "¿Aún no tienes cuenta en Kaikōdo? El mismo enlace te lleva a crearla — la invitación aparecerá automáticamente en cuanto entres.",
    destinationLabel: "Destino",
    datesLabel: "Fechas",
    subjectVerb: "te invita a",
    inKodo: "en Kaikōdo",
  },
  en: {
    invitedBy: "invited you on a trip",
    button: "View invitation",
    linkHint: "Button not working? Copy this link:",
    noAccount: "No account on Kaikōdo yet? The same link takes you to create one — the invitation will show up as soon as you sign in.",
    destinationLabel: "Destination",
    datesLabel: "Dates",
    subjectVerb: "invited you to",
    inKodo: "on Kaikōdo",
  },
};

function escapeHtml(str: unknown) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ((
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>
    )[c])
  );
}

function formatDate(iso: string, lang: string) {
  try {
    const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
    return new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-ES", {
      day: "numeric",
      month: lang === "en" ? "short" : "long",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

// Fallback en texto plano, server-side — antes esto lo hacía el cliente
// llamando directamente a base44.integrations.Core.SendEmail (ver
// src/lib/invites.js), lo que dejaba esa integración expuesta en el
// navegador: cualquiera con sesión iniciada podía invocarla a mano con
// cualquier destinatario/asunto/cuerpo, sin pasar por ninguna validación,
// gastando créditos de email de la cuenta de Base44. Movido aquí para que
// el cliente nunca toque esa integración directamente — solo puede pedir
// "manda la invitación a esta persona", y el backend decide cómo (Resend,
// o este fallback) tras validar que hay una invitación real de por medio.
async function sendPlainFallback(
  client: any,
  { to, inviterName, inviterEmail, tripName, safeInviteUrl, lang }:
  { to: string; inviterName?: string; inviterEmail?: string; tripName?: string; safeInviteUrl: string; lang: string }
) {
  const s = STRINGS[lang];
  const from = inviterName || inviterEmail || (lang === "en" ? "Someone" : "Alguien");
  const subject = lang === "en"
    ? `${from} ${s.subjectVerb} "${tripName || ""}" ${s.inKodo} \u2708\ufe0f`
    : `${from} ${s.subjectVerb} "${tripName || ""}" ${s.inKodo} \u2708\ufe0f`;
  const body = lang === "en"
    ? `Hi,\n\n${from} has invited you to join the trip "${tripName || ""}" on Kaik\u014ddo.\n\nTo accept the invitation, open this link:\n\n${safeInviteUrl}\n\nIf the link doesn't open by tapping it, copy and paste it into your browser.\n\n${s.noAccount}\n\nHave a great trip! \ud83e\uddf3`
    : `Hola,\n\n${from} te ha invitado a unirte al viaje "${tripName || ""}" en Kaik\u014ddo.\n\nPara aceptar la invitaci\u00f3n, abre este enlace:\n\n${safeInviteUrl}\n\nSi el enlace no se abre solo al tocarlo, c\u00f3pialo y p\u00e9galo en el navegador.\n\n${s.noAccount}\n\n\u00a1Buen viaje! \ud83e\uddf3`;

  await client.integrations.Core.SendEmail({ to, subject, body });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const {
      to,
      tripName,
      inviterName,
      inviterEmail,
      inviteUrl,
      destination,
      country,
      startDate,
      endDate,
      lang: rawLang,
    } = await req.json();

    if (!to || !inviteUrl) {
      return Response.json({ error: "Faltan datos del email (to / inviteUrl)" }, { status: 400 });
    }

    // Antes esta función solo exigía sesión iniciada — no comprobaba que
    // hubiera una invitación real detrás de `to`/`inviteUrl`. Cualquier
    // usuario autenticado de Kaikōdo podía invocarla con una URL y un
    // destinatario arbitrarios, y el sistema mandaba un email con la marca
    // oficial (dominio verificado en Resend) a esa dirección — un vector de
    // phishing/spam barato que se aprovecha de la reputación del remitente.
    // Se exige que exista un TripInvite pendiente real, creado por
    // createTripInvite, cuyo invite_token coincida con el de inviteUrl y
    // cuyo email/invited_by coincidan con `to`/quien llama — así no se puede
    // mandar el email "oficial" de Kaikōdo a nadie que no tenga ya una
    // invitación de verdad esperándolo.
    const normalizedTo = String(to).trim().toLowerCase();
    const normalizedActingEmail = user.email.toLowerCase();
    let tokenFromUrl = "";
    try {
      tokenFromUrl = new URL(inviteUrl).searchParams.get("token") || "";
    } catch {
      tokenFromUrl = "";
    }
    if (!tokenFromUrl) {
      return Response.json({ error: "inviteUrl inválida" }, { status: 400 });
    }

    const service = base44.asServiceRole;
    const matches = await service.entities.TripInvite.filter({ invite_token: tokenFromUrl });
    const realInvite = matches?.[0];
    const inviteValid =
      realInvite &&
      realInvite.status === "pending" &&
      (realInvite.email || "").toLowerCase() === normalizedTo &&
      (realInvite.invited_by || "").toLowerCase() === normalizedActingEmail;

    if (!inviteValid) {
      return Response.json(
        { error: "No hay una invitación pendiente real para ese destinatario." },
        { status: 403 }
      );
    }

    // El link que se manda en el email SIEMPRE se reconstruye aquí, con el
    // dominio real de la app y el token ya validado — se ignora el resto de
    // `inviteUrl` que mandó el cliente (dominio, query params extra, etc.).
    // Así, aunque alguien llame a esta función con un `inviteUrl` apuntando a
    // otro sitio, el email que sale de verdad siempre enlaza a kaikodo.app.
    const safeInviteUrl = `${APP_ORIGIN}/Invites?token=${encodeURIComponent(tokenFromUrl)}`;

    const lang = rawLang === "en" ? "en" : "es";
    const s = STRINGS[lang];

    const safeInviter = escapeHtml(inviterName || inviterEmail || (lang === "en" ? "Someone" : "Alguien"));
    const safeTrip = escapeHtml(tripName || "");
    const safeTo = escapeHtml(to);

    let datesLine = "";
    if (startDate) {
      const startFmt = formatDate(startDate, lang);
      datesLine = endDate ? `${startFmt} – ${formatDate(endDate, lang)}` : startFmt;
    }
    const destLine = destination ? `${escapeHtml(destination)}${country ? `, ${escapeHtml(country)}` : ""}` : "";

    const infoRows = [
      destLine ? `<strong>${s.destinationLabel}:</strong> ${destLine}` : "",
      datesLine ? `<strong>${s.datesLabel}:</strong> ${escapeHtml(datesLine)}` : "",
    ].filter(Boolean).join("<br>");

    const infoBox = infoRows
      ? `<tr><td style="padding:0 32px 22px;">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#fdfbf9" style="background-color:#fdfbf9;border:1px solid #e2ddd7;border-radius:10px;">
             <tr><td class="kodo-muted" style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#78716c;">${infoRows}</td></tr>
           </table>
         </td></tr>`
      : "";

    // Nota sobre modo oscuro: sin estas etiquetas, clientes como Outlook.com
    // invierten automáticamente los colores del email (fondo claro → negro,
    // texto oscuro → blanco), rompiendo el diseño por completo — es lo que
    // se vio en la primera prueba real. El meta "color-scheme" le dice a los
    // clientes que lo respetan que este email es solo para modo claro, y las
    // reglas [data-ogsc]/[data-ogsb] son el hook específico que usa
    // Outlook.com cuando ignora ese meta y fuerza su propio modo oscuro. El
    // atributo bgcolor (además del style) es redundancia a propósito: cada
    // motor de email respeta uno u otro de forma inconsistente.
    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  [data-ogsc] .kodo-bg, [data-ogsb] .kodo-bg { background-color:#f8f6f3 !important; }
  [data-ogsc] .kodo-card, [data-ogsb] .kodo-card { background-color:#ffffff !important; }
  [data-ogsc] .kodo-text, [data-ogsb] .kodo-text { color:#1b1917 !important; }
  [data-ogsc] .kodo-muted, [data-ogsb] .kodo-muted { color:#78716c !important; }
</style>
</head>
<body class="kodo-bg" style="margin:0;padding:0;background-color:#f8f6f3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f8f6f3" class="kodo-bg" style="background-color:#f8f6f3;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" bgcolor="#ffffff" class="kodo-card" style="max-width:480px;width:100%;background-color:#ffffff;border:1px solid #e8e3dc;border-radius:12px;">

<tr><td style="padding:26px 32px;text-align:center;border-bottom:1px solid #f0ede8;">
<img src="${LOGO_DATA_URI}" width="120" alt="Kaikōdo" style="display:inline-block;height:auto;max-width:120px;border:0;outline:none;" />
</td></tr>

<tr><td style="padding:28px 32px 8px;text-align:center;">
<p class="kodo-muted" style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#78716c;">${safeInviter} ${s.invitedBy}</p>
<h1 class="kodo-text" style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#1b1917;">${safeTrip}</h1>
</td></tr>

${infoBox}

<tr><td style="padding:0 32px 8px;text-align:center;">
<a href="${safeInviteUrl}" style="display:inline-block;background-color:#c2410c;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:13px 40px;border-radius:24px;">${s.button}</a>
</td></tr>

<tr><td style="padding:16px 32px 0;text-align:center;">
<p class="kodo-muted" style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9a9490;">${s.linkHint}</p>
<p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#c2410c;word-break:break-all;">${safeInviteUrl}</p>
</td></tr>

<tr><td style="padding:16px 32px 26px;border-top:1px solid #f0ede8;">
<p class="kodo-muted" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9a9490;line-height:1.6;">${s.noAccount}</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    const subject = lang === "en"
      ? `${inviterName || inviterEmail || "Someone"} ${s.subjectVerb} "${tripName || ""}" ${s.inKodo} ✈️`
      : `${inviterName || inviterEmail} ${s.subjectVerb} "${tripName}" ${s.inKodo} ✈️`;

    if (!RESEND_API_KEY) {
      try {
        await sendPlainFallback(base44, { to, inviterName, inviterEmail, tripName, safeInviteUrl, lang });
        return Response.json({ ok: true, fallback: true });
      } catch (fallbackErr) {
        return Response.json({ error: `Fallback: ${fallbackErr.message}` }, { status: 500 });
      }
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text().catch(() => "");
      try {
        await sendPlainFallback(base44, { to, inviterName, inviterEmail, tripName, safeInviteUrl, lang });
        return Response.json({ ok: true, fallback: true });
      } catch (fallbackErr) {
        return Response.json({ error: `Resend: ${errText || resendRes.status}; Fallback: ${fallbackErr.message}` }, { status: 502 });
      }
    }

    const data = await resendRes.json().catch(() => ({}));
    return Response.json({ ok: true, id: data?.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
