import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notify, resolveUserIds } from '@/lib/notifications';
import { scheduleTicketReminder, cancelTicketReminder } from '@/lib/localReminders';
import { Car, ChevronDown, ChevronUp, CirclePlus, FileText, Hotel, Lock, Pencil, Plus, Shield, Ticket, Train, Trash2, User, Users } from 'lucide-react';
import { PlaneIcon, BusFront } from '@/lib/icons';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, isToday, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import DocumentForm from '@/components/tickets/DocumentForm';
import PDFViewer from '@/components/PDFViewer';
import { enrichTicketDataWithAutoLinks, createBackfillMutation } from '@/lib/autoLinkTickets';
import OTabBar from '@/components/trip/OTabBar';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { normalizeEmail } from '@/lib/utils';
import { searchUserProfiles } from '@/lib/userProfiles';
import { resolveDocViewUrl } from '@/lib/privateFiles';

const DOC_ICONS = {
  flight:    PlaneIcon,
  train:     Train,
  hotel:     Hotel,
  bus:       BusFront,
  car:       Car,
  event:     Ticket,
  personal:  Shield,
  insurance: Shield,
  other:     CirclePlus,
};
const DOC_BG = { flight:'bg-blue-50', train:'bg-green-50', hotel:'bg-purple-50', event:'bg-orange-50', personal:'bg-amber-50', other:'bg-secondary' };
const ICON_BG = {
  flight:    'bg-blue-50 dark:bg-blue-950/30 text-blue-500',
  train:     'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600',
  hotel:     'bg-purple-50 dark:bg-purple-950/30 text-purple-500',
  bus:       'bg-amber-50 dark:bg-amber-950/30 text-amber-600',
  car:       'bg-amber-50 dark:bg-amber-950/30 text-amber-600',
  event:     'bg-orange-50 dark:bg-orange-950/30 text-primary',
  personal:  'bg-secondary text-muted-foreground',
  insurance: 'bg-secondary text-muted-foreground',
  other:     'bg-secondary text-muted-foreground',
};
const CAT_TABS = [
  { key:'all',    tk:'documents.cat.all'    },
  { key:'flight', tk:'documents.cat.flight' },
  { key:'hotel',  tk:'documents.cat.hotel'  },
  { key:'train',  tk:'documents.cat.train'  },
  { key:'other',  tk:'documents.cat.other'  },
];
const VIS = {
  personal:       { tk:'documents.visibility.personal', Icon: Lock,  cls:'bg-secondary text-muted-foreground' },
  shared:         { tk:'documents.visibility.group',    Icon: Users, cls:'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400'       },
  selected_users: { tk:'documents.visibility.selected', Icon: User,  cls:'bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'         },
};

// ── Doc row ───────────────────────────────────────────────────────────────────
function DocRow({ticket, onEdit, onDelete, onView }) {
  const { t, i18n } = useTranslation();
  // Locale dinámico según idioma activo — antes esta fila mostraba siempre
  // nombres de mes en español aunque el usuario tuviera la app en inglés.
  const dateLocale = i18n.language === 'en' ? undefined : es;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const cat  = ticket.category || 'other';
  const IconComp = DOC_ICONS[cat] || DOC_ICONS.other;
  const iconCls = ICON_BG[cat] || ICON_BG.other;
  const bg   = DOC_BG[cat]   || 'bg-secondary';
  const vis  = VIS[ticket.visibility || 'personal'];
  const todayDoc = ticket.date && isToday(parseISO(ticket.date));
  // file_uri: documentos subidos a storage privado tras el fix de
  // seguridad — no tienen file_url pero sí llevan archivo adjunto.
  const hasFile  = !!(ticket.file_url || ticket.file_uri);
  // Resuelve la URL de visualización en el momento del clic — para
  // file_uri (storage privado) pide una URL firmada nueva cada vez en vez
  // de guardar/reusar una que podría haber caducado. Ver src/lib/privateFiles.js.
  const handleView = async () => {
    const url = await resolveDocViewUrl(ticket);
    if (url) onView(url);
  };

  const displayName = ticket.name || (ticket.origin && ticket.destination
    ? `${ticket.origin} → ${ticket.destination}`
    : t('documents.row.noName'));
  const routeLabel = ticket.origin && ticket.destination
    ? `${ticket.origin} → ${ticket.destination}`
    : null;

  const timeLabel = ticket.time
    ? (ticket.end_time ? `${ticket.time} → ${ticket.end_time}` : ticket.time)
    : cat === 'hotel' && ticket.date
    ? t('documents.row.checkIn', { date: format(parseISO(ticket.date), 'dd MMM', { locale: dateLocale }) })
    : ticket.note_time || null;

  return (
    <div className={`bg-card rounded-xl overflow-hidden mb-2 border transition-all ${todayDoc ? 'border-orange-200' : 'border-border'}`}>
      {/* Main row */}
      <div className={`flex items-center gap-3 px-4 py-3 ${todayDoc ? 'bg-orange-50/40' : ''}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconCls}`}>
          <IconComp size={16} className="flex-shrink-0" />
        </div>
        <button onClick={() => hasFile && handleView()} className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">{displayName}</p>
          {routeLabel && <p className="text-xs text-muted-foreground mt-0.5">{routeLabel}</p>}
          {timeLabel && <p className="text-xs text-primary font-semibold mt-0.5">{timeLabel}</p>}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasFile && (
            <button onClick={handleView}
              className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/40 flex items-center justify-center hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          )}
          <button onClick={() => onEdit(ticket)}
            className="w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center hover:bg-secondary/50 transition-colors">
            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          {/* Sin este botón, `open` nunca pasaba a true — la tarjeta expandida
              (visibilidad, notas, fechas, aerolínea, ciudad...) era código
              muerto que el usuario no podía llegar a ver nunca. */}
          <button onClick={() => setOpen(o => !o)}
            aria-label={open ? t('common.collapse') : t('common.expand')}
            className="w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center hover:bg-secondary/50 transition-colors">
            {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
        </div>
      </div>

      {/* Expanded */}
      {open && (
        <div className="border-t border-border">
          <div className="px-4 py-3 bg-secondary/20 space-y-2">
            {/* Visibility badge */}
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${vis.cls}`}>
              {vis.Icon && <vis.Icon size={11} className="inline mr-1" />}{t(vis.tk)}
            </span>

            {/* Fields */}
            {ticket.origin && ticket.destination && (
              <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-12 shrink-0">{t('documents.row.route')}</span><span className="text-foreground">{ticket.origin} → {ticket.destination}</span></div>
            )}
            {ticket.date && (
              <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-12 shrink-0">{t('documents.row.date')}</span><span className="text-foreground">{format(parseISO(ticket.date), 'dd MMM yyyy', { locale: dateLocale })}</span></div>
            )}
            {ticket.end_date && (
              <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-12 shrink-0">{t('documents.row.end')}</span><span className="text-foreground">{format(parseISO(ticket.end_date), 'dd MMM yyyy', { locale: dateLocale })}</span></div>
            )}
            {ticket.airline && (
              <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-12 shrink-0">{t('documents.types.flight')}</span><span className="text-foreground">{ticket.airline}</span></div>
            )}
            {ticket.city && (
              <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-12 shrink-0">{t('documents.row.city')}</span><span className="text-foreground">{ticket.city}</span></div>
            )}
            {ticket.notes && (
              <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-12 shrink-0">{t('documents.row.notes')}</span><span className="text-foreground">{ticket.notes}</span></div>
            )}

            {/* File */}
            {hasFile && (
              <button onClick={handleView}
                className="w-full flex items-center gap-3 px-3 py-2 bg-card rounded-lg border border-border hover:border-primary/30 transition-colors text-left mt-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <span className="text-xs font-medium text-foreground flex-1">{t('documents.row.viewAttached')}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-card">
            <button onClick={() => onDelete(ticket)}
              className="text-xs text-red-500 flex items-center gap-1.5 hover:text-red-700 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />{t('common.delete')}
            </button>
            <button onClick={() => { onEdit(ticket); setOpen(false); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground flex items-center gap-1.5 hover:bg-secondary/50 transition-colors">
              <Pencil className="w-3 h-3" />{t('common.edit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Documents() {
  const { t, i18n } = useTranslation();
  // Locale dinámico según idioma activo — igual que en DocRow más arriba.
  const dateLocale = i18n.language === 'en' ? undefined : es;
  const { toast } = useToast();
  const tripId = new URLSearchParams(window.location.search).get('trip_id');
  const deepLinkDocId = new URLSearchParams(window.location.search).get('doc_id');
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  // normalizeEmail() en ambos lados de cualquier comparación de email — el
  // creador de un documento compartido con "usuarios seleccionados" podía no
  // ver su propio documento si su email de auth traía distinta capitalización
  // que el guardado en ticket.created_by/shared_with.
  const currentUserEmail = normalizeEmail(currentUser?.email) ?? '';
  const userId = currentUser?.id ?? '';

  const [catFilter, setCatFilter]   = useState('all');
  const [addOpen, setAddOpen]       = useState(false);
  const [editDoc, setEditDoc]       = useState(null);
  const [deleteDoc, setDeleteDoc]   = useState(null);
  const [viewFile, setViewFile]     = useState(null);

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets', tripId],
    queryFn: () => base44.entities.Ticket.filter({ trip_id: tripId }, '-date'),
    enabled: !!tripId, staleTime: 0,  // always fresh so new members see docs immediately
  });

  // Deep-link desde una notificación (bell in-app, o recordatorio local de
  // vuelo/tren/evento) con ?doc_id=... en la URL: abre directamente ese
  // documento en cuanto llega en `tickets`, en vez de dejar al usuario en la
  // lista general. Se limpia el parámetro de la URL nada más abrirlo (mismo
  // motivo que app-params.js con access_token) para que un refresh o un
  // "atrás" no lo vuelva a abrir solo.
  useEffect(() => {
    if (!deepLinkDocId || !tickets.length) return;
    const target = tickets.find(t => t.id === deepLinkDocId);
    if (target) setEditDoc(target);
    const url = new URL(window.location.href);
    url.searchParams.delete('doc_id');
    window.history.replaceState({}, '', url);
  }, [deepLinkDocId, tickets]);
  const { data: cities = [] } = useQuery({
    queryKey: ['cities', tripId],
    queryFn: () => base44.entities.City.filter({ trip_id: tripId }, 'order'), // misma queryKey ['cities', tripId] que otras pantallas — unificado para no compartir caché con fetches distintos
    enabled: !!tripId, staleTime: 60000,
  });
  const { data: itineraryDays = [] } = useQuery({
    queryKey: ['itineraryDays', tripId],
    queryFn: () => base44.entities.ItineraryDay.filter({ trip_id: tripId }, 'date'),
    enabled: !!tripId, staleTime: 30000,
  });
  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => base44.entities.Trip.get(tripId),
    enabled: !!tripId, staleTime: 60000,
  });
  // Perfiles solo de miembros del viaje — sin list() completas
  const tripMembers = trip?.members || [];
  const { data: memberProfiles = [] } = useQuery({
    queryKey: ['memberProfiles', tripMembers.join(',')],
    queryFn: async () => {
      if (!tripMembers.length) return [];
      // Antes: base44.entities.User.filter({email:{$in:tripMembers}}) para
      // sacar el user_id y de ahí pedir el perfil. Esa llamada devuelve
      // SIEMPRE 403 para cualquier usuario que no sea colaborador del
      // proyecto en Base44 ("Only collaborators can view the list of
      // users") — mismo hallazgo que en resolveUserIds (src/lib/
      // notifications.js). Al no tener try/catch, la query quedaba en
      // estado de error para siempre y memberProfiles se quedaba vacío —
      // en el selector de "Elegir quién lo ve" del formulario de documento
      // esto hacía que se mostraran los nombres tal cual venían de una
      // caché vieja de React Query en localStorage (de una sesión anterior
      // en el mismo navegador) en vez de los del viaje actual: se veía a
      // los dos miembros con el mismo nombre porque ambos "profile" caían
      // en el mismo dato cacheado y obsoleto. searchUserProfiles ya acepta
      // emails directamente (ya los tenemos en trip.members) — no hace
      // falta pasar primero por User.filter.
      return searchUserProfiles({ emails: tripMembers });
    },
    enabled: tripMembers.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const profilesByEmail = useMemo(() => {
    const map = {};
    memberProfiles.forEach(p => {
      const email = p.email || p.user_email;
      if (email) map[email] = p;
    });
    return map;
  }, [memberProfiles]);


  // Backfill auto-links
  useEffect(() => {
    if (!tickets.length || !itineraryDays.length) return;
    const updates = createBackfillMutation(tickets, itineraryDays, cities).filter(u => Object.keys(u.updates).length > 0);
    if (updates.length) {
      Promise.all(updates.map(({ ticketId, updates }) => base44.entities.Ticket.update(ticketId, updates)))
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['tickets', tripId] });
          // Home/Ruta (Cities.jsx, TodayTab.jsx, TomorrowTab.jsx, TripAlerts.jsx)
          // cachean los mismos documentos bajo la clave 'allDocs', no 'tickets'.
          // Sin esto, un documento subido/editado/borrado aquí no se reflejaba
          // ahí hasta que esa otra caché caducara por sí sola.
          queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
        });
    }
  }, [tripId, tickets.length, itineraryDays.length]);

  const createMutation = useMutation({
    // trip_members: copia de trip.members en el momento de crear — el rls de
    // Ticket compara contra esto (no puede comprobar la pertenencia al viaje
    // directamente, base44 no soporta condiciones cross-entity). Se mantiene
    // sincronizado por syncTripMembers() cada vez que cambia la membresía.
    // Si `trip` todavía no había cargado (conexión lenta/intermitente) se
    // guardaba antes con trip_members:[] — el documento quedaba invisible
    // para siempre, ni para quien lo subió. Se corta antes de crear algo roto.
    mutationFn: (data) => {
      if (!trip?.members?.length) throw new Error(t('cities.tripNotLoadedRetry'));
      return base44.entities.Ticket.create({ ...enrichTicketDataWithAutoLinks(data, itineraryDays, data.city_id), trip_id: tripId, user_id: userId, trip_members: trip.members });
    },
    onSuccess: (newDoc, data) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', tripId] });
      queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      setAddOpen(false);
      scheduleTicketReminder({ ...data, id: newDoc?.id, trip_id: tripId });
      // Notify members about new doc
      if (data.visibility !== 'personal') {
        const sharedWith = data.visibility === 'selected_users'
          ? (data.shared_with || [])
          : (trip?.members || []).filter(e => normalizeEmail(e) !== currentUserEmail);
        const targets = sharedWith.filter(e => normalizeEmail(e) !== currentUserEmail);
        if (targets.length) {
          resolveUserIds(targets).then(resolved => {
            resolved.forEach(({ userId }) => notify({
              userId,
              type: 'doc_added',
              actor: profilesByEmail[currentUserEmail],
              tripId,
              tripName: trip?.name,
              refId: newDoc?.id,
              refTitle: data.name || t('documents.docFallback'),
            }));
          });
        }
      }
    },
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Ticket.update(id, enrichTicketDataWithAutoLinks(data, itineraryDays, data.city_id)),
    onSuccess: (_updatedDoc, { data, oldDoc }) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', tripId] });
      queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      setEditDoc(null);
      cancelTicketReminder(oldDoc?.id);
      scheduleTicketReminder({ ...data, id: oldDoc?.id, trip_id: tripId });
      // Antes editar la hora de un ticket (vuelo/tren/etc.) no avisaba a
      // nadie — solo se notificaba al CREAR el documento. Mismo criterio de
      // destinatarios que doc_added (respeta visibility), pero disparado
      // solo si time/end_time cambiaron de verdad.
      const timeChanged = (data.time || '') !== (oldDoc?.time || '') || (data.end_time || '') !== (oldDoc?.end_time || '');
      if (timeChanged && (data.time || data.end_time) && data.visibility !== 'personal') {
        const sharedWith = data.visibility === 'selected_users'
          ? (data.shared_with || [])
          : (trip?.members || []).filter(e => normalizeEmail(e) !== currentUserEmail);
        const targets = sharedWith.filter(e => normalizeEmail(e) !== currentUserEmail);
        if (targets.length) {
          resolveUserIds(targets).then(resolved => {
            resolved.forEach(({ userId }) => notify({
              userId,
              type: 'doc_time',
              actor: profilesByEmail[currentUserEmail],
              tripId,
              tripName: trip?.name,
              refId: oldDoc?.id,
              refTitle: data.name || oldDoc?.name || t('documents.docFallback'),
              refExtra: { time: data.time || null, endTime: data.end_time || null },
            }));
          });
        }
      }
    },

    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Ticket.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets', tripId] });
      queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      setDeleteDoc(null);
    },
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  // Filter
  const filtered = useMemo(() => tickets.filter(ticket => {
    const vis = ticket.visibility || 'personal';
    const isOwner = normalizeEmail(ticket.created_by) === currentUserEmail || ticket.user_id === userId;
    // personal: only owner sees it
    if (vis === 'personal' && !isOwner) return false;
    // selected_users: owner or explicitly shared
    if (vis === 'selected_users' && !isOwner && !(ticket.shared_with || []).some(e => normalizeEmail(e) === currentUserEmail)) return false;
    // shared: all trip members — no extra check needed
    if (catFilter !== 'all') {
      if (catFilter === 'other') return !['flight','hotel','train'].includes(ticket.category);
      return ticket.category === catFilter;
    }
    return true;
  }), [tickets, catFilter, currentUserEmail, userId]);

  // Group by date
  const grouped = useMemo(() => {
    const todayStr    = format(new Date(), 'yyyy-MM-dd');
    const tomorrowStr = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd');
    const map = {};
    [...filtered]
      .sort((a, b) => ((a.date||'9999') < (b.date||'9999') ? -1 : (a.date||'9999') > (b.date||'9999') ? 1 : (a.time||'99:99').localeCompare(b.time||'99:99')))
      .forEach(ticket => { const k = ticket.date || '__none__'; (map[k] = map[k] || []).push(ticket); });

    return Object.entries(map).map(([date, items]) => ({
      date, items,
      isToday: date === todayStr,
      label: date === '__none__' ? t('documents.group.noDate')
        : date === todayStr    ? t('documents.group.today', { date: format(parseISO(date), 'dd MMM', { locale: dateLocale }) })
        : date === tomorrowStr ? t('documents.group.tomorrow', { date: format(parseISO(date), 'dd MMM', { locale: dateLocale }) })
        : format(parseISO(date), "dd MMM · eeee", { locale: dateLocale }),
    }));
  }, [filtered]);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const members = trip?.members || [];

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="bg-background sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-0">
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('Home') + '?trip_id=' + tripId}>
              <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                {t('documents.backHome')}
              </button>
            </Link>
            <button onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 text-primary text-sm font-medium hover:text-primary/80 transition-colors">
              <Plus className="w-4 h-4" />{t('documents.new')}
            </button>
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-1">{t('documents.title')}</h1>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{t('documents.intro')}</p>
          {/* Category tabs */}
          <OTabBar
              tabs={CAT_TABS.map(tab => ({key:tab.key,label:t(tab.tk)}))}
              activeKey={catFilter}
              onChange={setCatFilter}
            />
      </div>
      </div>

      {/* List */}
      <div className="max-w-3xl mx-auto px-5 py-5 pb-24">
        {grouped.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border text-center py-16 px-6">
            <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium text-foreground mb-1">{catFilter === 'all' ? t('documents.empty.titleAll') : t('documents.empty.titleCat')}</p>
            <p className="text-xs text-muted-foreground mb-5">{t('documents.empty.subtitle')}</p>
            <button onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-medium rounded-full hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" />{t('documents.add')}
            </button>
          </div>
        ) : grouped.map(({ date, label, items, isToday }) => (
          <div key={date} className="mb-6">
            <p className={`text-xs font-semibold uppercase tracking-wide mb-3 px-1 ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>{label}</p>
            {items.map(ticket => (
              <DocRow key={ticket.id} ticket={ticket} onEdit={setEditDoc} onDelete={setDeleteDoc} onView={setViewFile} />
            ))}
          </div>
        ))}
      </div>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[92vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
            <DialogTitle className="text-base font-semibold">{t('documents.add')}</DialogTitle>
          </DialogHeader>
          <div className="px-5 py-4 overflow-y-auto flex-1">
            <DocumentForm cities={cities} itineraryDays={itineraryDays} members={members} profiles={profilesByEmail} tripCities={cities}
              currentUserEmail={currentUserEmail}
              minDate={trip?.start_date || undefined} maxDate={trip?.end_date || undefined}
              onSave={(d) => createMutation.mutate(d)} onCancel={() => setAddOpen(false)} saving={createMutation.isPending}
              onView={(url) => { setEditDoc(null); setTimeout(() => setViewFile(url), 150); }} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editDoc} onOpenChange={(o) => { if (!o) setEditDoc(null); }}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[92vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
            <DialogTitle className="text-base font-semibold">{t('documents.editTitle')}</DialogTitle>
          </DialogHeader>
          {editDoc && (
            <div className="px-5 py-4 overflow-y-auto flex-1">
              <DocumentForm cities={cities} itineraryDays={itineraryDays} members={members} profiles={profilesByEmail} tripCities={cities}
                currentUserEmail={currentUserEmail}
                initialData={editDoc}
                minDate={trip?.start_date || undefined} maxDate={trip?.end_date || undefined}
                onSave={(d) => updateMutation.mutate({ id: editDoc.id, data: d, oldDoc: editDoc })}
                onCancel={() => setEditDoc(null)}
                onDelete={() => { setDeleteDoc(editDoc); setEditDoc(null); }}
                saving={updateMutation.isPending}
                onView={(url) => { setEditDoc(null); setTimeout(() => setViewFile(url), 150); }} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
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
              <button onClick={() => deleteMutation.mutate(deleteDoc.id, { onSuccess: () => cancelTicketReminder(deleteDoc.id) })} disabled={deleteMutation.isPending} className="flex-1 py-3 bg-primary text-white rounded-full text-sm font-medium disabled:opacity-60 disabled:pointer-events-none">{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* File viewer */}
      <PDFViewer fileUrl={viewFile} onClose={() => setViewFile(null)} />
    </div>
  );
}
