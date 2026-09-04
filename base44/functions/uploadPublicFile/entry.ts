import { createClientFromRequest } from "npm:@base44/sdk";

/**
 * uploadPublicFile -- sube un archivo a storage PÚBLICO de Base44,
 * server-side. Usada por los 5 sitios que antes llamaban a
 * base44.integrations.Core.UploadFile directamente desde el cliente:
 * foto de recibo de gasto, adjunto de chat, foto de spot, foto de galería
 * y avatar/portada de perfil (ver ExpenseForm.jsx, ChatTab.jsx,
 * SpotCard.jsx, Photos.jsx, Settings.jsx).
 *
 * Antes esa llamada se hacía directamente desde el cliente -- dejaba esa
 * integración expuesta en el navegador: cualquiera con sesión iniciada
 * podía invocarla a mano en bucle, gastando créditos de subida sin ningún
 * control ni límite. Aquí se exige sesión antes de tocar la integración,
 * igual que ya se hizo para uploadPrivateDocument (documentos privados).
 *
 * Deliberadamente compartida entre los 5 sitios en vez de una función por
 * sitio -- todos hacen exactamente lo mismo (recibir un archivo, subirlo,
 * devolver la URL pública), así que una función sola es más fácil de
 * mantener que cinco copias idénticas.
 *
 * Probado en vivo con un PDF de 10 MB en uploadPrivateDocument (mismo
 * patrón, misma plataforma) sin problema -- no hay motivo para esperar un
 * límite distinto aquí.
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

    const result = await base44.integrations.Core.UploadFile({ file });
    return Response.json({ file_url: result.file_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
