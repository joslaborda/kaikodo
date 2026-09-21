// José (21 sep 2026): "llega la hora del tren y pum, ¿dónde está?". Un billete que solo
// se puede abrir con conexión falla justo donde más se necesita: la estación, el
// aeropuerto, un túnel. Aquí se guardan EN EL MÓVIL los archivos de los documentos
// (IndexedDB) para poder abrirlos sin red y al instante.
//
// Reglas:
//  · Se guarda con el archivo tal cual (Blob) y la referencia de la que salió
//    (file_uri / file_url): si el archivo del documento se cambia, la copia vieja
//    deja de valer sola.
//  · Best-effort: si IndexedDB no existe o falla, todo sigue funcionando como antes
//    (con red). Nada de esto puede impedir abrir un documento.
//  · Se borra al cerrar sesión (clearTicketCache) — son documentos personales.
const DB_NAME = 'kodo-ticket-files';
const STORE = 'files';
export const MAX_TICKET_BYTES = 20 * 1024 * 1024;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('sin IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let request;
    const tx = db.transaction(STORE, mode);
    try { request = fn(tx.objectStore(STORE)); } catch (e) { db.close(); reject(e); return; }
    tx.oncomplete = () => { db.close(); resolve(request?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

// Referencia estable del archivo de un documento.
export const ticketFileKey = (ticket) => (ticket?.file_uri || ticket?.file_url || '');

const EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'jpg', 'image/jpeg': 'jpg' };

export async function saveTicketBlob(ticket, blob) {
  try {
    if (!ticket?.id || !blob || blob.size === 0 || blob.size > MAX_TICKET_BYTES) return false;
    const fileKey = ticketFileKey(ticket);
    if (!fileKey) return false;
    await run('readwrite', (s) => s.put({ id: ticket.id, fileKey, blob, type: blob.type || '', date: ticket.date || '', savedAt: Date.now() }));
    return true;
  } catch { return false; }
}

async function getRecord(id) {
  try { return (await run('readonly', (s) => s.get(id))) || null; } catch { return null; }
}

// ¿Hay copia válida (mismo archivo) de este documento?
export async function hasCachedTicket(ticket) {
  const rec = ticket?.id ? await getRecord(ticket.id) : null;
  return !!rec && rec.fileKey === ticketFileKey(ticket);
}

// URL local para el visor. El visor decide "PDF o imagen" mirando la propia URL, y
// una URL blob: no dice nada — por eso se le añade un #ticket.pdf / #ticket.jpg
// (el fragmento no cuenta al leer el blob).
export async function getCachedTicketUrl(ticket) {
  const rec = ticket?.id ? await getRecord(ticket.id) : null;
  if (!rec || rec.fileKey !== ticketFileKey(ticket) || !rec.blob) return '';
  try {
    const ext = EXT[rec.type] || (rec.type.startsWith('image/') ? 'jpg' : 'pdf');
    return `${URL.createObjectURL(rec.blob)}#ticket.${ext}`;
  } catch { return ''; }
}

export async function listCachedTickets() {
  try { return (await run('readonly', (s) => s.getAll())) || []; } catch { return []; }
}

export async function removeCachedTicket(id) {
  try { await run('readwrite', (s) => s.delete(id)); } catch { /* best-effort */ }
}

export async function clearTicketCache() {
  try { await run('readwrite', (s) => s.clear()); } catch { /* best-effort */ }
}
