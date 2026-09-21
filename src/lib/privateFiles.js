import { base44 } from '@/api/base44Client';
import i18n from '@/i18n';
import { toast } from '@/components/ui/use-toast';
import { getCachedTicketUrl, saveTicketBlob, ticketFileKey, hasCachedTicket, listCachedTickets, removeCachedTicket, MAX_TICKET_BYTES } from '@/lib/ticketCache';

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
  // file_uri y previewUrl (URL firmada de corta duración) los devuelve ya
  // la propia función de subida -- ver el comentario en
  // uploadPrivateDocument/entry.ts sobre por qué CreateFileSignedUrl ya no
  // se llama aparte desde aquí.
  const { file_uri, previewUrl } = data;
  return { file_uri, previewUrl };
}

/**
 * Resuelve la URL a usar para ABRIR/VER el archivo de un documento ya
 * guardado. Si tiene file_uri (subido tras este fix), pide una URL firmada
 * nueva cada vez (así nunca se enseña una caducada); si no, cae al file_url
 * público legado.
 */
async function resolveRemoteDocUrl(ticket) {
  if (ticket?.file_uri && ticket?.id) {
    try {
      // José (14 sep 2026): antes esto llamaba a CreateFileSignedUrl
      // directamente desde el cliente con el file_uri en crudo -- firmaba
      // CUALQUIER file_uri que se le pidiera, sin comprobar si quien llama
      // tiene de verdad acceso a ESE documento (saltándose el rls de
      // Ticket). Ahora pasa por getDocumentSignedUrl, que primero hace
      // Ticket.get(ticketId) con el cliente normal (no de servicio) -- si
      // el rls no le deja leerlo, ya falla ahí, antes de firmar nada.
      const result = await base44.functions.invoke('getDocumentSignedUrl', { ticketId: ticket.id });
      const data = result?.data ?? result;
      if (data?.error) throw new Error(data.error);
      const signed_url = data?.signed_url;
      if (signed_url && isSafeFileUrl(signed_url)) return signed_url;
    } catch {
      // Si falla la firma (red, sin acceso, etc.), probamos con el file_url
      // legado si existiera antes de rendirnos — mejor que dejar el botón
      // sin hacer nada.
    }
  }
  const legacyUrl = ticket?.file_url || '';
  return isSafeFileUrl(legacyUrl) ? legacyUrl : '';
}

/**
 * URL para ABRIR el archivo de un documento — el único sitio del que salen todas.
 *
 * Orden: 1) la copia guardada en el móvil (instantánea y sin red — ver
 * src/lib/ticketCache.js); 2) una URL firmada nueva. Si no hay ni copia ni red, se
 * AVISA (antes el botón "Ver billete" se quedaba sin hacer nada, sin decir por qué).
 */
export async function resolveDocViewUrl(ticket) {
  const cached = await getCachedTicketUrl(ticket);
  if (cached) return cached;
  const remote = await resolveRemoteDocUrl(ticket);
  if (remote) return remote;
  if (ticketFileKey(ticket)) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    toast({
      title: i18n.t(offline ? 'offline.ticketUnavailable' : 'offline.ticketFailed'),
      description: i18n.t(offline ? 'offline.ticketUnavailableHint' : 'offline.ticketFailedHint'),
      variant: 'destructive',
    });
  }
  return '';
}

/**
 * Guarda en el móvil los archivos de los próximos días (de ayer a dentro de 4 días)
 * para poder abrirlos sin conexión. Se llama al abrir Home con red. Tope de 12
 * archivos, uno detrás de otro y sin molestar: cualquier fallo se ignora.
 * También retira las copias de documentos que ya no existen o pasaron hace días.
 */
export async function prefetchTicketFiles(tickets = []) {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // Modo "ahorro de datos" del móvil: no se descarga nada por su cuenta.
    if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return;
    const day = 86400000;
    const now = Date.now();
    const inWindow = (d) => {
      const t = Date.parse((d.date || d.valid_from || d.start_date || '') + 'T00:00:00');
      return Number.isFinite(t) && t >= now - day && t <= now + 4 * day;
    };
    // El orden de `tickets` manda (quien llama pone primero lo suyo). Tope de 12
    // archivos y de 40 MB por pasada: un viaje con fotos de billetes de varios MB
    // no debe gastarse los datos del móvil (roaming) sin avisar.
    const wanted = tickets.filter(d => d?.id && ticketFileKey(d) && inWindow(d)).slice(0, 12);
    let budget = 40 * 1024 * 1024;

    // limpieza: copias de documentos que ya no están o cuyo día pasó hace más de 3 días
    const keepIds = new Set(tickets.map(d => d.id));
    for (const rec of await listCachedTickets()) {
      const t = Date.parse((rec.date || '') + 'T00:00:00');
      if (!keepIds.has(rec.id) || (Number.isFinite(t) && t < now - 3 * day)) await removeCachedTicket(rec.id);
    }

    for (const d of wanted) {
      if (await hasCachedTicket(d)) continue;
      const url = await resolveRemoteDocUrl(d);
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size > MAX_TICKET_BYTES) continue;
      if (blob.size > budget) break;
      budget -= blob.size;
      await saveTicketBlob(d, blob);
    }
  } catch {
    // best-effort: nunca debe afectar a la pantalla
  }
}
