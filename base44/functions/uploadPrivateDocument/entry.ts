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
    return Response.json({ file_uri: result.file_uri });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
