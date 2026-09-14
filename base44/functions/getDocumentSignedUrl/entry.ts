import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * getDocumentSignedUrl — firma la URL temporal para ver un documento
 * privado (Ticket.file_uri), verificando primero que quien la pide tiene
 * acceso real a ESE Ticket.
 *
 * José (14 sep 2026): el panel de seguridad de Base44 marcó "Alto" por
 * exponer una integración que consume créditos directamente al cliente.
 * `CreateFileSignedUrl` se estaba llamando así (ver src/lib/privateFiles.js,
 * uploadDocFile()/resolveDocViewUrl()) — mismo patrón que ya se había
 * corregido una vez para UploadPrivateFile (ver uploadPrivateDocument/entry.ts),
 * pero se quedó sin aplicar aquí.
 *
 * El problema real no es solo "gasta créditos sin control": es que
 * CreateFileSignedUrl firma CUALQUIER file_uri que se le pida, sin
 * comprobar nada — alguien con sesión podía pedir la URL firmada de un
 * file_uri ajeno (adivinado, filtrado, visto en una respuesta de red de
 * otro documento) y ver un pasaporte/seguro/billete que no le pertenece,
 * saltándose por completo el rls de Ticket (visibility/shared_with).
 *
 * El fix: en vez de reimplementar aquí esas mismas reglas de acceso (visto
 * en Ticket.jsonc: created_by / visibility=shared+trip_members /
 * visibility=selected_users+shared_with), se hace Ticket.get() con el
 * cliente NORMAL de quien llama (no asServiceRole) -- si el rls de Ticket
 * no le deja leerlo, esta llamada ya falla sola, sin duplicar la lógica.
 * Solo si eso pasa se usa asServiceRole, exclusivamente para firmar la URL.
 */

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h, igual que antes en el cliente

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const { ticketId } = await req.json();
    if (!ticketId) {
      return Response.json({ error: "Falta ticketId" }, { status: 400 });
    }

    // Cliente normal (no asServiceRole) -- si el rls de Ticket.read no deja
    // ver este documento a quien llama, esto lanza/devuelve null y no se
    // llega a firmar nada.
    const ticket = await base44.entities.Ticket.get(ticketId).catch(() => null);
    if (!ticket) {
      return Response.json({ error: "No tienes acceso a este documento" }, { status: 403 });
    }
    if (!ticket.file_uri) {
      return Response.json({ error: "Este documento no tiene archivo privado" }, { status: 404 });
    }

    const service = base44.asServiceRole;
    const { signed_url } = await service.integrations.Core.CreateFileSignedUrl({
      file_uri: ticket.file_uri,
      expires_in: SIGNED_URL_TTL_SECONDS,
    });

    return Response.json({ signed_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
