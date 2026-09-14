import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * uploadPrivateDocument — sube un documento (pasaporte, seguro, billete...)
 * a storage privado, server-side.
 *
 * Antes esto llamaba a base44.integrations.Core.UploadPrivateFile
 * directamente desde el cliente (ver src/lib/privateFiles.js) — dejaba esa
 * integración expuesta en el navegador: cualquiera con sesión podía
 * invocarla a mano en bucle, gastando créditos de subida sin ningún
 * control ni límite. Aquí se exige sesión antes de tocar la integración.
 *
 * El archivo llega como multipart/form-data (el SDK del cliente lo hace
 * así automáticamente cuando detecta un objeto File en el payload de
 * invoke() — no pasa por base64, no infla el tamaño).
 *
 * IMPORTANTE — pendiente de confirmar en vivo: no hay documentado en
 * ningún sitio cuál es el límite real de tamaño de payload para una
 * función de Base44. Antes de sustituir esto en el resto de sitios que
 * suben archivos (fotos de recibos, fotos de spot, avatar...), hay que
 * probar este endpoint concreto con un archivo grande de verdad (varios
 * MB) y confirmar que no se rompe. Se empieza por este porque es el de
 * menor impacto si falla.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return Response.json({ error: "Falta el archivo" }, { status: 400 });
    }

    const result = await base44.integrations.Core.UploadPrivateFile({ file });

    // José (14 sep 2026): antes el cliente pedía por su cuenta una URL
    // firmada de vista previa llamando a CreateFileSignedUrl directamente
    // (ver src/lib/privateFiles.js) -- misma exposición que ya se cerró
    // para UploadPrivateFile, solo que para esta integración se había
    // quedado sin corregir (ver getDocumentSignedUrl/entry.ts para el caso
    // de documentos ya guardados). Aquí es más simple todavía: como esta
    // función acaba de subir el archivo ella misma, puede firmar la vista
    // previa en el mismo paso sin exponer la integración al cliente para
    // nada -- no hace falta comprobar acceso a un Ticket porque el archivo
    // ni siquiera tiene ficha guardada todavía, lo acaba de subir quien
    // llama en este mismo momento.
    const SIGNED_URL_TTL_SECONDS = 60 * 60;
    const { signed_url: previewUrl } = await base44.integrations.Core.CreateFileSignedUrl({
      file_uri: result.file_uri,
      expires_in: SIGNED_URL_TTL_SECONDS,
    });

    return Response.json({ file_uri: result.file_uri, previewUrl });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
