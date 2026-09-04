import { base44 } from '@/api/base44Client';

/**
 * Documentos (Ticket): antes se subían con UploadFile (storage PÚBLICO de
 * Base44) sin importar la visibilidad elegida en la app ("Solo yo",
 * "Elegir quién lo ve"...). Confirmado en vivo: un fetch directo a esa URL
 * SIN ningún token de sesión devuelve el archivo igual (200) — la
 * visibilidad de Kōdo solo protege la ficha del documento dentro de la app,
 * no el archivo en sí. Si esa URL se filtra (historial, captura, log de
 * red), cualquiera puede ver un pasaporte/seguro/billete para siempre, sin
 * pasar por la app.
 *
 * Fix: subir con UploadPrivateFile (da un file_uri, no una URL pública) y
 * resolver una URL firmada y temporal (CreateFileSignedUrl) solo en el
 * momento de verse — ver uploadDocFile()/resolveDocViewUrl() más abajo.
 *
 * Compatibilidad con documentos ya subidos antes de este fix: esos solo
 * tienen `file_url` (público) y ningún `file_uri` — siguen abriéndose igual
 * que siempre (no se puede migrar retroactivamente un archivo ya público sin
 * volver a subirlo). Los documentos nuevos guardan `file_uri` y
 * resolveDocViewUrl() lo prioriza sobre `file_url`.
 */

// 1h — margen cómodo para ver/descargar un documento sin que la URL caduque
// a mitad, sin dejarla viva más de lo necesario tampoco.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * `file_url` es texto libre editable por cualquier miembro del viaje (campo
 * legado, ver arriba) — sin esta validación, alguien podía guardar
 * 'javascript:alert(document.cookie)' como file_url de un Ticket, y en
 * cuanto otro miembro abriera ese documento (Cities.jsx le asigna la URL
 * directa a window.location.href, DocumentCard.jsx la pasa al visor de PDF)
 * ese código se ejecutaba en su sesión — XSS con acceso a la cuenta de la
 * víctima. Se valida aquí, en el único sitio del que salen todas las URLs
 * de visualización, en vez de en cada uno de los sitios que las consumen.
 */
function isSafeFileUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Sube un archivo de documento a storage privado — vía la función de
 * backend uploadPrivateDocument, no llamando a UploadPrivateFile
 * directamente (ver esa función para el motivo: esa integración estaba
 * expuesta en el navegador sin ningún control).
 * Devuelve { file_uri, previewUrl } — file_uri es lo que hay que guardar en
 * el Ticket; previewUrl es una URL firmada de corta duración, solo para
 * previsualizar dentro del propio formulario mientras se edita (no se
 * persiste).
 */
export async function uploadDocFile(file) {
  const result = await base44.functions.invoke('uploadPrivateDocument', { file });
  const data = result?.data ?? result;
  if (data?.error) throw new Error(data.error);
  const { file_uri } = data;
  const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({
    file_uri,
    expires_in: SIGNED_URL_TTL_SECONDS,
  });
  return { file_uri, previewUrl: signed_url };
}

/**
 * Resuelve la URL a usar para ABRIR/VER el archivo de un documento ya
 * guardado. Si tiene file_uri (subido tras este fix), pide una URL firmada
 * nueva cada vez (así nunca se enseña una caducada); si no, cae al file_url
 * público legado.
 */
export async function resolveDocViewUrl(ticket) {
  if (ticket?.file_uri) {
    try {
      const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({
        file_uri: ticket.file_uri,
        expires_in: SIGNED_URL_TTL_SECONDS,
      });
      if (signed_url && isSafeFileUrl(signed_url)) return signed_url;
    } catch {
      // Si falla la firma (red, etc.), probamos con el file_url legado si
      // existiera antes de rendirnos — mejor que dejar el botón sin hacer nada.
    }
  }
  const legacyUrl = ticket?.file_url || '';
  return isSafeFileUrl(legacyUrl) ? legacyUrl : '';
}
