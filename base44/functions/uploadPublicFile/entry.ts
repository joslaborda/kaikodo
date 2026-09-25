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


// José (25 sep 2026) -- escáner de seguridad (CWE-770): el tamaño y el tipo
// solo se comprobaban en el navegador (src/lib/uploadLimits.js), así que
// llamando a esta función a mano se podía subir un archivo de cientos de MB,
// en bucle, gastando almacenamiento y créditos. Ahora se comprueba aquí,
// ANTES de tocar la integración. Mismos topes que uploadLimits.js.
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB (adjuntos del chat); las fotos ya van a 15 MB desde el cliente
// Recibos, fotos de spot/galería/perfil y adjuntos del chat: imágenes y
// documentos. Vídeo y audio no se usan en ningún sitio y son los que pesan.
const BLOCKED_TYPE = /^(video|audio)\//i;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "No autenticado" }, { status: 401 });
    }

    // Antes de leer el cuerpo: si ya anuncia más del tope (con 1 MB de margen
    // para las cabeceras del multipart), se corta sin cargarlo en memoria.
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > MAX_BYTES + 1024 * 1024) {
      return Response.json({ error: "Archivo demasiado grande", max_mb: MAX_BYTES / 1024 / 1024 }, { status: 413 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return Response.json({ error: "Falta el archivo" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return Response.json({ error: "Archivo demasiado grande", max_mb: MAX_BYTES / 1024 / 1024 }, { status: 413 });
    }
    if (file.size === 0) {
      return Response.json({ error: "Archivo vacío" }, { status: 400 });
    }
    if (BLOCKED_TYPE.test(file.type || "")) {
      return Response.json({ error: "Tipo de archivo no permitido" }, { status: 415 });
    }

    const result = await base44.integrations.Core.UploadFile({ file });
    return Response.json({ file_url: result.file_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
