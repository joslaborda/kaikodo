import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { leaveTrip } from '@/lib/tripMembers';
import { useAuth } from '@/lib/AuthContext';
import { normalizeEmail } from '@/lib/utils';
import { searchUserProfiles } from '@/lib/userProfiles';
import { notify, resolveUserIds } from '@/lib/notifications';
import { format, differenceInDays, parseISO, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowRight, ChevronDown, ChevronUp, Plus, Pencil, Trash2, X, Check, GripVertical, MapPin, Map, Utensils, Landmark, Ticket, ShoppingBag, CirclePlus, Hotel, Train, TrainFront, BusFront, Compass, Car, Ship, Shield, FileText, Loader2, Settings } from 'lucide-react';
import { PlaneIcon } from '@/lib/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import DocumentForm from '@/components/tickets/DocumentForm';
import PDFViewer from '@/components/PDFViewer';
import { resolveDocViewUrl } from '@/lib/privateFiles';
import SpotDetailModal from '@/components/trip/SpotDetailModal';
import DaySpotsMap from '@/components/spots/DaySpotsMap';
import SettingsDialog from '@/components/home/SettingsDialog';
import DeleteTripModal from '@/components/trip/DeleteTripModal';
import LeaveTripModal from '@/components/trip/LeaveTripModal';
import { enrichTicketDataWithAutoLinks } from '@/lib/autoLinkTickets';
import { daysUntil } from '@/lib/tripDays';
import { useTranslation } from 'react-i18next';

// ── Constants ─────────────────────────────────────────────────────────────────
const DOC_ICON_MAP = {
  flight: PlaneIcon, hotel: Hotel, train: Train,
  bus: Car, car: Car, ticket: Ticket, insurance: Shield, other: FileText,
};
const DOC_TRANSPORT = new Set(['flight','train','bus','boat','ferry']);
// Antes 'hotel' y las variantes de transporte (aeropuerto/tren/bus) no
// tenían entrada aquí — cualquier spot de ese tipo caía en el fallback
// CirclePlus ("+") en vez de un icono real. Mismos iconos que ya usa
// TYPE_CONFIG (spotsHelpers.jsx) y home/constants.jsx.
const SPOT_ICONS = {
  food:     Utensils,
  sight:    Landmark,
  activity: Ticket,
  shopping: ShoppingBag,
  custom:   CirclePlus,
  restaurant: Utensils,
  museum:   Landmark,
  hotel:    Hotel,
  transport: Compass,
  airport:  PlaneIcon,
  train:    TrainFront,
  bus:      BusFront,
};
const SPOT_COLORS = {
  food: 'bg-orange-50 dark:bg-orange-950/30 text-primary', sight: 'bg-violet-50 dark:bg-violet-950/30 text-violet-600',
  activity: 'bg-green-50 dark:bg-green-950/30 text-green-600', shopping: 'bg-blue-50 dark:bg-blue-950/30 text-blue-600',
  custom: 'bg-secondary text-muted-foreground', restaurant: 'bg-orange-50 dark:bg-orange-950/30 text-primary',
  museum: 'bg-violet-50 dark:bg-violet-950/30 text-violet-600',
  hotel: 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700', transport: 'bg-secondary text-muted-foreground',
  airport: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700', train: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700', bus: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700',
};

// Ticket.jsonc guarda el tipo de documento en `category` (ver DocumentForm.jsx
// y el mismo bug ya corregido 3 veces en InicioTab.jsx), no en `type` — con
// `.type` (siempre undefined en un documento real) DOC_TRANSPORT.has() nunca
// encontraba nada, así que el icono de avión/tren/bus entre dos ciudades en
// la vista Ruta no aparecía jamás. `doc_type` es un campo distinto (tipo de
// documento personal: pasaporte, DNI...) y se deja fuera a propósito.
function getTransportIcon(docs, cityStartDate) {
  if (!docs || !cityStartDate) return null;
  const doc = docs.find(d => {
    const docDate = d.date || d.valid_from || d.start_date;
    return docDate === cityStartDate && DOC_TRANSPORT.has(d.category || d.type);
  });
  if (!doc) return null;
  const t = doc.category || doc.type;
  const M = { flight: PlaneIcon, train: Train, bus: Car }; const I = M[t] || Ship; return I;
}

// ── Draggable spot list ───────────────────────────────────────────────────────
// ── Spot edit modal ───────────────────────────────────────────────────────────
function SpotEditModal({spot, open, onClose, onSave, onRemove }) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState(spot?.notes || '');
  const [time, setTime] = useState(spot?.assigned_time || '');
  useEffect(() => { if (spot) { setNotes(spot.notes || ''); setTime(spot.assigned_time || ''); } }, [spot]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span>{(() => { const I = SPOT_ICONS[spot?.type]; return I ? <I size={14} className='text-muted-foreground' /> : <MapPin size={14} className='text-muted-foreground' />; })()}</span>
            {spot?.title}
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 py-4 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-medium">{t('cities.day.time')}</p>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="h-9 border border-border rounded-xl px-3 text-sm text-foreground bg-secondary outline-none focus:border-primary w-[120px]"
              />
              {time && <button onClick={() => setTime('')} className="text-xs text-muted-foreground hover:text-foreground">{t('cities.day.remove')}</button>}
              {!time && <span className="text-xs text-muted-foreground">{t('cities.day.optional')}</span>}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-medium">{t('cities.day.personalNote')}</p>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('cities.day.notePlaceholder')}
              className="text-sm bg-secondary border-border resize-none"
              rows={3}
            />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <button onClick={() => onRemove(spot)}
            className="text-xs text-red-500 flex items-center gap-1.5 hover:text-red-700 transition-colors">
            <Trash2 className="w-3 h-3" />{t('cities.day.removeFromDay')}
          </button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-white"
              onClick={() => onSave(spot, notes, time)}>{t('common.save')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


// ── Doc viewer modal ──────────────────────────────────────────────────────────
const DOC_BG = { flight:'bg-blue-50 dark:bg-blue-950/30', hotel:'bg-purple-50 dark:bg-purple-950/30', train:'bg-green-50 dark:bg-green-950/30', bus:'bg-amber-50 dark:bg-amber-950/30', car:'bg-orange-50 dark:bg-orange-950/30', ticket:'bg-rose-50 dark:bg-rose-950/30', insurance:'bg-teal-50 dark:bg-teal-950/30', other:'bg-secondary' };

function DocViewerModal({ doc, open, onClose, onEdit }) {
  const { t } = useTranslation();
  const type = doc?.category || doc?.type || doc?.doc_type || 'other';
  const DocIcon = DOC_ICON_MAP[type] || FileText;
  const bgColor = DOC_BG[type] || 'bg-secondary';

  // Resuelve la URL en el momento de abrir — para documentos con file_uri
  // (storage privado) pide una URL firmada nueva cada vez en vez de reusar
  // una que podría haber caducado. Ver src/lib/privateFiles.js. La pestaña
  // se abre en blanco de forma SÍNCRONA (dentro del propio click) y se le
  // asigna la URL después de resolverla — abrirla ya tras el await podía
  // hacer que el navegador la tratase como pop-up no solicitado y la bloqueara.
  const openFile = async () => {
    if (!doc?.file_url && !doc?.file_uri) return;
    const win = window.open('', '_blank');
    const url = await resolveDocViewUrl(doc);
    if (url && win) win.location.href = url;
    else if (win) win.close();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm p-0 gap-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <div className={`w-10 h-10 rounded-xl ${bgColor} flex items-center justify-center shrink-0`}><DocIcon size={18} className='text-foreground opacity-70' /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{doc?.name || doc?.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 capitalize">{type} {doc?.date ? `· ${doc.date}` : ''}</p>
          </div>
          <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 rounded-full border border-border flex items-center justify-center shrink-0">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* File preview / upload zone */}
        {(doc?.file_url || doc?.file_uri) ? (
          <button onClick={openFile} className="mx-4 my-3 bg-secondary rounded-xl p-4 flex items-center gap-3 hover:bg-border/40 transition-colors text-left w-[calc(100%-2rem)]">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/30 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-red-600" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{t('cities.doc.view')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('cities.doc.tapToOpen')}</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary shrink-0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
        ) : (
          <div className="mx-4 my-3 border-2 border-dashed border-border rounded-xl p-4 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/40 mx-auto mb-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p className="text-xs text-muted-foreground">{t('cities.doc.noFile')}</p>
          </div>
        )}

        {/* Fields */}
        <div className="px-4 pb-3 flex flex-col gap-2 border-t border-border pt-3">
          {doc?.time && (
            <div className="flex gap-3"><span className="text-xs text-muted-foreground w-14 shrink-0 pt-0.5">{t('cities.doc.time')}</span><span className="text-sm text-primary font-medium">{doc.time}</span></div>
          )}
          {doc?.origin && (
            <div className="flex gap-3"><span className="text-xs text-muted-foreground w-14 shrink-0 pt-0.5">{t('cities.doc.origin')}</span><span className="text-sm text-foreground">{doc.origin}</span></div>
          )}
          {doc?.destination && (
            <div className="flex gap-3"><span className="text-xs text-muted-foreground w-14 shrink-0 pt-0.5">{t('cities.doc.destination')}</span><span className="text-sm text-foreground">{doc.destination}</span></div>
          )}
          {doc?.notes && (
            <div className="flex gap-3"><span className="text-xs text-muted-foreground w-14 shrink-0 pt-0.5">{t('cities.doc.notes')}</span><span className="text-sm text-foreground">{doc.notes}</span></div>
          )}
          {doc?.visibility === 'shared' && (
            <div className="flex gap-3 items-center"><span className="text-xs text-muted-foreground w-14 shrink-0">{t('cities.doc.with')}</span><span className="text-xs bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">{t('cities.doc.group')}</span></div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-between items-center">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t('cities.doc.close')}</Button>
            {(doc?.file_url || doc?.file_uri) && (
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-white" onClick={openFile}>
                {t('cities.doc.open')}
              </Button>
            )}
          </div>
          {onEdit && (
            <Button size="sm" variant="outline" onClick={onEdit} className="flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5" />{t('cities.doc.edit')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Day expanded content ──────────────────────────────────────────────────────
function DayContent({day, dayDate, docs, spots, tripId, cityId, isToday_, isTomorrow_, isEmpty, onReorderSpots, queryClient, trip, cities, itineraryDays, profiles, userId, currentUserEmail }) {
  const { t } = useTranslation();
  const [editingSpot, setEditingSpot] = useState(null);   // spot object — view+edit modal
  const [viewingDoc,  setViewingDoc]  = useState(null);   // doc object — view modal
  const [viewingFile, setViewingFile] = useState(null);   // file url — PDFViewer
  const [editingDoc,  setEditingDoc]  = useState(null);   // doc object — edit modal
  const [deleteDoc,   setDeleteDoc]   = useState(null);   // doc object — delete confirm (paridad con Documents.jsx)
  const [titleVal,    setTitleVal]    = useState(day?.title || '');
  const [titleEditing, setTitleEditing] = useState(false);
  const [addingNote,  setAddingNote]  = useState(false);
  const [editingNote, setEditingNote] = useState(null);   // noteIdx
  // Fix: borrar una nota no pedía confirmación ni se podía deshacer — el
  // botón "Eliminar" vivía justo al lado del campo de hora, así que parecía
  // borrar solo la hora. Paridad con el resto de flujos de borrado de la app
  // (documentos, gastos, fotos...), todos con un paso de confirmación.
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteTime, setNewNoteTime] = useState('');
  const [savingDoc,   setSavingDoc]   = useState(false);
  const [addingDoc,   setAddingDoc]   = useState(false);
  const [savingNewDoc, setSavingNewDoc] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState(false);
  const [order, setOrder]             = useState(null);   // manual drag order for no-time items
  const [showMap, setShowMap]          = useState(false);  // mapa colapsable del día (lazy: no carga nada hasta desplegar)
  const hasMappableSpots = spots.some(s => s.lat && s.lng);

  // Notes
  const parseNotes = (raw) => {
    if (!raw) return [];
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
    return raw.trim() ? [{ text: raw, time: '' }] : [];
  };
  const [notesList, setNotesList] = useState(() => parseNotes(day?.content));
  useEffect(() => { setNotesList(parseNotes(day?.content)); setTitleVal(day?.title || ''); }, [day?.id, day?.content, day?.title]);

  const updateNote = (i, field, val) => setNotesList(prev => prev.map((n, idx) => idx === i ? { ...n, [field]: val } : n));

  // trip_members controla quién puede volver a leer este día de itinerario
  // (rls de ItineraryDay). Si `trip` todavía no había cargado (conexión
  // lenta/intermitente) al crear un día nuevo, antes se guardaba con
  // trip_members:[] — invisible para siempre, ni siquiera para quien lo
  // creó, y parecía que el itinerario "se había borrado". Se bloquea la
  // creación en ese caso concreto (no la edición de un día que ya existe)
  // en vez de guardar un registro roto.
  const saveNotes = async (list) => {
    if (!day?.id && !trip?.members?.length) {
      toast({ title: t('common.error'), description: t('cities.tripNotLoadedRetry'), variant: 'destructive' });
      return;
    }
    setSavingNotes(true);
    const clean = (list || notesList).filter(n => n.text?.trim());
    const payload = { content: JSON.stringify(clean) };
    try {
      if (day?.id) await base44.entities.ItineraryDay.update(day.id, payload);
      else await base44.entities.ItineraryDay.create({ city_id: cityId, trip_id: tripId, date: dayDate, title: '', ...payload, order: 0, trip_members: trip.members });
      queryClient.invalidateQueries({ queryKey: ['itineraryDays', tripId] });
      queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
    } finally { setSavingNotes(false); }
  };

  const saveTitle = async () => {
    if (savingTitle) return;
    if (!day?.id && !trip?.members?.length) {
      toast({ title: t('common.error'), description: t('cities.tripNotLoadedRetry'), variant: 'destructive' });
      return;
    }
    setSavingTitle(true);
    try {
      if (day?.id) await base44.entities.ItineraryDay.update(day.id, { title: titleVal });
      else await base44.entities.ItineraryDay.create({ city_id: cityId, trip_id: tripId, date: dayDate, title: titleVal, content: '', order: 0, trip_members: trip.members });
      queryClient.invalidateQueries({ queryKey: ['itineraryDays', tripId] });
      setTitleEditing(false);
    } finally {
      setSavingTitle(false);
    }
  };

  const handleSpotSave = async (spot, newNotes, newTime) => {
    try {
            // Fix: editar solo la hora no reorganizaba el spot en el timeline si
            // ya tenia una posicion fijada por un arrastre anterior (day_order) --
            // se quedaba donde estaba el drag viejo en vez de moverse a su sitio
            // cronologico nuevo. Al cambiar la hora explicitamente se asume que
            // el usuario quiere que caiga en su hueco por hora, asi que se limpia
            // el pin de posicion (day_order) para que vuelva a ordenarse solo.
            const timeIsChanging = (newTime || '') !== (spot.assigned_time || '');
            await base44.entities.Spot.update(spot.id, {
                      notes: newNotes,
                      assigned_time: newTime || null,
                      ...(timeIsChanging ? { day_order: null } : {}),
            });
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      setEditingSpot(null);
    } catch (e) {
      // Antes esto no tenía try/catch — un fallo dejaba el modal a medias
      // (ni se cerraba ni avisaba de nada) sin que el usuario supiera si su
      // cambio se había guardado o no.
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    }
  };
  const handleSpotRemove = async (spot) => {
    try {
      await base44.entities.Spot.update(spot.id, { assigned_date: null, day_order: null, assigned_time: null });
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      setEditingSpot(null);
    } catch (e) {
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    }
  };

  const handleDocSave = async (data) => {
    setSavingDoc(true);
    const oldDoc = editingDoc;
    try {
      const enriched = enrichTicketDataWithAutoLinks(data, itineraryDays || [], data.city_id);
              // Fix: mismo problema que en handleSpotSave -- si el documento ya
              // tenia una posicion fijada por un arrastre anterior, cambiar solo la
              // hora no lo reubicaba en el timeline. Se limpia el pin cuando la
              // hora cambia de verdad para que vuelva a ordenarse por hora.
              const docTimeIsChanging = (data.time || '') !== (oldDoc?.time || '');
              await base44.entities.Ticket.update(oldDoc.id, { ...enriched, ...(docTimeIsChanging ? { day_order: null } : {}) });
      queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tripId] });
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      setEditingDoc(null);
      // Mismo hueco que se cerró en Documents.jsx: editar la hora de un
      // ticket (vuelo/tren/etc.) desde Ruta tampoco avisaba a nadie.
      const timeChanged = (data.time || '') !== (oldDoc?.time || '') || (data.end_time || '') !== (oldDoc?.end_time || '');
      if (timeChanged && (data.time || data.end_time) && data.visibility !== 'personal') {
        const sharedWith = data.visibility === 'selected_users'
          ? (data.shared_with || [])
          : (trip?.members || []).filter(e => normalizeEmail(e) !== normalizeEmail(currentUserEmail));
        const targets = sharedWith.filter(e => normalizeEmail(e) !== normalizeEmail(currentUserEmail));
        if (targets.length) {
          const myProfile = (profiles || []).find(p => normalizeEmail(p.email) === normalizeEmail(currentUserEmail));
          resolveUserIds(targets).then(resolved => {
            resolved.forEach(({ userId }) => notify({
              userId,
              type: 'doc_time',
              actor: myProfile,
              tripId,
              tripName: trip?.name,
              refId: oldDoc?.id,
              refTitle: data.name || oldDoc?.name || t('documents.docFallback'),
              refExtra: { time: data.time || null, endTime: data.end_time || null },
            }));
          });
        }
      }
    } catch (e) {
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    } finally { setSavingDoc(false); }
  };

  // Antes no existía — el DocumentForm de Ruta no pasaba onDelete, así que el
  // botón eliminar (condicional a ese prop) nunca se renderizaba aquí, aunque
  // en Documents.jsx sí (mismo DocumentForm, mismo Ticket.delete). Paridad 1:1
  // con la confirmación de Documents.jsx.
  const handleDocDelete = async () => {
    if (!deleteDoc || deletingDoc) return;
    setDeletingDoc(true);
    try {
    await base44.entities.Ticket.delete(deleteDoc.id);
    queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
    queryClient.invalidateQueries({ queryKey: ['tickets', tripId] });
    setDeleteDoc(null);
    setEditingDoc(null);
    } finally {
      setDeletingDoc(false);
    }
  };

  const handleDocCreate = async (data) => {
    if (!trip?.members?.length) {
      toast({ title: t('common.error'), description: t('cities.tripNotLoadedRetry'), variant: 'destructive' });
      return;
    }
    setSavingNewDoc(true);
    try {
      const enriched = enrichTicketDataWithAutoLinks(data, itineraryDays || [], data.city_id);
      await base44.entities.Ticket.create({ ...enriched, trip_id: tripId, user_id: userId, date: enriched.date || dayDate, trip_members: trip.members });
      queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      queryClient.invalidateQueries({ queryKey: ['tickets', tripId] });
      setAddingDoc(false);
    } finally { setSavingNewDoc(false); }
  };

  const handleAddNote = async () => {
    if (!newNoteText.trim()) return;
    const updated = [...notesList, { text: newNoteText.trim(), time: newNoteTime }];
    setNotesList(updated);
    setNewNoteText(''); setNewNoteTime(''); setAddingNote(false);
    await saveNotes(updated);
  };
  const handleDeleteNote = async (idx) => {
    const updated = notesList.filter((_, i) => i !== idx);
    setNotesList(updated);
    setEditingNote(null);
    await saveNotes(updated);
  };
  const handleSaveNote = async (idx) => {
    await saveNotes(notesList);
    setEditingNote(null);
  };

  const dayDocs = [...docs].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));

  // Timeline unificado: docs, notas y spots se intercalan en una sola
  // secuencia. Los que ya tienen una posición manual (_order explícito, no
  // nulo) forman la columna vertebral del orden; el resto se coloca por hora
  // si la tiene, o al final si no. En cuanto arrastras CUALQUIER cosa — doc,
  // nota o spot —, todo el día pasa a tener posición explícita y ese orden
  // manda de ahí en adelante: así cualquier item se puede colocar entre
  // cualquier otro, tenga hora o no. Antes solo los items sin hora eran
  // arrastrables, y solo entre ellos.
  const timeline = useMemo(() => {
    const docItems  = dayDocs.map(d  => ({ ...d,  _kind: 'doc',  _time: d.time || null, _order: d.day_order ?? null, _title: d.name || d.title || t('cities.day.docFallback'), _sub: d.origin && d.destination ? `${d.origin} → ${d.destination}` : null }));
    const spotItems = spots.map(s => ({ ...s,  _kind: 'spot', _time: s.assigned_time || null, _order: s.day_order ?? null, _title: s.title || t('cities.day.spotFallback'), _sub: s.notes || null }));
    // _noteIdx debe ser la posición REAL en notesList, no en la lista ya
    // filtrada por texto no vacío — antes se calculaba después del filter()
    // (map(..., i) sobre el resultado filtrado), así que si una nota tenía
    // texto vacío momentáneamente (p. ej. mientras se edita y se borra todo
    // el texto antes de guardar) intercalada entre otras, todas las notas
    // posteriores quedaban con el índice desplazado — editingNote/
    // handleDeleteNote usan este índice directo contra notesList[idx], así
    // que se podía editar o borrar la nota equivocada.
    const noteItems = notesList
      .map((n, i) => ({ ...n, _origIdx: i }))
      .filter(n => n.text?.trim())
      .map((n) => ({
        id: 'note-' + n._origIdx, _kind: 'note', _time: n.time || null, _order: n.order ?? null, _title: n.text, _sub: null, _noteIdx: n._origIdx,
      }));
    const all = [...docItems, ...spotItems, ...noteItems];
    const pinned = all.filter(i => i._order != null).sort((a, b) => a._order - b._order);
    const unpinnedTimed = all.filter(i => i._order == null && i._time).sort((a, b) => a._time.localeCompare(b._time));
    const unpinnedUntimed = all.filter(i => i._order == null && !i._time);

    const merged = [];
    let ui = 0;
    for (const item of pinned) {
      if (item._time) {
        while (ui < unpinnedTimed.length && unpinnedTimed[ui]._time <= item._time) {
          merged.push(unpinnedTimed[ui]);
          ui++;
        }
      }
      merged.push(item);
    }
    while (ui < unpinnedTimed.length) { merged.push(unpinnedTimed[ui]); ui++; }

    return [...merged, ...unpinnedUntimed];
  }, [dayDocs, spots, notesList]);

  // Al soltar un arrastre, se reescribe TODO el orden del día de una vez —
  // spots y docs vía day_order, notas vía el campo "order" dentro de su
  // content — así el orden queda siempre denso (0..N-1) y consistente sin
  // importar de qué tipo sea cada item.
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const touchDragId = useRef(null);
  // Fix (24-ago): draggable/onTouchStart estaban puestos en toda la fila, así
  // que cualquier scroll que empezara sobre un spot se interpretaba como un
  // intento de reordenar. Ahora solo el handle de los 6 puntos puede iniciar
  // un arrastre — para el ratón (HTML5 DnD, escritorio/web) via este ref
  // (se marca en el mousedown del handle, se consulta en onDragStart de la
  // fila); para touch, moviendo onTouchStart directamente al handle.
  const dragAllowedRef = useRef(false);

  // Se puede recolocar cualquier cosa donde quieras, EXCEPTO invertir el
  // orden entre dos items que ya tienen hora fija — un spot a las 14:00 no
  // puede terminar antes que uno a las 11:00. Si el drop deja esa inversión,
  // se rechaza entero (no se guarda nada, no cambia nada en pantalla) y se
  // avisa con un toast en vez de reordenar silenciosamente algo sin sentido.
  // Fix: mismo problema que en DayCard.jsx -- escaneaba toda la lista en
    // vez de mirar solo el item arrastrado, asi que una inversion antigua en
    // cualquier parte del dia bloqueaba cualquier arrastre nuevo aunque no
    // tuviera nada que ver. Ahora solo compara el item movido contra el
    // item con hora justo antes/despues de su nueva posicion.
    const findTimeClash = (orderedItems, movedId) => {
          const idx = orderedItems.findIndex(i => i.id === movedId);
          if (idx === -1) return null;
          const moved = orderedItems[idx];
          if (!moved._time) return null;
          let prev = null;
          for (let k = idx - 1; k >= 0; k--) { if (orderedItems[k]._time) { prev = orderedItems[k]; break; } }
          let next = null;
          for (let k = idx + 1; k < orderedItems.length; k++) { if (orderedItems[k]._time) { next = orderedItems[k]; break; } }
          if (prev && prev._time > moved._time) return [prev, moved];
          if (next && next._time < moved._time) return [moved, next];
          return null;
    };

  const reorderTimeline = async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const from = timeline.findIndex(i => i.id === fromId);
    const to = timeline.findIndex(i => i.id === toId);
    if (from === -1 || to === -1) return;
    const reordered = [...timeline];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    const clash = findTimeClash(reordered, moved.id);
    if (clash) {
      const [a, b] = clash;
      toast({
        title: t('common.timeClashTitle'),
        description: t('common.timeClashBody', { a: a._title, aTime: a._time, b: b._title, bTime: b._time }),
        variant: 'destructive',
      });
      return;
    }

    const spotUpdates = [];
    const docUpdates = [];
    const newNotes = [...notesList];
    let noteChanged = false;

    reordered.forEach((item, idx) => {
      if (item._kind === 'spot') { if (item.day_order !== idx) spotUpdates.push(base44.entities.Spot.update(item.id, { day_order: idx })); }
      else if (item._kind === 'doc') { if (item.day_order !== idx) docUpdates.push(base44.entities.Ticket.update(item.id, { day_order: idx })); }
      else if (item._kind === 'note' && newNotes[item._noteIdx] && newNotes[item._noteIdx].order !== idx) {
        newNotes[item._noteIdx] = { ...newNotes[item._noteIdx], order: idx };
        noteChanged = true;
      }
    });

    try {
      await Promise.all([...spotUpdates, ...docUpdates]);
      if (docUpdates.length) queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      if (spotUpdates.length) queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      if (noteChanged) await saveNotes(newNotes);
    } catch {
      // Best-effort: si falla, el próximo refetch vuelve a traer el orden anterior.
      // No se bloquea la UI por esto — reordenar no es una acción destructiva.
    }
  };

  const onDragStart = (e, id) => {
    if (!dragAllowedRef.current) { e.preventDefault(); return; }
    e.stopPropagation(); setDraggingId(id); e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver  = (e, id) => { e.preventDefault(); setDragOverId(id); };
  const onDrop = (e, id) => { e.preventDefault(); reorderTimeline(draggingId, id); setDraggingId(null); setDragOverId(null); };
  const onDragEnd = () => { setDraggingId(null); setDragOverId(null); dragAllowedRef.current = false; };
  const onTouchStart = (e, id) => { touchDragId.current = id; setDraggingId(id); };
  const onTouchMove = (e) => {
    if (!touchDragId.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const row = el?.closest?.('[data-item-id]');
    setDragOverId(row?.dataset?.itemId || null);
  };
  const onTouchEnd = () => {
    if (touchDragId.current && dragOverId) reorderTimeline(touchDragId.current, dragOverId);
    touchDragId.current = null;
    setDraggingId(null);
    setDragOverId(null);
  };

  const bgClass = isToday_ ? 'bg-orange-50/50 dark:bg-orange-950/10' : 'bg-card';
  const borderLeft = isToday_ ? 'border-l-2 border-l-primary' : '';

  const renderItem = (item, idx) => {
    const DocIcon = item._kind === 'doc' ? (DOC_ICON_MAP[item.category || item.type || item.doc_type] || FileText) : null;
    const isLast = idx === timeline.length - 1;
    const isDragging = draggingId === item.id;
    const isDragOver  = dragOverId === item.id && draggingId !== item.id;

    return (
      <div key={item.id || idx}
        data-item-id={item.id}
        draggable
        onDragStart={e => onDragStart(e, item.id)}
        onDragOver={e => onDragOver(e, item.id)}
        onDrop={e => onDrop(e, item.id)}
        onDragEnd={onDragEnd}
        className={`flex items-stretch border-t border-border transition-all select-none
          ${isDragging ? 'opacity-40' : ''}
          ${isDragOver ? 'bg-accent/20' : ''}
        `}>

        {/* Time column — único punto desde el que se puede iniciar un
            arrastre (los 6 puntos). Antes toda la fila era "draggable" y
            cualquier scroll que empezara sobre un spot se confundía con un
            intento de reordenar. */}
<div className="w-12 shrink-0 flex flex-col items-center pt-3.5 pb-1 pl-4 gap-0.5 touch-none cursor-grab"
  onMouseDown={() => { dragAllowedRef.current = true; }}
  onTouchStart={e => { e.stopPropagation(); onTouchStart(e, item.id); }}>
  {item._time && <span className="text-label2 font-medium text-primary leading-none whitespace-nowrap">{item._time}</span>}
  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5" />
  {!isLast && <div className="w-px flex-1 bg-border/50 mt-1.5" />}
        </div>

        {/* Tappable body — opens view */}
        <button
          onClick={() => {
            if (item._kind === 'doc') { if (item.file_url) setViewingFile(item.file_url); else setViewingDoc(item); }
            if (item._kind === 'spot') setEditingSpot(item);
            if (item._kind === 'note') setEditingNote(item._noteIdx);
          }}
          className="flex-1 flex items-center gap-3 px-3 py-3 hover:bg-secondary/20 transition-colors text-left min-w-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${item._kind === 'doc' ? 'bg-orange-50 dark:bg-orange-950/30' : (SPOT_COLORS[item.type] || 'bg-secondary')}`}>
            {item._kind === 'doc' && DocIcon
              ? <DocIcon size={15} className="text-primary" />
              : item._kind === 'note'
              ? <FileText size={14} className='text-muted-foreground' />
              : (() => { const SpI = SPOT_ICONS[item.type] || CirclePlus; return <SpI size={14} className={SPOT_COLORS[item.type]?.split(' ')[1] || 'text-muted-foreground'} />; })()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{item._title}</p>
            {item._sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item._sub}</p>}
          </div>
        </button>

        {/* Edit button */}
        <button
          onClick={e => {
            e.stopPropagation();
            if (item._kind === 'doc')  setEditingDoc(item);
            if (item._kind === 'spot') setEditingSpot(item);
            if (item._kind === 'note') setEditingNote(item._noteIdx);
          }}
          className="w-10 flex items-center justify-center shrink-0 border-l border-border hover:bg-secondary/30 transition-colors">
          <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
    );
  };

  return (
    <div className={`${bgClass} ${borderLeft}`} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>

      {/* Title */}
      <div className="px-4 py-3 border-t border-border bg-card">
        {titleEditing ? (
          <div className="flex items-center gap-2">
            <Input value={titleVal} onChange={e => setTitleVal(e.target.value)}
              placeholder={t('cities.day.titlePlaceholder')} className="flex-1 h-9 text-sm bg-secondary border-border"
              autoFocus onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setTitleEditing(false); }} />
            <button onClick={() => setTitleEditing(false)} className="text-muted-foreground p-1"><X className="w-4 h-4" /></button>
            <button aria-label={t('common.save')} onClick={saveTitle} disabled={savingTitle} className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0 disabled:opacity-60 disabled:pointer-events-none"><Check className="w-3.5 h-3.5 text-white" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => setTitleEditing(true)} className="flex-1 flex items-center gap-2 text-left group min-w-0">
              <span className={`flex-1 text-sm ${titleVal ? 'font-medium text-foreground' : 'text-muted-foreground italic'}`}>
                {titleVal || t('cities.day.addTitle')}
              </span>
              <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
            {hasMappableSpots && (
              <button
                onClick={() => setShowMap(s => !s)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors shrink-0 ${
                  showMap ? 'bg-primary text-white border-primary' : 'bg-card text-muted-foreground border-border hover:border-primary/40'
                }`}
              >
                <Map className="w-3.5 h-3.5" />
                {t('cities.day.map')}
                {showMap ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Day spots map — collapsed by default; lazy (no map-load quota until expanded) */}
      {showMap && hasMappableSpots && (
        <div className="px-4 pt-1 pb-3 bg-card border-t border-border">
          <DaySpotsMap spots={spots} height={220} onSelectSpot={setEditingSpot} />
        </div>
      )}

      {/* Timeline */}
      {timeline.map((item, idx) => renderItem(item, idx))}

      {/* Add actions */}
      <div className="flex border-t border-border">
        <button onClick={() => setAddingDoc(true)}
          className="flex-1 flex items-center justify-center py-3 text-sm font-semibold text-primary hover:bg-accent transition-colors border-r border-border">
          {t('cities.day.addDoc')}
        </button>
        <Link to={createPageUrl('Restaurants') + '?trip_id=' + tripId}
          className="flex-1 flex items-center justify-center py-3 text-sm font-semibold text-primary hover:bg-accent transition-colors border-r border-border">
          {t('cities.day.addSpot')}
        </Link>
        <button onClick={() => { setAddingNote(true); setNewNoteText(''); setNewNoteTime(''); }}
          className="flex-1 flex items-center justify-center py-3 text-sm font-semibold text-primary hover:bg-accent transition-colors">
          {t('cities.day.addNote')}
        </button>
      </div>

            {/* Add note — antes vivía inline en el flujo de la página (empujando el
          resto del contenido); ahora es una modal como el resto de "añadir"
          (documento, etc.), con más alto para escribir/leer cómodo. */}
      {addingNote && (
        <Dialog open={addingNote} onOpenChange={o => { if (!o) setAddingNote(false); }}>
          <DialogContent className="bg-card border-border max-w-lg p-0 gap-0 flex flex-col">
            <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
              <DialogTitle className="text-base font-semibold">{t('cities.day.addNote')}</DialogTitle>
            </DialogHeader>
            <div className="p-5">
              <Textarea value={newNoteText} onChange={e => setNewNoteText(e.target.value)}
                placeholder={t('cities.day.writeNotePlaceholder')} className="text-sm bg-secondary border-border resize-none w-full mb-3" rows={8} autoFocus />
              <div className="flex items-center gap-3 flex-wrap">
                <input type="time" value={newNoteTime} onChange={e => setNewNoteTime(e.target.value)}
                  className="h-8 border border-border rounded-lg px-2 text-xs bg-card text-foreground outline-none focus:border-primary w-[100px]" />
                <span className="text-xs text-muted-foreground">{t('cities.day.hourOptional')}</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setAddingNote(false)} className="text-xs text-muted-foreground px-4 py-2 rounded-full border border-border hover:bg-secondary/50 transition-colors">{t('common.cancel')}</button>
                  <button onClick={handleAddNote} disabled={!newNoteText.trim() || savingNotes}
                    className="text-xs text-white bg-primary px-4 py-2 rounded-full font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors">{t('common.save')}</button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit/read note — fix #8 (modal en vez de cuadro pequeño inline, ahora
          con 8 filas de alto para leer/escribir cómodo) y fix #9/#10 (borrar
          exigía confirmación de un paso, igual que el resto de la app; ya no
          se borra directo al tocar "Eliminar" junto a la hora). */}
      {editingNote !== null && notesList[editingNote] && (
        <Dialog open={editingNote !== null} onOpenChange={o => { if (!o) { setEditingNote(null); setConfirmDeleteNote(false); } }}>
          <DialogContent className="bg-card border-border max-w-lg p-0 gap-0 flex flex-col">
            <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
              <DialogTitle className="text-base font-semibold">{t('cities.day.note')}</DialogTitle>
            </DialogHeader>
            <div className="p-5">
              <Textarea value={notesList[editingNote].text} onChange={e => updateNote(editingNote, 'text', e.target.value)}
                className="text-sm bg-secondary border-border resize-none w-full mb-3" rows={8} />
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <input type="time" value={notesList[editingNote].time || ''} onChange={e => updateNote(editingNote, 'time', e.target.value)}
                  className="h-8 border border-border rounded-lg px-2 text-xs bg-card text-foreground outline-none focus:border-primary w-[100px]" />
                <span className="text-xs text-muted-foreground">{t('cities.day.hourOptional')}</span>
                <button onClick={() => setConfirmDeleteNote(true)} className="ml-2 text-xs text-red-500 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" />{t('cities.day.delete')}
                </button>
              </div>

              {confirmDeleteNote && (
                <div className="mt-2 mb-1 flex items-center justify-between gap-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl px-4 py-2.5">
                  <span className="text-xs text-red-600">{t('cities.day.deleteNoteConfirm')}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => setConfirmDeleteNote(false)} className="text-xs text-muted-foreground">{t('common.cancel')}</button>
                    <button onClick={() => { setConfirmDeleteNote(false); handleDeleteNote(editingNote); }} disabled={savingNotes} className="text-xs font-medium text-red-600 disabled:opacity-50">
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 justify-end mt-3">
                <button onClick={() => { setEditingNote(null); setConfirmDeleteNote(false); }} className="text-xs text-muted-foreground px-4 py-2 rounded-full border border-border hover:bg-secondary/50 transition-colors">{t('common.cancel')}</button>
                <button onClick={() => handleSaveNote(editingNote)} disabled={savingNotes} className="text-xs text-white bg-primary px-4 py-2 rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none">{t('common.save')}</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Add doc modal */}
      {addingDoc && (
        <Dialog open={addingDoc} onOpenChange={o => { if (!o) setAddingDoc(false); }}>
          <DialogContent className="bg-card border-border max-w-lg max-h-[92vh] p-0 gap-0 flex flex-col">
            <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
              <DialogTitle className="text-base font-semibold">{t('cities.day.addDocument')}</DialogTitle>
            </DialogHeader>
            <div className="px-5 py-4 overflow-y-auto flex-1">
              <DocumentForm
                cities={cities || []}
                itineraryDays={itineraryDays || []}
                members={trip?.members || []}
                profiles={profiles || []}
                tripCities={cities || []}
                currentUserEmail={currentUserEmail}
                initialData={{ date: dayDate }}
                minDate={trip?.start_date || undefined}
                maxDate={trip?.end_date || undefined}
                onSave={handleDocCreate}
                onCancel={() => setAddingDoc(false)}
                saving={savingNewDoc}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Spot modal — view + edit */}
      {editingSpot && (
        <SpotDetailModal
          spot={editingSpot}
          open={!!editingSpot}
          onClose={() => setEditingSpot(null)}
          onSave={() => { queryClient.invalidateQueries({ queryKey: ['spots', tripId] }); setEditingSpot(null); }}
          onRemove={handleSpotRemove}
          queryClient={queryClient}
          tripId={tripId}
          trip={trip}
          currentUserEmail={currentUserEmail}
          profiles={profiles}
        />
      )}

      {/* PDFViewer — opens file directly */}
      {viewingFile && (
        <PDFViewer fileUrl={viewingFile} onClose={() => setViewingFile(null)} />
      )}

      {/* Doc view modal — for docs without file */}
      {viewingDoc && (
        <DocViewerModal doc={viewingDoc} open={!!viewingDoc} onClose={() => setViewingDoc(null)}
          onEdit={() => { setEditingDoc(viewingDoc); setViewingDoc(null); }} />
      )}

      {/* Doc edit modal */}
      {editingDoc && (
        <Dialog open={!!editingDoc} onOpenChange={o => { if (!o) setEditingDoc(null); }}>
          <DialogContent className="bg-card border-border max-w-lg max-h-[92vh] p-0 gap-0 flex flex-col">
            <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
              <DialogTitle className="text-base font-semibold">{t('cities.day.editDocument')}</DialogTitle>
            </DialogHeader>
            <div className="px-5 py-4 overflow-y-auto flex-1">
              <DocumentForm
                initialData={editingDoc}
                cities={cities || []}
                itineraryDays={itineraryDays || []}
                members={trip?.members || []}
                profiles={profiles || []}
                tripCities={cities || []}
                currentUserEmail={currentUserEmail}
                onSave={handleDocSave}
                onCancel={() => setEditingDoc(null)}
                onDelete={() => setDeleteDoc(editingDoc)}
                saving={savingDoc}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Doc delete confirmation — misma UI que Documents.jsx */}
      {!!deleteDoc && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50" onClick={() => setDeleteDoc(null)}>
          <div className="bg-card w-full max-w-lg rounded-t-3xl p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="w-9 h-1 bg-border rounded-full mx-auto mb-5" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <p className="text-sm font-medium text-foreground">{t('documents.deleteConfirm')}</p>
            </div>
            <p className="text-xs text-muted-foreground mb-5 ml-11">{t('documents.deletePermanent', { name: deleteDoc?.name })}</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteDoc(null)} className="flex-1 py-3 border border-border rounded-full text-sm text-muted-foreground">{t('common.cancel')}</button>
              <button onClick={handleDocDelete} disabled={deletingDoc} className="flex-1 py-3 bg-primary text-white rounded-full text-sm font-medium disabled:opacity-60 disabled:pointer-events-none">{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Day row ───────────────────────────────────────────────────────────────────
function DayRow({ day, dateStr, allDocs, allSpots, tripId, cityId, isToday_, isTomorrow_, queryClient, defaultOpen, trip, cities, itineraryDays, profiles, userId, currentUserEmail }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? undefined : es;
  const [open, setOpen] = useState(defaultOpen);

  // Un día de tránsito (una ciudad termina el mismo día que la siguiente
  // empieza) tiene DOS filas con la misma fecha — una por ciudad. Antes este
  // filtro solo miraba la fecha, así que CUALQUIER documento de ese día
  // (de cualquier ciudad del viaje) aparecía duplicado en ambas filas. Ahora
  // exige también que el documento sea de esta ciudad — como origen
  // (city_id) o como destino de un vuelo/tren (arrival_city_id), mismo
  // criterio que ya usa CityTickets.jsx.
  const docs = useMemo(() =>
    allDocs.filter(d => {
      const dd = d.date || d.valid_from || d.start_date;
      if (dd !== dateStr) return false;
      if (!d.city_id && !d.arrival_city_id) return true; // sin ciudad asignada, no se pierde
      return d.city_id === cityId || d.arrival_city_id === cityId;
    }),
    [allDocs, dateStr, cityId]
  );

  const spots = useMemo(() =>
    allSpots
      .filter(s => s.assigned_date === dateStr && s.city_id === cityId)
      .sort((a, b) => (a.day_order ?? 999) - (b.day_order ?? 999)),
    [allSpots, dateStr, cityId]
  );

  const hasContent = docs.length > 0 || spots.length > 0;
  const isEmpty = !day?.title && !hasContent;
  const label = format(parseISO(dateStr), 'dd MMM', { locale: dateLocale });

  const rowBorder = isToday_ ? 'border-t-2 border-t-primary' : 'border-t border-t-border';
  const rowBg = isToday_ ? 'bg-orange-50/70 dark:bg-orange-950/20' : open ? 'bg-secondary/20' : 'bg-card hover:bg-secondary/10';

  // Pills de contenido
  const notesCount = day?.notes?.length || 0;
  const pillItems = [
    docs.length > 0 && { label: t('cities.day.docsCount', { count: docs.length }), cls: 'bg-orange-50 dark:bg-orange-950/30 text-primary' },
    spots.length > 0 && { label: t('cities.day.spotsCount', { count: spots.length }), cls: 'bg-violet-50 dark:bg-violet-950/30 text-violet-700' },
    notesCount > 0 && { label: t('cities.day.notesCount', { count: notesCount }), cls: 'bg-green-50 dark:bg-green-950/30 text-green-700' },
  ].filter(Boolean);

  return (
    <div className="mb-2">
      {/* Card */}
      <div className={`bg-card rounded-2xl border overflow-hidden ${isToday_ ? 'border-orange-200' : 'border-border'}`}>
        {/* Header */}
        <button onClick={() => setOpen(o => !o)}
          className="w-full flex items-stretch gap-0 text-left">
          {/* Franja lateral */}
          <div className={`w-1 self-stretch rounded-l-2xl flex-shrink-0 ${isToday_ ? 'bg-primary' : 'bg-transparent'}`} />
          {/* Contenido header */}
          <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
            {/* Fecha */}
            <div className="flex flex-col items-center w-9 flex-shrink-0">
              <span className={`text-lg font-bold leading-none ${isToday_ ? 'text-primary' : 'text-foreground'}`}>
                {format(parseISO(dateStr), 'd', { locale: dateLocale })}
              </span>
              <span className="text-micro uppercase tracking-wide font-semibold text-muted-foreground mt-0.5">
                {format(parseISO(dateStr), 'MMM', { locale: dateLocale })}
              </span>
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold truncate ${!day?.title && !hasContent ? 'text-muted-foreground italic font-normal' : 'text-foreground'}`}>
                {day?.title || (hasContent
                ? pillItems.map(p => p.label).join(' · ')
                : t('cities.day.tapToPlan'))}
              </p>
              {hasContent && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {pillItems.map((p, i) => (
                    <span key={i} className={`text-label font-bold px-2 py-0.5 rounded-full ${p.cls}`}>{p.label}</span>
                  ))}
                </div>
              )}
            </div>
            {/* Badges + chevron */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {isToday_ && <span className="text-label bg-primary text-white px-2 py-0.5 rounded-full font-semibold">{t('cities.day.today')}</span>}
              {isTomorrow_ && <span className="text-label bg-secondary text-muted-foreground border border-border px-2 py-0.5 rounded-full">{t('cities.day.tomorrow')}</span>}
              {open
                ? <ChevronUp className={`w-4 h-4 ${isToday_ ? 'text-primary' : 'text-muted-foreground'}`} />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </div>
        </button>

      {open && (
        <DayContent
          day={day}
          dayDate={dateStr}
          docs={docs}
          spots={spots}
          tripId={tripId}
          cityId={cityId}
          isToday_={isToday_}
          isTomorrow_={isTomorrow_}
          isEmpty={isEmpty}
          onReorderSpots={() => {}}
          queryClient={queryClient}
          trip={trip}
          cities={cities}
          itineraryDays={itineraryDays}
          profiles={profiles}
          userId={userId}
          currentUserEmail={currentUserEmail}
        />
      )}
      </div>
    </div>
  );
}

// ── City block ────────────────────────────────────────────────────────────────
function CityBlock({ city, idx, total, allDocs, allSpots, itineraryDays, tripId, isActive, isPast, queryClient, trip, cities, profiles, userId, forceOpenCityId, currentUserEmail }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? undefined : es;
  // Al venir de "Abrir <ciudad>" en Home (ver DayCard.jsx), llega el id
  // exacto de ESTA estancia — si la misma ciudad aparece dos veces en el
  // viaje (ida y vuelta a Lima, por ejemplo), cada una tiene su propio
  // city.id, así que se despliega justo la que corresponde y no cualquiera
  // con el mismo nombre.
  const shouldForceOpen = !!forceOpenCityId && city.id === forceOpenCityId;
  const [open, setOpen] = useState(isActive || shouldForceOpen);
  const blockRef = useRef(null);

  useEffect(() => {
    if (shouldForceOpen && blockRef.current) {
      blockRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
     
  }, [shouldForceOpen]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const tomorrowStr = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd');

  const cityDays = useMemo(() => {
    if (!city.start_date || !city.end_date) return [];
    try {
      const start = parseISO(city.start_date);
      const end = parseISO(city.end_date);
      if (end < start) return [];
      return eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'));
    } catch { return []; }
  }, [city]);

  const daysByDate = useMemo(() => {
    const m = {};
    itineraryDays.filter(d => d.city_id === city.id).forEach(d => { if (d.date) m[d.date] = d; });
    return m;
  }, [itineraryDays, city.id]);

  // Componente de icono, no un elemento — hay que renderizarlo como <TransportIcon />,
  // nunca como {transportIcon}: React no admite una referencia a función como hijo
  // (crashea la pantalla entera en cuanto hay un vuelo/tren/bus entre dos ciudades).
  const TransportIcon = useMemo(() =>
    getTransportIcon(allDocs, city.start_date),
    [allDocs, city.start_date]
  );

  return (
    <div className="mb-4" ref={blockRef}>
      {/* Ciudad header — colapsable */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-1 py-2 text-left">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          isPast ? 'bg-green-100 dark:bg-green-950/30 text-green-700' : isActive ? 'bg-primary text-white' : 'bg-orange-100 dark:bg-orange-950/30 text-primary'
        }`}>
          {isPast ? <Check size={10} className='text-green-700' /> : idx + 1}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-bold truncate ${isActive ? 'text-primary' : 'text-foreground'}`}>
            {city.name}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {city.start_date && city.end_date
              ? `${format(parseISO(city.start_date), 'dd MMM', { locale: dateLocale })} – ${format(parseISO(city.end_date), 'dd MMM', { locale: dateLocale })}`
              : t('cities.noDates')}
          </span>
        </div>
        {isPast && <span className="text-xs bg-green-100 dark:bg-green-950/30 text-green-700 px-2 py-0.5 rounded-full shrink-0 font-semibold">{t('cities.block.visited')}</span>}
        {isActive && <span className="text-xs bg-primary text-white px-2 py-0.5 rounded-full shrink-0 font-semibold">{t('cities.block.now')}</span>}
        {!isActive && !isPast && <span className="text-xs bg-orange-100 dark:bg-orange-950/30 text-primary px-2 py-0.5 rounded-full shrink-0 font-medium">{t('cities.block.next')}</span>}
        {open
          ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {/* Días sueltos debajo — mismas cards que ciudad única */}
      {open && (
        <div className="flex flex-col gap-2 mt-2">
          {cityDays.length === 0 && (
            <div className="bg-card border border-border rounded-2xl px-4 py-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">{t('cities.noDatesAssigned')}</p>
              <p className="text-xs text-primary">{t('cities.editTripForDates')}</p>
            </div>
          )}
          {cityDays.map(dateStr => (
            <DayRow
              key={dateStr}
              day={daysByDate[dateStr] || null}
              dateStr={dateStr}
              allDocs={allDocs}
              allSpots={allSpots}
              tripId={tripId}
              cityId={city.id}
              isToday_={dateStr === todayStr}
              isTomorrow_={dateStr === tomorrowStr}
              queryClient={queryClient}
              defaultOpen={dateStr === todayStr}
              trip={trip}
              cities={cities}
              itineraryDays={itineraryDays}
              profiles={profiles}
              userId={userId}
              currentUserEmail={currentUserEmail}
            />
          ))}
        </div>
      )}

      {/* Conector transporte entre ciudades */}
      {idx < total - 1 && TransportIcon && (
        <div className="flex items-center gap-3 px-2 py-3">
          <div className="flex-1 h-px bg-border" />
          <TransportIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Cities() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const userId = currentUser?.id ?? '';

  const [tripId, setTripId] = useState(null);

  // Llega desde "Abrir <ciudad>" en Home (DayCard.jsx) — antes ese enlace
  // llevaba a una página vieja (CityDetail) que ya no existe; ahora aterriza
  // aquí mismo, en Ruta, con la ciudad concreta desplegada.
  const focusCityId = new URLSearchParams(location.search).get('city_id');

  // Antes dependía solo de [navigate] (con exhaustive-deps deshabilitado a
  // propósito), leyendo window.location.search una sola vez al montar — a
  // diferencia de Documentos/Restaurantes/Gastos/Fotos/Traductor/Utilidades,
  // que usan useSearchParams() y sí recalculan en cada render. Con
  // location.search como dependencia real ya no hace falta el eslint-disable.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('trip_id');
    if (!id || id === 'null') { navigate(createPageUrl('TripsList'), { replace: true }); return; }
    setTripId(id);
    if (!focusCityId) window.scrollTo(0, 0);
  }, [navigate, location.search]);

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => tripId ? base44.entities.Trip.get(tripId) : null,
    enabled: !!tripId, staleTime: 30000,
  });

  // Configurar ruta (fechas del viaje + paradas): antes esto solo se podía
  // tocar desde Inicio, aunque el sitio natural para arreglar "puse mal las
  // ciudades o las fechas" es justo esta pantalla (Ruta). El diálogo ya
  // existía (SettingsDialog, usado en Home.jsx) — aquí se reutiliza tal
  // cual, solo que se abre directamente sin saltar a Inicio primero.
  // Ver Home.jsx: currentUser.email no está normalizado, pero
  // trip.roles/trip.created_by sí (TripsList.jsx) — auditoría 1.1.
  const currentUserEmail = normalizeEmail(currentUser?.email);
  const roles = trip?.roles || {};
  const isAdmin = !!trip && (roles[currentUserEmail] === 'admin' || normalizeEmail(trip?.created_by) === currentUserEmail);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const deleteTripMutation = useMutation({
    mutationFn: () => base44.entities.Trip.delete(tripId),
    onSuccess: () => { setDeleteOpen(false); navigate(createPageUrl('TripsList'), { replace: true }); },
    onError: () => toast({ title: t('trip.deleteError'), description: t('common.tryAgain'), variant: 'destructive' }),
  });

  // Mismo fix que en Home.jsx: exponer leaveTrip() (ya implementado en el
  // backend) para que un miembro no-admin pueda abandonar el viaje desde
  // Ajustes, aquí también, ya que Cities.jsx renderiza su propia instancia
  // de SettingsDialog.
  const leaveMutation = useMutation({
    mutationFn: () => leaveTrip(tripId),
    onSuccess: () => { setLeaveOpen(false); navigate(createPageUrl('TripsList'), { replace: true }); },
    onError: (e) => toast({ title: t('trip.leaveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  // OJO: esta query comparte queryKey ['cities', tripId] con Home.jsx y
  // useTripContext.js — ambos piden `.filter({trip_id}, 'order')`. Antes esta
  // pedía sin el 'order', así que React Query podía devolver aquí un fetch
  // en caché hecho por la otra pantalla (o viceversa) sin darse cuenta de que
  // la llamada real al backend era distinta — mismo dato final una vez
  // ordenado por fecha, pero abría la puerta a que una pantalla mostrara un
  // resultado "congelado" de una consulta anterior mientras la otra ya tenía
  // el dato fresco. Unificado para que las tres consultas sean IDÉNTICAS y
  // compartan una sola caché real.
  const { data: cities = [], isLoading: loadingCities } = useQuery({
    queryKey: ['cities', tripId],
    queryFn: () => base44.entities.City.filter({ trip_id: tripId }, 'order'),
    enabled: !!tripId, staleTime: 30000,
  });

  const { data: itineraryDays = [] } = useQuery({
    queryKey: ['itineraryDays', tripId],
    queryFn: () => base44.entities.ItineraryDay.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 30000,
  });

  const { data: allDocs = [] } = useQuery({
    queryKey: ['allDocs', tripId],
    queryFn: () => base44.entities.Ticket.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 60000,
  });

  // UserProfile.read se cerró en el rls (exponía email/nationality de todo
  // el mundo) — antes esto traía TODOS los perfiles de la app; ahora se pide
  // por los emails ya conocidos (trip.members) — ver src/lib/userProfiles.js.
  // Cambia el queryKey de 'allProfiles' a uno scoped al viaje porque ya no
  // son "todos los perfiles", para no compartir caché con pantallas que sí
  // siguen pidiendo el listado completo (Explore, CommunitySearch).
  const { data: profiles = [] } = useQuery({
    queryKey: ['tripProfiles', tripId, (trip?.members || []).join(',')],
    queryFn: () => searchUserProfiles({ emails: trip?.members || [] }),
    enabled: !!trip?.members?.length,
    staleTime: 5 * 60 * 1000,
  });

  const { data: allSpots = [] } = useQuery({
    queryKey: ['spots', tripId],
    queryFn: () => base44.entities.Spot.filter({ trip_id: tripId }),
    enabled: !!tripId, staleTime: 30000,
  });

  const sortedCities = useMemo(() =>
    [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
    [cities]
  );

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const tomorrowStr = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd');

  // El día en que una ciudad termina y la siguiente empieza (end_date de A ==
  // start_date de B) caía dentro del rango de AMBAS — cada bloque calculaba
  // isActive por su cuenta, así que las dos se pintaban "Ahora" a la vez.
  // Igual que ya hace getActiveCity() (lib/tripContext.js) para el resto de
  // la app, solo la PRIMERA ciudad en orden cronológico que cubre hoy cuenta
  // como activa; el resto se compara contra ese único id.
  const activeCityId = sortedCities.find(c =>
    c.start_date && c.end_date && todayStr >= c.start_date && todayStr <= c.end_date
  )?.id || null;

  // Progress
  const tripStart = trip?.start_date;
  const tripEnd = trip?.end_date;
  const totalDays = tripStart && tripEnd ? differenceInDays(parseISO(tripEnd), parseISO(tripStart)) + 1 : null;
  const dayNumber = tripStart && todayStr >= tripStart ? differenceInDays(parseISO(todayStr), parseISO(tripStart)) + 1 : null;
  const progress = totalDays && dayNumber ? Math.min(100, Math.round((dayNumber / totalDays) * 100)) : 0;
  const tripNotStarted = tripStart && todayStr < tripStart;
  const tripFinished = tripEnd && todayStr > tripEnd;
  const daysLeft = tripStart ? daysUntil(tripStart) : null;

  const activeCityName = useMemo(() => {
    const c = sortedCities.find(c => c.start_date && c.end_date && todayStr >= c.start_date && todayStr <= c.end_date);
    return c?.name || '';
  }, [sortedCities, todayStr]);

  if (!tripId) return null;

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="bg-background sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 pt-12 pb-0">
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('Home') + '?trip_id=' + tripId}>
              <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
                <ArrowRight className="w-4 h-4 rotate-180" />{t('cities.backHome')}
              </button>
            </Link>
            <button onClick={() => setSettingsOpen(true)} className="text-sm text-primary flex items-center gap-1 font-semibold">
              <Settings className="w-4 h-4" />{t('cities.configureRoute')}
            </button>
          </div>

          <h1 className="text-2xl font-semibold text-foreground mb-1">{t('cities.title')}</h1>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{t('cities.intro')}</p>

          {/* Progress */}
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">
              {tripNotStarted && daysLeft !== null ? t('cities.progress.daysLeft', { count: daysLeft }) :
               tripFinished ? t('cities.tripCompleted') :
               dayNumber && totalDays ? t('cities.progress.dayOf', { day: dayNumber, total: totalDays }) + (activeCityName ? ` · ${activeCityName}` : '') :
               t('cities.noDates')}
            </span>
            <span className={`text-xs font-medium ${tripFinished ? 'text-green-700' : 'text-primary'}`}>
              {tripFinished ? '100%' : progress > 0 ? `${progress}%` : ''}
            </span>
          </div>
          {(progress > 0 || tripFinished) && (
            <div className="h-1 bg-secondary rounded-full overflow-hidden mb-4">
              <div className={`h-full rounded-full transition-all ${tripFinished ? 'bg-green-600' : 'bg-primary'}`}
                style={{ width: `${tripFinished ? 100 : progress}%` }} />
            </div>
          )}
          {!(progress > 0 || tripFinished) && <div className="mb-3" />}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-5 py-5 pb-24">
        {loadingCities && sortedCities.length === 0 ? (
          <div className="text-center py-16">
            <Loader2 className="w-6 h-6 text-muted-foreground animate-spin mx-auto" />
          </div>
        ) : sortedCities.length === 0 ? (
          <div className="text-center py-16">
            <div className='w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4'><Map className='w-7 h-7 text-muted-foreground/50' /></div>
            <p className="text-muted-foreground mb-4">{t('cities.noCitiesYet')}</p>
            <Button onClick={() => setSettingsOpen(true)} className="bg-primary hover:bg-primary/90 text-white">
              <Plus className="w-4 h-4 mr-2" />{t('cities.addCity')}
            </Button>
          </div>
        ) : sortedCities.length === 1 ? (
          // Una sola ciudad — mostrar días directamente sin cabecera de ciudad
          <div className="flex flex-col gap-0">
            {(() => {
              const city = sortedCities[0];
              const cityDays = (() => {
                if (!city.start_date || !city.end_date) return [];
                try {
                  const start = parseISO(city.start_date);
                  const end = parseISO(city.end_date);
                  if (end < start) return [];
                  return eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'));
                } catch { return []; }
              })();
              const daysByDate = {};
              itineraryDays.filter(d => d.city_id === city.id).forEach(d => { if (d.date) daysByDate[d.date] = d; });
              if (cityDays.length === 0) return (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs text-muted-foreground mb-2">{t('cities.noDatesAssigned')}</p>
                  <p className="text-xs text-primary">{t('cities.editTripForDates')}</p>
                </div>
              );
              return cityDays.map(dateStr => (
                <DayRow
                  key={dateStr}
                  day={daysByDate[dateStr] || null}
                  dateStr={dateStr}
                  allDocs={allDocs}
                  allSpots={allSpots}
                  tripId={tripId}
                  cityId={city.id}
                  isToday_={dateStr === todayStr}
                  isTomorrow_={dateStr === tomorrowStr}
                  queryClient={queryClient}
                  defaultOpen={dateStr === todayStr}
                  trip={trip}
                  cities={cities}
                  itineraryDays={itineraryDays}
                  profiles={profiles}
                  userId={userId}
                  currentUserEmail={currentUserEmail}
                />
              ));
            })()}
          </div>
        ) : (
          // Varias ciudades — mostrar bloques por ciudad
          <div className="flex flex-col gap-0">
            {sortedCities.map((city, idx) => {
              const isPast = city.end_date && todayStr > city.end_date;
              const isActive = city.id === activeCityId;
              return (
                <CityBlock
                  key={city.id}
                  city={city}
                  idx={idx}
                  total={sortedCities.length}
                  allDocs={allDocs}
                  allSpots={allSpots}
                  itineraryDays={itineraryDays}
                  tripId={tripId}
                  isActive={isActive}
                  isPast={isPast}
                  queryClient={queryClient}
                  trip={trip}
                  cities={cities}
                  profiles={profiles}
                  userId={userId}
                  currentUserEmail={currentUserEmail}
                  forceOpenCityId={focusCityId}
                />
              );
            })}
          </div>
        )}
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        trip={trip}
        cities={sortedCities}
        tripId={tripId}
        isAdmin={isAdmin}
        profiles={profiles}
        currentUserEmail={currentUserEmail}
        onDelete={() => { setSettingsOpen(false); setDeleteOpen(true); }}
        onLeave={() => { setSettingsOpen(false); setLeaveOpen(true); }}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
          queryClient.invalidateQueries({ queryKey: ['cities', tripId] });
        }}
      />
      <DeleteTripModal
        open={deleteOpen} onOpenChange={setDeleteOpen}
        tripName={trip?.name || ''}
        onConfirm={() => deleteTripMutation.mutate()}
        isPending={deleteTripMutation.isPending}
      />
      <LeaveTripModal
        open={leaveOpen} onOpenChange={setLeaveOpen}
        tripName={trip?.name || ''}
        onConfirm={() => leaveMutation.mutate()}
        isPending={leaveMutation.isPending}
      />
    </div>
  );
}