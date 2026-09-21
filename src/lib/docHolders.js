import { normalizeEmail } from '@/lib/utils';

// José (21 sep 2026): "quién puede ver un documento" y "quién lo va a usar"
// son cosas distintas. Un billete de tren puede estar visible para todo el
// grupo (por si hace falta) pero ser de UNA persona — y la tarjeta
// destacada de Home ("Tu próximo tren"), el aviso y el recordatorio deben
// saltar solo a quien lo usa, no a los 10 del grupo por cada billete.
//
// Ticket.used_by = emails de quienes van a usar el documento. Los documentos
// anteriores a este campo no lo tienen: se asume que son de quien los subió
// (created_by) — así el tren de Carlos deja de destacarse en el móvil de
// José sin tener que editar nada a mano.
export function docHolders(doc) {
  const list = Array.isArray(doc?.used_by) ? doc.used_by.filter(Boolean) : [];
  if (list.length) return list;
  return doc?.created_by ? [doc.created_by] : [];
}

export function isDocForUser(doc, email) {
  const me = normalizeEmail(email);
  if (!me) return false;
  const holders = docHolders(doc);
  // Un documento sin used_by ni created_by (importado o creado por otra vía) no
  // tiene dueño conocido: se trata como de todos, nunca como de nadie (así no
  // queda fuera de la Ruta y del billete destacado de todo el mundo).
  if (holders.length === 0) return true;
  return holders.some(e => normalizeEmail(e) === me);
}

// Nombre para mostrar de un email: display_name -> username -> email
// completo (nunca split('@'), regla del proyecto). `profiles` puede ser el
// array de perfiles (Home/Ruta) o el mapa por email (Documents.jsx).
export function profileFor(email, profiles) {
  const norm = normalizeEmail(email);
  if (Array.isArray(profiles)) return profiles.find(x => normalizeEmail(x?.email || x?.user_email) === norm) || null;
  if (profiles) return profiles[email] || Object.values(profiles).find(x => normalizeEmail(x?.email || x?.user_email) === norm) || null;
  return null;
}

export function displayNameFor(email, profiles) {
  const p = profileFor(email, profiles);
  return p?.display_name || p?.username || email;
}

// "Carlos" / "Carlos, Ana" / "Carlos +2" — solo los titulares que NO eres tú.
// Devuelve '' si el documento es solo tuyo (nada que aclarar).
export function otherHoldersLabel(doc, profiles, myEmail, max = 2) {
  const me = normalizeEmail(myEmail);
  const others = docHolders(doc).filter(e => normalizeEmail(e) !== me);
  if (!others.length) return '';
  const names = others.map(e => displayNameFor(e, profiles));
  return names.length > max ? names.slice(0, max).join(', ') + ' +' + (names.length - max) : names.join(', ');
}

// ¿Es un documento "de todo el grupo"? — lo usan TODOS los miembros del viaje
// (p. ej. un autobús para todos, la reserva del hotel).
export function isGroupWideDoc(doc, members = []) {
  if (!members.length) return false;
  const holders = docHolders(doc).map(normalizeEmail);
  if (holders.length === 0) return true; // sin dueño conocido = de todos
  return members.every(m => holders.includes(normalizeEmail(m)));
}

// José (21 sep 2026): Ruta y Home son TU itinerario — solo lo que tú vas a
// usar, más lo que es de todo el grupo. El billete de otro viajero no
// estorba ahí (sigue en Documentos y, en Ruta, plegado en "De otros
// viajeros"). Un documento sin used_by cuenta como de quien lo subió.
export function isDocInMyRoute(doc, email, members = []) {
  return isDocForUser(doc, email) || isGroupWideDoc(doc, members);
}

// Texto para una tarjeta de Documentos: "ti", "Carlos", "ti, Carlos" o
// "todo el grupo". labels = { you, everyone } ya traducidos.
export function holdersSummary(doc, profiles, myEmail, members = [], labels = {}) {
  if (isGroupWideDoc(doc, members) && members.length > 1) return labels.everyone || '';
  const me = normalizeEmail(myEmail);
  if (docHolders(doc).length === 0) return labels.everyone || '';
  return docHolders(doc)
    .map(e => (normalizeEmail(e) === me ? (labels.you || e) : displayNameFor(e, profiles)))
    .join(', ');
}

// ¿El servidor ya tiene programado un aviso para este usuario en este documento?
// Si es así, su móvil no programa el aviso local (saldrían dos iguales).
export function hasServerPushFor(ticket, userId) {
  if (!userId) return false;
  return (ticket?.reminder_push_ids || []).some(s => String(s).startsWith(userId + ':'));
}
