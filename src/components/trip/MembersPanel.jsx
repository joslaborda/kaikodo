import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, UserPlus, Crown, Pencil, Eye, Mail, Copy, Check, Trash2, Clock, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { base44 } from '@/api/base44Client';
import { sendTripInvite } from '@/lib/invites';
import { getOrCreateTripInviteLink, buildTripInviteLinkUrl, buildTripInviteLinkShareText } from '@/lib/inviteLinks';
import { removeTripMember, setTripMemberRole } from '@/lib/tripMembers';
import { useTranslation } from 'react-i18next';
import { normalizeEmail } from '@/lib/utils';
import { searchUserProfiles } from '@/lib/userProfiles';
import Avatar from '@/components/trip/Avatar';
import { GridAvatarItem } from '@/components/home/InviteModal';

export default function MembersPanel({
  trip, currentUserEmail, isAdmin, profiles = []
}) {
  const { t } = useTranslation();

  const roleConfig = {
    admin: { label: t('membersPanel.roleAdmin'), icon: Crown, color: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50' },
    editor: { label: t('membersPanel.roleEditor'), icon: Pencil, color: 'bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50' },
    viewer: { label: t('membersPanel.roleViewer'), icon: Eye, color: 'bg-secondary text-foreground border-border' },
  };
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviting, setInviting] = useState(false);
  // José (14 sep 2026): mismo arreglo que en InviteModal.jsx (Home) --
  // tocar un resultado de búsqueda mandaba la invitación al instante, sin
  // confirmar. Ahora solo abre esta confirmación.
  const [confirmingResultProfile, setConfirmingResultProfile] = useState(null);
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [sharingLink, setSharingLink] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const queryClient = useQueryClient();

  // Búsqueda en vivo por username mientras se escribe — antes esta pantalla
  // ("Ajustes de viaje") solo intentaba una búsqueda EXACTA de username al
  // pulsar "Invitar", sin ningún resultado visible mientras tanto, así que
  // parecía que solo funcionaba por email (que es literalmente lo que decía
  // la etiqueta: "Invitar por email"). La modal de invitar desde Home
  // (InviteModal.jsx) sí tenía esto — un usuario que SÍ aparecía ahí no
  // aparecía aquí. Mismo patrón que esa modal: perfiles cacheados 2 min
  // (modo "descubrimiento abierto", nunca trae email) + filtrado client-side
  // mientras se teclea, sin esperar a pulsar nada.
  const { data: allProfiles = [] } = useQuery({
    queryKey: ['allUserProfiles'],
    queryFn: () => searchUserProfiles({}),
    staleTime: 120000,
  });
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  useEffect(() => {
    clearTimeout(searchTimerRef.current);
    const raw = inviteEmail.trim();
    // Si parece un email, no tiene sentido buscar por username a la vez —
    // se invita directo por email al pulsar el botón, como ya hacía.
    if (!raw || raw.includes('@') || raw.length < 2) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimerRef.current = setTimeout(() => {
      try {
        const q = raw.toLowerCase().replace(/^@/, '');
        const results = allProfiles.filter(p => {
          const un = (p.username || '').toLowerCase();
          const un_norm = (p.username_normalized || '').toLowerCase();
          const dn = (p.display_name || '').toLowerCase();
          return un.startsWith(q) || un_norm.startsWith(q) || dn.startsWith(q) || un.includes(q) || dn.includes(q);
        });
        results.sort((a, b) => {
          const aStarts = (a.username || '').toLowerCase().startsWith(q);
          const bStarts = (b.username || '').toLowerCase().startsWith(q);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return 0;
        });
        // No mostrar gente que ya es miembro del viaje.
        const membersNorm = members.map(normalizeEmail);
        const filtered = results.filter(p => !p.email || !membersNorm.includes(normalizeEmail(p.email)));
        setSearchResults(filtered.slice(0, 6));
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 150);
    return () => clearTimeout(searchTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteEmail, allProfiles]);

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['tripPendingInvites', trip.id],
    queryFn: () => base44.entities.TripInvite.filter({ trip_id: trip.id, status: 'pending' }),
    enabled: !!trip?.id,
  });

  const members = trip?.members || [];
  const roles = trip?.roles || {};

  // José (15 sep 2026): "que no esté [en Ajustes] no significa que no lo
  // queramos" -- tenía razón, se me pasó preguntarlo. Misma sección que ya
  // hay en InviteModal.jsx (Home), mismo componente (GridAvatarItem,
  // exportado desde allí en vez de duplicado aquí).
  const normalizedMembersForStatus = members.map(normalizeEmail);
  const getStatus = (email) => {
    const e = normalizeEmail(email);
    if (normalizedMembersForStatus.includes(e)) return 'member';
    if (pendingInvites.some(i => normalizeEmail(i.email) === e)) return 'pending';
    return 'available';
  };

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
    enabled: !!trip?.id && !!currentUserEmail,
    staleTime: 300000,
  });
  const coTravelerEmailList = coTravelerEmails.map(c => c.email);
  const { data: coTravelerProfilesRaw = [] } = useQuery({
    queryKey: ['coTravelerProfiles', coTravelerEmailList.join(',')],
    queryFn: () => searchUserProfiles({ emails: coTravelerEmailList }),
    enabled: coTravelerEmailList.length > 0,
    staleTime: 300000,
  });
  const coTravelerProfiles = coTravelerEmails.map(({ email, count }) => ({
    profile: coTravelerProfilesRaw.find(p => normalizeEmail(p.email) === normalizeEmail(email) || normalizeEmail(p.user_email) === normalizeEmail(email)),
    email, count,
  })).filter(({ email }) => getStatus(email) !== 'member').slice(0, 6);

  // `profiles` llega como array (así lo devuelve el useQuery de perfiles en
  // Home.jsx: `data: profiles = []`), pero este componente asumía que podía
  // llegar como objeto {email: profile} — con un array, `profiles?.[email]`
  // siempre daba undefined y la lista de miembros se quedaba sin avatar/nombre.
  // Se admite cualquiera de las dos formas.
  const getProfile = (email) => {
    if (!profiles) return null;
    if (Array.isArray(profiles)) return profiles.find(p => p.email === email || p.user_email === email) || null;
    return profiles[email] || null;
  };

  // Cambiar rol y expulsar corren en el backend (base44/functions/
  // manageTripMember), no aquí. Motivo: el rls de Trip.update no puede
  // exigir "solo si eres admin" para tocar members/roles sin también
  // bloquear a cualquier miembro normal que solo quiere renombrar el viaje o
  // salir de él — con Trip.update() directo desde el cliente, cualquier
  // miembro (viewer incluido) podía llamarlo a mano y auto-promocionarse a
  // admin o expulsar a otros. La función valida server-side que quien llama
  // sea admin antes de tocar la membresía de otra persona.
  const updateTripMutation = useMutation({
    mutationFn: ({ email, role }) => setTripMemberRole(trip.id, email, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trip', trip.id] }),
    // También se invalida en error: si el backend YA aplicó el cambio pero
    // responde con error (p. ej. el caso de "ya se había hecho" que
    // manageTripMember ahora resuelve, o cualquier 5xx transitorio tras un
    // Trip.update que sí se guardó), sin esto la UI se quedaba con datos
    // obsoletos y el admin no tenía forma de saber que en realidad sí
    // funcionó.
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      toast({ title: t('common.error'), description: e?.message || t('membersPanel.roleChangeError'), variant: 'destructive' });
    },
  });

  // Expulsar miembro: MembersPanel existía en el proyecto pero no estaba
  // conectado a ninguna pantalla, y aunque se conectara solo permitía cambiar
  // el rol — no había forma de sacar a alguien del viaje sin tocar la BD a
  // mano. Igual que con el rol, no se puede expulsar al creador del viaje ni
  // a uno mismo (la función backend lo revalida igualmente).
  const removeMemberMutation = useMutation({
    mutationFn: (email) => removeTripMember(trip.id, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      setMemberToRemove(null);
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      toast({ title: t('common.error'), description: e?.message || t('membersPanel.removeError'), variant: 'destructive' });
    },
  });

  // Núcleo común de "enviar la invitación", usado tanto al escribir un email
  // directo / hacer fallback por username exacto (handleInvite) como al
  // tocar un resultado de la búsqueda en vivo (handleInviteFromResult).
  // José (14 sep 2026): mismo botón y mismo comportamiento que en
  // InviteModal.jsx (Home) -- un solo componente de invitar reusado desde
  // los dos sitios habría sido lo ideal, pero se optó por duplicar esta
  // pieza concreta en vez de emprender la consolidación completa de los dos
  // paneles a la vez que una función de seguridad nueva. Si se toca el
  // comportamiento de compartir en un sitio, hay que tocarlo en el otro.
  const [shareLinkData, setShareLinkData] = useState(null); // { url, text } | null
  const [linkCopiedFlash, setLinkCopiedFlash] = useState(false);

  const inviterName = () => {
    const myProf = profiles.find(p => normalizeEmail(p.email) === normalizeEmail(currentUserEmail) || normalizeEmail(p.user_email) === normalizeEmail(currentUserEmail));
    return myProf?.display_name || myProf?.username || currentUserEmail;
  };

  const handleOpenShareOptions = async () => {
    setSharingLink(true);
    try {
      const link = await getOrCreateTripInviteLink(trip.id);
      const url = buildTripInviteLinkUrl(link, trip);
      const text = buildTripInviteLinkShareText(trip, inviterName(), url);
      setShareLinkData({ url, text });
    } catch (e) {
      toast({ title: t('common.error'), description: e.message || t('invites.modal.shareError'), variant: 'destructive' });
    }
    setSharingLink(false);
  };

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

  const sendInviteTo = async ({ resolvedEmail, targetUserId }) => {
    if (!targetUserId) {
      resolvedEmail = normalizeEmail(resolvedEmail);
      if (members.some(m => normalizeEmail(m) === resolvedEmail)) {
        toast({ title: t('membersPanel.alreadyMember'), description: t('membersPanel.alreadyMemberDesc') });
        return;
      }
    }
    const result = await sendTripInvite({
      tripId: trip.id,
      email: targetUserId ? undefined : resolvedEmail,
      targetUserId,
      role: inviteRole,
      tripName: trip.name,
      inviterEmail: currentUserEmail,
      inviterName: (() => {
        const myProf = profiles.find(p => normalizeEmail(p.email) === normalizeEmail(currentUserEmail) || normalizeEmail(p.user_email) === normalizeEmail(currentUserEmail));
        return myProf?.display_name || myProf?.username || currentUserEmail;
      })(),
    });
    if (!result?.emailSent && result?.inviteUrl) {
      setShareLink(result.inviteUrl);
      setInviteEmail('');
    } else {
      toast({ title: t('membersPanel.inviteSent'), description: t('membersPanel.inviteSentDesc', { email: resolvedEmail }) });
      setInviteEmail('');
      setInviteRole('editor');
    }
    setSearchResults([]);
    queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
  };

  // Tocar un resultado de la búsqueda en vivo — antes esta pantalla no tenía
  // ningún resultado visible mientras se escribía, así que esto no existía;
  // ahora es el camino principal para invitar por username (mismo patrón
  // que InviteModal.jsx en Home).
  const handleInviteFromResult = async (profile) => {
    setInviting(true);
    try {
      if (profile.email) {
        await sendInviteTo({ resolvedEmail: profile.email });
      } else {
        await sendInviteTo({ targetUserId: profile.user_id });
      }
    } catch (e) {
      toast({ title: t('common.error'), description: e.message || t('membersPanel.inviteError') });
    } finally {
      setInviting(false);
    }
  };

  const handleInvite = async () => {
    const raw = inviteEmail.trim();
    if (!raw) return;
    setInviting(true);
    try {
      let resolvedEmail = raw;
      let targetUserId;
      // Si no parece un email, se envía directo: si hay resultados de la
      // búsqueda en vivo visibles, se usa el primero (equivalente a tocarlo);
      // si no, se prueba una búsqueda exacta como red de seguridad (p. ej.
      // si el usuario pulsó Enter más rápido de lo que tardó el debounce).
      if (!raw.includes('@')) {
        let profile = searchResults[0];
        if (!profile) {
          const query = raw.startsWith('@') ? raw.slice(1) : raw;
          const found = await searchUserProfiles({ usernameQuery: query, exact: true });
          if (!found.length) {
            toast({ title: t('membersPanel.userNotFound'), description: t('membersPanel.userNotFoundDesc', { query }) });
            setInviting(false);
            return;
          }
          profile = found[0];
        }
        // Cierre de la fuga de emails: ya no se resuelve el email de un
        // desconocido vía searchUserProfiles({userIds}) — ese modo ahora
        // solo devuelve email si ya hay una relación real (mismo viaje o
        // uno mismo). Si el perfil no trae email, se invita por
        // targetUserId y el backend resuelve el email sin que pase por el
        // navegador de quien invita.
        if (profile.email) {
          resolvedEmail = profile.email;
        } else {
          targetUserId = profile.user_id;
        }
      }
      await sendInviteTo({ resolvedEmail, targetUserId });
    } catch (e) {
      toast({ title: t('common.error'), description: e.message || t('membersPanel.inviteError') });
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvite = async (inv) => {
    setCancelling(inv.id);
    try {
      const result = await base44.functions.invoke('respondToTripInvite', { inviteId: inv.id, action: 'cancel' });
      const data = result?.data ?? result;
      if (data?.error) throw new Error(data.error);
      queryClient.invalidateQueries({ queryKey: ['tripPendingInvites', trip.id] });
    } catch (e) {
      const serverError = e?.response?.data?.error || e?.data?.error;
      toast({ title: t('common.error'), description: serverError || e?.message || t('invites.modal.cancelError') });
    }
    setCancelling(null);
  };

  const handleRoleChange = (email, newRole) => {
    const adminCount = Object.values(roles).filter(r => r === 'admin').length;
    if (roles[email] === 'admin' && adminCount <= 1 && newRole !== 'admin') {
      toast({ title: t('membersPanel.notAllowed'), description: t('membersPanel.needOneAdmin'), variant: 'destructive' });
      return;
    }
    updateTripMutation.mutate({ email, role: newRole });
  };

  return (
    <div className="space-y-4">
      {/* Header — single Invitar button here, no duplicate circle below */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="font-medium text-foreground text-sm">{t('membersPanel.travelersCount', { count: members.length })}</h3>
        </div>
        {isAdmin && (
          <button
            onClick={() => document.getElementById('invite-input')?.focus()}
            className="flex items-center gap-1.5 text-xs text-primary font-medium hover:text-primary/80 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />{t('membersPanel.invite')}
          </button>
        )}
      </div>

      {/* Member list */}
      <div className="space-y-2">
        {members.map(email => {
          const role = roles[email] || 'viewer';
          const config = roleConfig[role];
          const RoleIcon = config.icon;
          const isCurrentUser = normalizeEmail(email) === normalizeEmail(currentUserEmail);
          const isCreator = normalizeEmail(trip?.created_by) === normalizeEmail(email);
          const prof = getProfile(email);
          const displayName = prof?.display_name || prof?.username || email || email;
          const initials = displayName.slice(0,2).toUpperCase();

          return (
            <div key={email} className="flex items-center justify-between p-3 bg-card rounded-xl border border-border">
              <div className="flex items-center gap-3">
                {prof?.avatar_url
                  ? <img src={prof.avatar_url} alt={displayName} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                  : <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-sm font-medium text-primary">{initials}</div>
                }
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {displayName}
                    {isCurrentUser && <span className="text-xs text-muted-foreground ml-1">{t('membersPanel.you')}</span>}
                  </p>
                  <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs mt-0.5 ${config.color}`}>
                    <RoleIcon className="w-3 h-3" />
                    {config.label}
                  </div>
                </div>
              </div>
              {isAdmin && !isCurrentUser && (
                <div className="flex items-center gap-1.5">
                  <Select value={role} onValueChange={v => handleRoleChange(email, v)}>
                    <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{t('membersPanel.roleAdmin')}</SelectItem>
                      <SelectItem value="editor">{t('membersPanel.roleEditor')}</SelectItem>
                      <SelectItem value="viewer">{t('membersPanel.roleViewer')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {!isCreator && (
                    <button
                      onClick={() => setMemberToRemove(email)}
                      aria-label={t('membersPanel.removeFromTrip')}
                      className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Invitaciones pendientes — solo admin puede verlas y retirarlas */}
      {isAdmin && pendingInvites.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('membersPanel.pendingInvites')}</p>
          {pendingInvites.map(inv => {
            // Mismo umbral que acceptTripInvite/entry.ts (14 días) — aquí
            // solo es indicativo, la aplicación real vive en el backend.
            const isExpired = inv?.created_date
              ? (Date.now() - new Date(inv.created_date).getTime()) > 14 * 24 * 60 * 60 * 1000
              : false;
            return (
            <div key={inv.id} className="flex items-center justify-between p-3 bg-card rounded-xl border border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{inv.email}</p>
                  <span className={`text-xs ${isExpired ? 'text-red-500' : 'text-muted-foreground'}`}>
                    {isExpired ? t('membersPanel.inviteExpired') : t('common.pending')}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleCancelInvite(inv)}
                disabled={cancelling === inv.id}
                className="text-xs text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0 disabled:opacity-50"
              >
                {cancelling === inv.id ? '…' : t('common.cancel')}
              </button>
            </div>
            );
          })}
        </div>
      )}

      {/* Confirmación de expulsión */}
      {memberToRemove && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" onClick={() => setMemberToRemove(null)}>
          <div className="bg-card w-full max-w-md rounded-t-2xl p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />
            <p className="font-semibold text-foreground text-sm mb-1">{t('membersPanel.removeFromTrip')}</p>
            <p className="text-xs text-muted-foreground mb-5">
              {(() => {
                const prof = getProfile(memberToRemove);
                const name = prof?.display_name || prof?.username || memberToRemove;
                return t('membersPanel.removeConfirmBody', { name });
              })()}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setMemberToRemove(null)} className="flex-1 py-3 rounded-full border border-border text-sm text-muted-foreground">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => removeMemberMutation.mutate(memberToRemove)}
                disabled={removeMemberMutation.isPending}
                className="flex-1 py-3 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-50"
              >
                {removeMemberMutation.isPending ? '...' : t('membersPanel.remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite form */}
      {isAdmin && (
        <div className="pt-4 border-t border-border">
          {shareLink ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Mail className="w-3 h-3" />{t('membersPanel.shareLinkHint')}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t('membersPanel.shareLinkNote')}
              </p>
              <div className="bg-secondary rounded-xl px-3 py-2.5">
                <p className="text-xs font-mono break-all text-foreground leading-relaxed">{shareLink}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => { navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="flex-1 bg-primary hover:bg-primary/90 text-white"
                  size="sm"
                >
                  {copied ? <><Check className="w-3.5 h-3.5 mr-1" />{t('membersPanel.copied')}</> : <><Copy className="w-3.5 h-3.5 mr-1" />{t('membersPanel.copyLink')}</>}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShareLink('')}>{t('membersPanel.back')}</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                <Mail className="w-3 h-3" />{t('membersPanel.inviteByUsernameOrEmail')}
              </p>
              {shareLinkData ? (
                <div className="bg-secondary rounded-xl p-3 mb-3">
                  <p className="text-xs text-muted-foreground mb-2.5 px-1">{t('invites.modal.shareWithGroup')}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={openWhatsApp} className="flex flex-col items-center gap-1.5 py-2">
                      <div className="w-12 h-12 rounded-full bg-[#25D366] flex items-center justify-center">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M17.6 6.3A8.86 8.86 0 0 0 12 4a8.9 8.9 0 0 0-8.9 8.9c0 1.57.41 3.1 1.19 4.44L3 21l3.76-1.27a8.9 8.9 0 0 0 5.24 1.68 8.9 8.9 0 0 0 8.9-8.9c0-2.38-.93-4.6-2.3-6.21zM12 19.1a7.3 7.3 0 0 1-4.44-1.5l-.32-.2-2.47.82.83-2.4-.21-.34a7.32 7.32 0 1 1 13.61-3.8A7.31 7.31 0 0 1 12 19.1zm4.02-5.47c-.22-.11-1.3-.64-1.5-.72-.2-.07-.35-.11-.5.11-.15.22-.57.72-.7.87-.13.15-.26.16-.48.05-.22-.11-.94-.35-1.79-1.11-.66-.59-1.11-1.32-1.24-1.54-.13-.22-.01-.34.1-.45.1-.1.22-.26.33-.39.11-.13.15-.22.22-.37.07-.15.04-.28-.02-.39-.06-.11-.5-1.21-.69-1.66-.18-.43-.36-.37-.5-.38-.13-.01-.28-.01-.43-.01s-.39.06-.6.28c-.2.22-.79.77-.79 1.87s.81 2.17.92 2.32c.11.15 1.6 2.45 3.89 3.43.54.24.97.38 1.3.48.55.17 1.05.15 1.44.09.44-.07 1.3-.53 1.48-1.04.18-.51.18-.95.13-1.04-.05-.09-.2-.15-.42-.26z"/></svg>
                      </div>
                      <span className="text-[10px] text-foreground font-medium">WhatsApp</span>
                    </button>
                    <button type="button" onClick={copyShareLink} className="flex flex-col items-center gap-1.5 py-2">
                      <div className="w-12 h-12 rounded-full bg-card flex items-center justify-center">
                        {linkCopiedFlash ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5 text-foreground" />}
                      </div>
                      <span className="text-[10px] text-foreground font-medium">{linkCopiedFlash ? t('invites.modal.linkCopiedShort') : t('invites.modal.copyLink')}</span>
                    </button>
                    <button type="button" onClick={shareToOther} className="flex flex-col items-center gap-1.5 py-2">
                      <div className="w-12 h-12 rounded-full bg-card flex items-center justify-center">
                        <Share2 className="w-5 h-5 text-foreground" />
                      </div>
                      <span className="text-[10px] text-foreground font-medium">{t('invites.modal.shareToOther')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={handleOpenShareOptions} disabled={sharingLink}
                  className="w-full flex items-center gap-2 px-3 py-2.5 mb-3 bg-secondary rounded-xl text-left hover:bg-secondary/70 transition-colors disabled:opacity-50">
                  <Share2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span className="text-xs font-medium text-foreground flex-1">{t('invites.modal.shareWithGroup')}</span>
                  <span className="text-xs text-muted-foreground">{sharingLink ? '…' : '→'}</span>
                </button>
              )}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      id="invite-input"
                      placeholder={t('membersPanel.usernameOrEmailPlaceholder')}
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleInvite()}
                      className="text-sm w-full"
                      autoComplete="off"
                    />
                    {/* Resultados en vivo mientras se escribe un username —
                        antes no había ningún feedback aquí hasta pulsar
                        "Invitar" (y encima con match exacto), así que
                        alguien que SÍ estaba en Kaikōdo parecía no existir.
                        Mismo patrón que la modal de invitar desde Home. */}
                    {searchResults.length > 0 && (
                      <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                        {searchResults.map(p => (
                          <button key={p.user_id || p.username} type="button"
                            onClick={() => setConfirmingResultProfile(p)}
                            disabled={inviting}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/30 transition-colors border-b border-border last:border-0 disabled:opacity-50">
                            <Avatar email={p.email} profile={p} size={28} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{p.display_name || p.username}</p>
                              {p.username && <p className="text-xs text-muted-foreground">@{p.username}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {searching && inviteEmail.trim().length >= 2 && !inviteEmail.includes('@') && searchResults.length === 0 && (
                      <p className="absolute left-1 top-full mt-1 text-xs text-muted-foreground">{t('membersPanel.searching')}</p>
                    )}
                  </div>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger className="w-24 h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{t('membersPanel.roleAdmin')}</SelectItem>
                      <SelectItem value="editor">{t('membersPanel.roleEditor')}</SelectItem>
                      <SelectItem value="viewer">{t('membersPanel.roleViewer')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleInvite}
                  disabled={!inviteEmail.trim() || inviting}
                  className="w-full bg-primary hover:bg-primary/90 text-white"
                  size="sm"
                >
                  {inviting ? '...' : t('invites.modal.sendInvite')}
                </Button>
              </div>

              {/* José (15 sep 2026): misma sección que ya había en Home,
                  se me había olvidado traerla también a Ajustes. */}
              {inviteEmail.trim().length < 2 && coTravelerProfiles.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">{t('invites.modal.traveledWith')}</p>
                  <div className="grid grid-cols-4 gap-3">
                    {coTravelerProfiles.map(({ profile, email, count }) => (
                      <GridAvatarItem key={email}
                        profile={profile} email={email}
                        triplesCount={count} status={getStatus(email)}
                        onInvite={(p, e) => setConfirmingResultProfile(p)}
                        sending={inviting}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {confirmingResultProfile && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          onClick={() => setConfirmingResultProfile(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-card rounded-2xl p-5 w-full max-w-xs" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center gap-2 mb-5">
              <Avatar email={confirmingResultProfile.email} profile={confirmingResultProfile} size={48} />
              <p className="text-sm text-foreground text-center">
                {t('invites.modal.confirmInvite', {
                  name: confirmingResultProfile.display_name || confirmingResultProfile.username || t('common.member'),
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingResultProfile(null)}
                className="flex-1 h-10 rounded-full border border-border text-sm font-medium text-muted-foreground bg-background">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => { const p = confirmingResultProfile; setConfirmingResultProfile(null); handleInviteFromResult(p); }}
                disabled={inviting}
                className="flex-1 h-10 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-50">
                {t('invites.modal.confirmSend')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}