import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, Mail, Search, Share2, X, Link2, MessageCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { sendTripInvite } from '@/lib/invites';
import { getOrCreateTripInviteLink, buildTripInviteLinkUrl, buildTripInviteLinkShareText } from '@/lib/inviteLinks';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Avatar from '@/components/trip/Avatar';
import { normalizeEmail } from '@/lib/utils';
import { searchUserProfiles } from '@/lib/userProfiles';

function ResultRow({ profile, email, triplesCount, status, onInvite, sending }) {
  const { t } = useTranslation();
  // status: 'member' | 'pending' | 'available'
  // display_name/username son obligatorios en UserProfile — si no aparecen
  // ninguno, es que no llegó perfil (búsqueda por email suelto sin match),
  // no que la persona no tenga nombre. Nunca se muestra el email en su lugar.
  const name = profile?.display_name || profile?.username || t('common.member');
  const username = profile?.username ? `@${profile.username}` : '';
  const isBusy = status !== 'available' || sending;

  return (
    <button
      onClick={() => status === 'available' && !sending && onInvite(profile, email)}
      disabled={isBusy}
      className={`w-full flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 text-left transition-colors
        ${status === 'available' && !sending ? 'hover:bg-secondary/30 active:bg-secondary/50' : 'opacity-50 cursor-default'}`}
    >
      <Avatar email={email} profile={profile} size={38} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Antes "truncate" cortaba cualquier nombre algo largo con "…"
              (p.ej. "Carlos …") — quitado para todos los nombres de esta
              modal, se ven completos siempre, aunque la fila ocupe algo más
              de una línea. */}
          <p className="text-sm font-medium text-foreground">{name}</p>
          {triplesCount > 0 && (
            <span className="text-xs bg-orange-50 text-primary border border-orange-200 rounded-full px-2 py-0.5 flex-shrink-0">
              {t('invites.modal.tripCount', { count: triplesCount })}
            </span>
          )}
        </div>
        {username && <p className="text-xs text-muted-foreground">{username}</p>}
      </div>
      {status === 'member' && (
        <span className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5 flex-shrink-0 flex items-center gap-1">
          <Check className="w-3 h-3" />{t('common.member')}
        </span>
      )}
      {status === 'pending' && (
        <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 flex-shrink-0 flex items-center gap-1">
          <Clock className="w-3 h-3" />{t('common.pending')}
        </span>
      )}
      {status === 'available' && !sending && (
        <span className="text-xs text-primary font-medium flex-shrink-0">{t('invites.modal.invite')}</span>
      )}
      {status === 'available' && sending && (
        <span className="text-xs text-muted-foreground flex-shrink-0">{t('invites.modal.sending')}</span>
      )}
    </button>
  );
}

// José (14 sep 2026): "el apartado de con quién ya has viajado ocupa
// demasiado espacio así, algo parecido a Instagram con los avatares en
// grande" -- misma info que ResultRow (nombre, estado, nº de viajes juntos)
// pero en cuadrícula de avatares grandes en vez de filas apiladas, igual
// que la hoja de compartir de Instagram/WhatsApp.
// José (24 sep 2026): referencia estable. Con `= []` como valor por defecto se
// crea un array nuevo en cada render; el efecto de búsqueda depende de él y
// llamaba a setSearchResults([]) (otro array nuevo) -> render -> efecto... en
// bucle mientras la consulta de perfiles no tenía datos (cargando, o sin
// conexión si falla): la pantalla se quedaba colgada.
const NO_PROFILES = [];
export function GridAvatarItem({ profile, email, triplesCount, status, onInvite, sending }) {
  const { t } = useTranslation();
  const name = profile?.display_name || profile?.username || t('common.member');
  const isBusy = status !== 'available' || sending;
  return (
    <button
      onClick={() => status === 'available' && !sending && onInvite(profile, email)}
      disabled={isBusy}
      className={`flex flex-col items-center gap-1.5 ${isBusy ? 'opacity-45' : ''}`}
    >
      <div className="relative">
        <Avatar email={email} profile={profile} size={64} />
        {status === 'member' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-green-500 border-2 border-card flex items-center justify-center">
            <Check className="w-2.5 h-2.5 text-white" />
          </span>
        )}
        {status === 'pending' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-amber-400 border-2 border-card flex items-center justify-center">
            <Clock className="w-2.5 h-2.5 text-white" />
          </span>
        )}
      </div>
      <span className="text-xs text-foreground text-center leading-tight line-clamp-2 max-w-[72px]">{name}</span>
      {status === 'available' && triplesCount > 0 && (
        <span className="text-[10px] font-semibold text-primary bg-orange-50 border border-orange-200 rounded-full px-1.5 py-0.5">{t('invites.modal.tripCount', { count: triplesCount })}</span>
      )}
      {status === 'member' && <span className="text-[10px] text-green-600 font-medium">{t('common.member')}</span>}
      {status === 'pending' && <span className="text-[10px] text-amber-600 font-medium">{t('common.pending')}</span>}
    </button>
  );
}

export default function InviteModal({ open, onClose, trip, tripId, queryClient, profiles = NO_PROFILES, currentUserEmail = '', currentUserName = '' }) {
  const { t } = useTranslation();
  const [cancelling, setCancelling] = useState(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('search'); // 'search' | 'email'
  const [emailInput, setEmailInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [done, setDone] = useState(false);
  // José (14 sep 2026): "es súper sensible y si tocas a alguien sin querer
  // la invitación se manda directamente" -- ahora tocar una fila solo abre
  // esta confirmación, nunca envía nada por sí sola.
  const [confirmingInvite, setConfirmingInvite] = useState(null); // { profile, email } | null
  const [error, setError] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  const members = trip?.members || [];
  const roles = trip?.roles || {};

  // Pending invites
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['tripPendingInvites', tripId],
    queryFn: () => base44.entities.TripInvite.filter({ trip_id: tripId, status: 'pending' }),
    enabled: !!tripId && open,
    staleTime: 30000,
  });

  // Co-traveler history — load in background
  const { data: coTravelerEmails = [] } = useQuery({
    queryKey: ['coTravelers', currentUserEmail],
    queryFn: async () => {
      if (!currentUserEmail) return [];
      const allTrips = await base44.entities.Trip.filter({ created_by: currentUserEmail });
      const emails = new Map();
      const normalizedCurrentMembers = members.map(normalizeEmail);
      allTrips.forEach(t => {
        (t.members || []).forEach(rawEmail => {
          const e = normalizeEmail(rawEmail);
          if (e && e !== normalizeEmail(currentUserEmail) && !normalizedCurrentMembers.includes(e)) {
            emails.set(e, (emails.get(e) || 0) + 1);
          }
        });
      });
      return Array.from(emails.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([email, count]) => ({ email, count }));
    },
    enabled: !!tripId && open && !!currentUserEmail,
    staleTime: 300000,
  });

  // Perfiles de los co-travelers, buscados por email ya conocido (vienen de
  // tus propios viajes creados, ver query de arriba) — NO se puede usar
  // `allProfiles` (más abajo) para esto: ese es el modo "descubrimiento
  // abierto" de searchUserProfiles y nunca incluye email a propósito (para
  // no exponerlo a quien no lo conocía ya), así que matchear por p.email
  // contra esa lista siempre fallaría.
  const coTravelerEmailList = coTravelerEmails.map(c => c.email);
  const { data: coTravelerProfilesRaw = [] } = useQuery({
    queryKey: ['coTravelerProfiles', coTravelerEmailList.join(',')],
    queryFn: () => searchUserProfiles({ emails: coTravelerEmailList }),
    enabled: coTravelerEmailList.length > 0,
    staleTime: 300000,
  });

  // Focus input on open -- José (14 sep 2026): antes esto enfocaba el
  // campo de búsqueda a los 100ms de abrir, lo que disparaba el teclado
  // automáticamente sin que el usuario pidiera escribir nada -- "no me
  // mola, mejor que no salga el teclado". Ahora solo se limpia el estado,
  // sin robar el foco -- el usuario decide cuándo escribir.
  useEffect(() => {
    if (open) {
      setQuery(''); setMode('search'); setEmailInput('');
      setSearchResults([]); setDone(false); setError(''); setSentTo('');
      setShareLinkData(null);
      // José (15 sep 2026): "debería salir instantáneamente al cargar
      // invitar, sin tener que pinchar compartir enlace, es un paso
      // innecesario" -- se genera/reutiliza el link nada más abrir, en vez
      // de esperar a que se toque el botón. createTripInviteLink reutiliza
      // el activo si ya existe, así que esto es barato incluso si al final
      // no se llega a compartir nada.
      handleOpenShareOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Precargar todos los perfiles al abrir el modal — búsqueda client-side inmediata.
  // UserProfile.read se cerró en el rls (exponía email/nationality de todo
  // el mundo) — se lee vía función backend, modo "descubrimiento abierto" (sin
  // filtros = todos los perfiles con solo campos públicos, nunca email). El
  // email de a quién se invita se resuelve aparte en handleInvite() vía el
  // fallback que ya existía (User.filter por profile.user_id) — ver abajo.
  const { data: allProfiles = NO_PROFILES } = useQuery({
    queryKey: ['allUserProfiles'],
    queryFn: () => searchUserProfiles({}),
    enabled: open,
    staleTime: 120000, // 2 min cache
  });

  // Live search con debounce — filtra client-side sobre allProfiles
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults(r => (r.length ? NO_PROFILES : r)); setSearching(false); return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      try {
        const q = query.trim().toLowerCase().replace(/^@/, '');
        const pool = allProfiles.length > 0 ? allProfiles : profiles;
        const results = pool.filter(p => {
          const un = (p.username || '').toLowerCase();
          const un_norm = (p.username_normalized || '').toLowerCase();
          const dn = (p.display_name || '').toLowerCase();
          return un.startsWith(q) || un_norm.startsWith(q) || dn.startsWith(q) ||
                 un.includes(q) || dn.includes(q);
        });
        // Ordenar: primero startsWith username, luego el resto
        results.sort((a, b) => {
          const aStarts = (a.username || '').toLowerCase().startsWith(q);
          const bStarts = (b.username || '').toLowerCase().startsWith(q);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return 0;
        });
        setSearchResults(results.slice(0, 10));
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 150); // más rápido porque es client-side
  }, [query, allProfiles, profiles]);

  // members puede traer entradas antiguas sin normalizar (viajes creados
  // antes de este fix) — se normalizan ambos lados de cada comparación, no
  // solo el email entrante, para que también funcione con esos datos viejos.
  const normalizedMembers = members.map(normalizeEmail);
  const getStatus = (email) => {
    const e = normalizeEmail(email);
    if (normalizedMembers.includes(e)) return 'member';
    if (pendingInvites.some(i => normalizeEmail(i.email) === e)) return 'pending';
    return 'available';
  };

  const handleInvite = async (profile, resolvedEmail) => {
    let email = resolvedEmail;
    // Cierre de la fuga de emails: ya no se resuelve el email de un
    // desconocido vía searchUserProfiles({userIds}) — ese modo ahora solo
    // devuelve email si ya hay una relación real (mismo viaje o uno mismo).
    // Si no hay email resuelto (búsqueda por username en modo
    // descubrimiento, que nunca devuelve email), se invita por
    // targetUserId y el backend resuelve el email sin que pase por el
    // navegador de quien invita.
    let targetUserId;
    if (!email && profile?.user_id) {
      targetUserId = profile.user_id;
    }
    if (!email && !targetUserId) { setError(t('invites.modal.resolveEmailError')); return; }
    setSending(true); setError('');
    try {
      const result = await sendTripInvite({
        tripId, email: email || undefined, targetUserId, role: 'editor',
        tripName: trip?.name || t('invites.modal.theTrip'),
        inviterEmail: currentUserEmail || trip?.created_by || '',
        inviterName: currentUserName || currentUserEmail || trip?.created_by || '',
      });
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['tripPendingInvites', tripId] });
      setSentTo(profile?.display_name || profile?.username || email);
      setDone(true);
      setTimeout(() => { setDone(false); onClose(); }, 2000);
    } catch (e) {
      setError(e?.message || t('invites.modal.sendError'));
    }
    setSending(false);
  };

  // Retirar una invitación pendiente: antes, si te equivocabas de email, esa
  // invitación quedaba viva para siempre y no había forma de anularla.
  const handleCancelInvite = async (inv) => {
    setCancelling(inv.id);
    try {
      // TripInvite.update está cerrado del todo en el rls (permitir cualquier
      // update a quien coincidiera en email/invited_by dejaba reescribir
      // trip_id/role de la invitación, no solo el status) — cancelar corre
      // ahora en el backend, con asServiceRole, validando que quien cancela
      // es quien la envió.
      const result = await base44.functions.invoke('respondToTripInvite', { inviteId: inv.id, action: 'cancel' });
      const data = result?.data ?? result;
      if (data?.error) throw new Error(data.error);
      queryClient.invalidateQueries({ queryKey: ['tripPendingInvites', tripId] });
    } catch (e) {
      const serverError = e?.response?.data?.error || e?.data?.error;
      setError(serverError || e?.message || t('invites.modal.cancelError'));
    }
    setCancelling(null);
  };

  const handleEmailInvite = async () => {
    const raw = emailInput.trim();
    if (!raw || !raw.includes('@') || raw.startsWith('@')) { setError(t('invites.modal.invalidEmail')); return; }
    setSending(true); setError('');
    try {
      const result = await sendTripInvite({
        tripId, email: raw, role: 'editor',
        tripName: trip?.name || t('invites.modal.theTrip'),
        inviterEmail: currentUserEmail || trip?.created_by || '',
        inviterName: currentUserName || currentUserEmail || trip?.created_by || '',
      });
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['tripPendingInvites', tripId] });
      setSentTo(raw);
      setDone(true);
      setTimeout(() => { setDone(false); onClose(); }, 2000);
    } catch (e) {
      setError(e?.message || t('invites.modal.sendError'));
    }
    setSending(false);
  };

  // Co-traveler profiles resolved — antes solo se buscaba en `profiles`, que
  // Home.jsx solo rellena con los miembros ACTUALES del viaje. Un co-viajero
  // de otro viaje anterior nunca es miembro de este, así que `profiles.find`
  // no lo encontraba nunca: se veía el email en vez del nombre, y sin avatar
  // aunque el usuario tuviera foto de perfil. `allProfiles` (cargado más
  // arriba para la búsqueda) sí tiene a todos los usuarios de Kōdo, así que
  // se busca ahí primero.
  const coTravelerProfiles = coTravelerEmails.map(({ email, count }) => ({
    profile: coTravelerProfilesRaw.find(p => normalizeEmail(p.email) === normalizeEmail(email) || normalizeEmail(p.user_email) === normalizeEmail(email))
      || profiles.find(p => normalizeEmail(p.email) === normalizeEmail(email) || normalizeEmail(p.user_email) === normalizeEmail(email)),
    email,
    count,
  })).filter(({ email }) => getStatus(email) !== 'member').slice(0, 6);

  const [sharingLink, setSharingLink] = useState(false);
  // José (15 sep 2026): "el modelo de Instagram funciona de puta madre y
  // los usuarios ya lo conocen" -- la fila de iconos (WhatsApp/Copiar
  // enlace/Compartir con...) SÍ la podemos construir nosotros (la
  // cuadrícula de arriba de Instagram no, es su red social interna, no
  // algo que el sistema operativo nos dé gratis). WhatsApp como acceso
  // directo (la gente lo prefiere, ya lo dijiste), Copiar enlace aparte, y
  // "Compartir con..." como comodín para todo lo demás vía la hoja nativa.
  const [shareLinkData, setShareLinkData] = useState(null); // { url, text } | null
  const [linkCopiedFlash, setLinkCopiedFlash] = useState(false);

  const handleOpenShareOptions = async () => {
    setSharingLink(true); setError('');
    try {
      const link = await getOrCreateTripInviteLink(tripId);
      const url = buildTripInviteLinkUrl(link, trip);
      const text = buildTripInviteLinkShareText(trip, currentUserName || currentUserEmail, url);
      setShareLinkData({ url, text });
    } catch (e) {
      setError(e?.message || t('invites.modal.shareError'));
    }
    setSharingLink(false);
  };

  // window.open() no funciona de forma fiable en el WebView nativo de
  // Capacitor (mismo problema que ya arreglamos para abrir documentos) --
  // se usa @capacitor/browser, con window.open solo como último recurso.
  const openWhatsApp = async () => {
    const waUrl = 'https://wa.me/?text=' + encodeURIComponent(shareLinkData.text);
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: waUrl });
    } catch {
      window.open(waUrl, '_blank');
    }
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLinkData.url);
      setLinkCopiedFlash(true);
      setTimeout(() => setLinkCopiedFlash(false), 2000);
    } catch {}
  };

  // Comodín para todo lo que no sea WhatsApp/copiar -- Telegram, Mail,
  // Mensajes, etc. Aquí sí tiene sentido delegar en la hoja nativa del
  // sistema, no intentar dibujar un botón por cada app posible.
  const shareToOther = async () => {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ text: shareLinkData.text, url: shareLinkData.url, dialogTitle: t('invites.modal.shareDialogTitle') });
    } catch {
      if (navigator.share) {
        try { await navigator.share({ text: shareLinkData.text, url: shareLinkData.url }); } catch {}
      }
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-background rounded-t-3xl shadow-2xl flex flex-col"
        // 88vh se calcula sobre el viewport completo de la pantalla, no sobre
        // el visible cuando el teclado está abierto — el input y sobre todo
        // los resultados de búsqueda (debajo) quedaban tapados por el
        // teclado hasta cerrarlo. dvh sí se ajusta al viewport visual real.
        style={{ maxHeight: '88dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0">
          <p className="text-base font-semibold text-foreground">{t('invites.modal.title')}</p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
            aria-label={t('common.close')}>
            <X className="w-4 h-4 text-foreground" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center py-10 gap-3 px-5">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="w-7 h-7 text-green-600" />
            </div>
            <p className="text-base font-semibold text-foreground">{t('invites.modal.sent')}</p>
            <p className="text-sm text-muted-foreground text-center">
              {t('invites.modal.sentHint', { name: sentTo })}
            </p>
          </div>
        ) : mode === 'email' ? (
          <div className="px-5 pb-8 flex flex-col gap-4 flex-shrink-0">
            <button onClick={() => { setMode('search'); setError(''); }}
              className="text-sm text-primary font-medium text-left">
              {t('invites.modal.backToSearch')}
            </button>
            <div className={`bg-card border rounded-2xl px-4 py-3 flex items-center gap-2 ${error ? 'border-red-300' : 'border-border'}`}>
              <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <input value={emailInput} onChange={e => { setEmailInput(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleEmailInvite()}
                placeholder="email@ejemplo.com" type="email" autoFocus
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />
            </div>
            {error && <p className="text-xs text-red-600 px-1">{error}</p>}
            <button onClick={handleEmailInvite} disabled={!emailInput.trim() || sending}
              className="w-full h-11 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-40">
              {sending ? t('invites.modal.sending') : t('invites.modal.sendInvite')}
            </button>
          </div>
        ) : (
          <>
            {/* Search input */}
            <div className="px-5 flex-shrink-0">
              <div className="bg-secondary border border-border rounded-2xl px-4 py-2.5 flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onFocus={e => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                  placeholder={t('invites.modal.searchPlaceholder')}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                {query ? (
                  <button onClick={() => { setQuery(''); setSearchResults([]); }} className="p-0.5">
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 px-5 pb-6 mt-4 space-y-4">

              {/* Search results */}
              {query.trim().length >= 2 && (
                <div>
                  {searching ? (
                    <div className="space-y-2">
                      {[1, 2].map(i => (
                        <div key={i} className="flex items-center gap-3 px-1 py-2 animate-pulse">
                          <div className="w-9 h-9 rounded-full bg-secondary flex-shrink-0" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3 bg-secondary rounded w-24" />
                            <div className="h-2.5 bg-secondary rounded w-16" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : searchResults.length > 0 ? (
                    <div className="bg-card rounded-2xl border border-border overflow-hidden">
                      {searchResults.map((profile, i) => {
                        const email = profile.email || profile.user_email || '';
                        const status = getStatus(email);
                        const coCount = coTravelerEmails.find(c => c.email === email)?.count || 0;
                        return (
                          <ResultRow key={profile.user_id || email}
                            profile={profile} email={email}
                            triplesCount={coCount} status={status}
                            onInvite={(p, e) => setConfirmingInvite({ profile: p, email: e })}
                            sending={sending}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-sm text-muted-foreground">{t('invites.modal.noUser')}</p>
                      <p className="text-xs text-muted-foreground mt-1 opacity-70">{t('invites.modal.notYetInKodo')}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Recommendations — only when not searching */}
              {query.trim().length < 2 && coTravelerProfiles.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">{t('invites.modal.traveledWith')}</p>
                  <div className="grid grid-cols-4 gap-3">
                    {coTravelerProfiles.map(({ profile, email, count }) => (
                      <GridAvatarItem key={email}
                        profile={profile} email={email}
                        triplesCount={count} status={getStatus(email)}
                        onInvite={(p, e) => setConfirmingInvite({ profile: p, email: e })}
                        sending={sending}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Pending invites -- solo pendientes, no miembros actuales
                  (José 15 sep 2026: "en el viaje no es necesario, ya se ve
                  en con quién ya has viajado" -- cierto para miembros, pero
                  aquí también vivía la única forma de cancelar una
                  invitación pendiente, así que esa parte se queda). */}
              {query.trim().length < 2 && pendingInvites.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('common.pending')}</p>
                  <div className="bg-card rounded-2xl border border-border overflow-hidden">
                    {pendingInvites.map((inv, i) => (
                      <div key={inv.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
                        <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground break-all">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">{t('invites.modal.invitedPending')}</p>
                        </div>
                        <button
                          onClick={() => handleCancelInvite(inv)}
                          disabled={cancelling === inv.id}
                          className="text-xs text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0 disabled:opacity-50">
                          {cancelling === inv.id ? '…' : t('invites.modal.cancelInvite')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <p className="text-xs text-red-600 text-center">{error}</p>
              )}

              {/* Compartir enlace -- link general, solo se ve cuando hay
                  algo que buscar/escribir todavía (query vacía), para no
                  competir visualmente con resultados de búsqueda activos.
                  Al tocarlo, se genera/reutiliza el link y esta misma fila
                  se convierte en los 3 botones de abajo (WhatsApp directo /
                  copiar / compartir con...), en vez de abrir directamente
                  la hoja nativa. */}
              {query.trim().length < 2 && (
                shareLinkData ? (
                  <div className="bg-card border border-border rounded-2xl p-3">
                    <p className="text-xs text-muted-foreground mb-2.5 px-1">{t('invites.modal.shareWithGroup')}</p>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={openWhatsApp} className="flex flex-col items-center gap-1.5 py-2">
                        <div className="w-12 h-12 rounded-full bg-[#25D366] flex items-center justify-center">
                          <MessageCircle className="w-5 h-5 text-white" fill="white" strokeWidth={0} />
                        </div>
                        <span className="text-[10px] text-foreground font-medium">WhatsApp</span>
                      </button>
                      <button onClick={copyShareLink} className="flex flex-col items-center gap-1.5 py-2">
                        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                          {linkCopiedFlash ? <Check className="w-5 h-5 text-green-600" /> : <Link2 className="w-5 h-5 text-foreground" />}
                        </div>
                        <span className="text-[10px] text-foreground font-medium">{linkCopiedFlash ? t('invites.modal.linkCopiedShort') : t('invites.modal.copyLink')}</span>
                      </button>
                      <button onClick={shareToOther} className="flex flex-col items-center gap-1.5 py-2">
                        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                          <Share2 className="w-5 h-5 text-foreground" />
                        </div>
                        <span className="text-[10px] text-foreground font-medium">{t('invites.modal.shareToOther')}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={handleOpenShareOptions} disabled={sharingLink}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-2xl hover:bg-secondary/30 transition-colors disabled:opacity-50">
                    <Share2 className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium text-foreground">{t('invites.modal.shareWithGroup')}</p>
                      <p className="text-xs text-muted-foreground">{t('invites.modal.shareWithGroupHint')}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{sharingLink ? '…' : '→'}</span>
                  </button>
                )
              )}

              {/* Email fallback */}
              <button onClick={() => { setMode('email'); setError(''); }}
                className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-dashed border-border rounded-2xl hover:bg-secondary/30 transition-colors">
                <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-foreground">{t('invites.modal.byEmail')}</p>
                  <p className="text-xs text-muted-foreground">{t('invites.modal.byEmailHint')}</p>
                </div>
                <span className="text-xs text-muted-foreground">→</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* José (14 sep 2026): confirmación explícita antes de mandar nada --
          ver el comentario en confirmingInvite arriba. */}
      {confirmingInvite && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          onClick={e => { e.stopPropagation(); setConfirmingInvite(null); }}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-card rounded-2xl p-5 w-full max-w-xs" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center gap-2 mb-5">
              <Avatar email={confirmingInvite.email} profile={confirmingInvite.profile} size={48} />
              <p className="text-sm text-foreground text-center">
                {t('invites.modal.confirmInvite', {
                  name: confirmingInvite.profile?.display_name || confirmingInvite.profile?.username || t('common.member'),
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingInvite(null)}
                className="flex-1 h-10 rounded-full border border-border text-sm font-medium text-muted-foreground bg-background">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => { const { profile, email } = confirmingInvite; setConfirmingInvite(null); handleInvite(profile, email); }}
                disabled={sending}
                className="flex-1 h-10 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-50">
                {t('invites.modal.confirmSend')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}