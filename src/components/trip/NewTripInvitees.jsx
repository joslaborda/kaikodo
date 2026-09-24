import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Mail, Clock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { base44 } from '@/api/base44Client';
import { useTranslation } from 'react-i18next';
import { normalizeEmail } from '@/lib/utils';
import { searchUserProfiles } from '@/lib/userProfiles';
import { useAuth } from '@/lib/AuthContext';
import Avatar from '@/components/trip/Avatar';
import { GridAvatarItem } from '@/components/home/InviteModal';

// José (24 sep 2026): invitar viajeros AL CREAR el viaje, con el mismo
// componente visual que Ajustes del viaje (MembersPanel): buscador en vivo
// por username/email + rol, y "Con quién ya has viajado". Como el viaje aún
// no existe, aquí no se envía nada: se prepara la lista (`value`) y
// TripsList.jsx manda las invitaciones (sendTripInvite, el mismo camino que
// Ajustes) justo después de crear el viaje. El enlace de "Compartir con el
// grupo" necesita el viaje creado, así que sigue estando en Ajustes.
//
// Cada invitado: { key, email?, targetUserId?, name, profile?, role }
// (email si se conoce; si no, targetUserId y el backend resuelve el email,
// sin que pase por el navegador -- ver el cierre de la fuga de emails en
// MembersPanel/createTripInvite).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Referencia estable: un `= []` por defecto crea un array nuevo en cada render
// y el efecto de búsqueda (que depende de él) entraría en bucle.
const NONE = [];

export default function NewTripInvitees({ value = [], onChange }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const myEmail = normalizeEmail(user?.email);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('editor');
  const [adding, setAdding] = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef(null);

  const { data: allProfiles = NONE } = useQuery({
    queryKey: ['allUserProfiles'],
    queryFn: () => searchUserProfiles({}),
    staleTime: 120000,
  });

  const queuedKeys = new Set(value.map(v => v.key));
  const keyForProfile = (p) => (p.email ? 'e:' + normalizeEmail(p.email) : 'u:' + p.user_id);
  const isMe = (p) => (p.email && normalizeEmail(p.email) === myEmail) || (user?.id && p.user_id === user.id);

  // Búsqueda en vivo por username -- mismo filtro que MembersPanel.
  useEffect(() => {
    clearTimeout(timerRef.current);
    const raw = query.trim();
    if (!raw || (raw.includes('@') && !raw.startsWith('@')) || raw.length < 2) { setResults(r => (r.length ? NONE : r)); setSearching(false); return; }
    setSearching(true);
    timerRef.current = setTimeout(() => {
      const q = raw.toLowerCase().replace(/^@/, '');
      const found = allProfiles
        .filter(p => {
          const un = (p.username || '').toLowerCase();
          const dn = (p.display_name || '').toLowerCase();
          return un.includes(q) || dn.includes(q) || (p.username_normalized || '').toLowerCase().startsWith(q);
        })
        .filter(p => !isMe(p) && !queuedKeys.has(keyForProfile(p)))
        .sort((a, b) => Number((b.username || '').toLowerCase().startsWith(q)) - Number((a.username || '').toLowerCase().startsWith(q)));
      setResults(found.slice(0, 6));
      setSearching(false);
    }, 150);
    return () => clearTimeout(timerRef.current);
  }, [query, allProfiles, value]);

  // "Con quién ya has viajado" -- misma consulta que MembersPanel.
  const { data: coTravelerEmails = [] } = useQuery({
    queryKey: ['coTravelersNewTrip', myEmail],
    queryFn: async () => {
      const trips = await base44.entities.Trip.filter({ created_by: user.email });
      const counts = new Map();
      trips.forEach(tr => (tr.members || []).forEach(raw => {
        const e = normalizeEmail(raw);
        if (e && e !== myEmail) counts.set(e, (counts.get(e) || 0) + 1);
      }));
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([email, count]) => ({ email, count }));
    },
    enabled: !!myEmail,
    staleTime: 300000,
  });
  const coEmails = coTravelerEmails.map(c => c.email);
  const { data: coProfilesRaw = [] } = useQuery({
    queryKey: ['coTravelerProfiles', coEmails.join(',')],
    queryFn: () => searchUserProfiles({ emails: coEmails }),
    enabled: coEmails.length > 0,
    staleTime: 300000,
  });
  const coTravelers = coTravelerEmails.slice(0, 8).map(({ email, count }) => ({
    email, count,
    profile: coProfilesRaw.find(p => normalizeEmail(p.email) === email || normalizeEmail(p.user_email) === email),
  }));

  const addProfile = (p) => {
    const key = keyForProfile(p);
    if (queuedKeys.has(key) || isMe(p)) return;
    onChange([...value, {
      key,
      email: p.email ? normalizeEmail(p.email) : undefined,
      targetUserId: p.email ? undefined : p.user_id,
      name: p.display_name || p.username || p.email,
      username: p.username,
      profile: p,
      role,
    }]);
    setQuery(''); setResults([]);
  };

  const addEmail = (raw) => {
    const email = normalizeEmail(raw);
    if (email === myEmail) return;
    const key = 'e:' + email;
    if (queuedKeys.has(key)) { setQuery(''); return; }
    const known = allProfiles.find(p => normalizeEmail(p.email) === email);
    onChange([...value, { key, email, name: known?.display_name || known?.username || email, username: known?.username, profile: known, role }]);
    setQuery('');
  };

  const handleAdd = async () => {
    const raw = query.trim();
    if (!raw) return;
    if (!raw.startsWith('@') && raw.includes('@')) {
      if (!EMAIL_RE.test(raw)) { toast({ title: t('newTripInvites.invalidEmail') }); return; }
      addEmail(raw);
      return;
    }
    if (results[0]) { addProfile(results[0]); return; }
    // Red de seguridad: username exacto (si se pulsó antes del debounce).
    setAdding(true);
    try {
      const q = raw.replace(/^@/, '');
      const found = await searchUserProfiles({ usernameQuery: q, exact: true });
      if (!found.length) { toast({ title: t('membersPanel.userNotFound'), description: t('membersPanel.userNotFoundDesc', { query: q }) }); return; }
      addProfile(found[0]);
    } catch {
      toast({ title: t('common.error'), description: t('common.tryAgain'), variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const setInviteeRole = (key, r) => onChange(value.map(v => (v.key === key ? { ...v, role: r } : v)));
  const removeInvitee = (key) => onChange(value.filter(v => v.key !== key));

  const statusFor = (email) => (queuedKeys.has('e:' + email) ? 'pending' : 'available');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="font-medium text-foreground text-sm">
          {t('newTripInvites.title')} <span className="text-muted-foreground font-normal">{t('newTripInvites.optional')}</span>
        </h3>
      </div>

      {/* Invitados preparados -- mismo aspecto que "Invitaciones pendientes" en Ajustes */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map(v => (
            <div key={v.key} className="flex items-center justify-between gap-2 p-3 bg-card rounded-xl border border-border">
              <div className="flex items-center gap-3 min-w-0">
                {v.profile
                  ? <Avatar email={v.email} profile={v.profile} size={32} />
                  : <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0"><Clock className="w-3.5 h-3.5 text-muted-foreground" /></div>}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{v.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{v.username ? '@' + v.username : t('newTripInvites.willInvite')}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Select value={v.role} onValueChange={r => setInviteeRole(v.key, r)}>
                  <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t('membersPanel.roleAdmin')}</SelectItem>
                    <SelectItem value="editor">{t('membersPanel.roleEditor')}</SelectItem>
                    <SelectItem value="viewer">{t('membersPanel.roleViewer')}</SelectItem>
                  </SelectContent>
                </Select>
                <button type="button" onClick={() => removeInvitee(v.key)} aria-label={t('newTripInvites.remove')}
                  className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground px-1">{t('newTripInvites.sentOnCreate')}</p>
        </div>
      )}

      <div>
        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
          <Mail className="w-3 h-3" />{t('membersPanel.inviteByUsernameOrEmail')}
        </p>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              placeholder={t('membersPanel.usernameOrEmailPlaceholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
              className="text-sm w-full"
              autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
            />
            {results.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                {results.map(p => (
                  <button key={p.user_id || p.username} type="button" onClick={() => addProfile(p)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/30 transition-colors border-b border-border last:border-0">
                    <Avatar email={p.email} profile={p} size={28} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{p.display_name || p.username}</p>
                      {p.username && <p className="text-xs text-muted-foreground">@{p.username}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searching && results.length === 0 && (
              <p className="absolute left-1 top-full mt-1 text-xs text-muted-foreground">{t('membersPanel.searching')}</p>
            )}
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-24 h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">{t('membersPanel.roleAdmin')}</SelectItem>
              <SelectItem value="editor">{t('membersPanel.roleEditor')}</SelectItem>
              <SelectItem value="viewer">{t('membersPanel.roleViewer')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" onClick={handleAdd} disabled={!query.trim() || adding}
          className="w-full mt-2 bg-primary hover:bg-primary/90 text-white" size="sm">
          {adding ? '…' : t('newTripInvites.add')}
        </Button>
      </div>

      {query.trim().length < 2 && coTravelers.length > 0 && (
        <div className="pt-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">{t('invites.modal.traveledWith')}</p>
          <div className="grid grid-cols-4 gap-3">
            {coTravelers.map(({ profile, email, count }) => (
              <GridAvatarItem key={email}
                profile={profile} email={email}
                triplesCount={count} status={statusFor(email)}
                onInvite={(p, e) => (p ? addProfile({ ...p, email: p.email || e }) : addEmail(e))}
                sending={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
