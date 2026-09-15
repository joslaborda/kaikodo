import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { UserPlus, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { normalizeEmail } from '@/lib/utils';
import { searchUserProfiles } from '@/lib/userProfiles';
import { useTranslation } from 'react-i18next';

export default function MemberAvatarRow({
  trip, profiles, onInvite, currentUserEmail, tripId
}) {
  const { t } = useTranslation();
  const colors = ['bg-orange-100 text-primary','bg-violet-100 text-violet-700','bg-blue-100 text-blue-700','bg-green-100 text-green-700'];
  // Normalizado ya en el origen: trip.members debería venir siempre en
  // minúsculas (ver TripsList.jsx / acceptTripInvite), pero se normaliza
  // aquí también por si acaso — es la clave que se usa para buscar el
  // perfil, y un desajuste de mayúsculas es justo lo que hacía que el propio
  // creador del viaje viera su email en crudo en vez de su nombre.
  const memberEmails = [...new Set((trip?.members || [trip?.created_by]).filter(Boolean).map(normalizeEmail))];

  const { data: memberProfiles = [] } = useQuery({
    queryKey: ['memberProfiles', memberEmails.join(',')],
    queryFn: async () => {
      if (!memberEmails.length) return [];
      // UserProfile.read se cerró en el rls (exponía email/nationality de
      // todo el mundo) — se lee vía función backend en vez de .filter()
      // directo. Se pasan emails ya conocidos (son miembros de este viaje),
      // así que la respuesta sí incluye email — ver src/lib/userProfiles.js.
      // El propio backend ya resuelve internamente el fallback email→User→
      // user_id para perfiles sin email backfilled, así que el fallback en
      // dos pasos que había aquí ya no hace falta.
      return searchUserProfiles({ emails: memberEmails });
    },
    enabled: memberEmails.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const profileMap = useMemo(() => {
    const map = {};
    memberProfiles.forEach(p => { const e = normalizeEmail(p.email); if (e) map[e] = p; });
    (profiles || []).forEach(p => {
      const e = normalizeEmail(p.email || p.user_email);
      if (e) map[e] = p;
    });
    return map;
  }, [memberProfiles, profiles]);

  // José (14 sep 2026): esto nunca se había llegado a programar de verdad
  // -- solo se vio en la maqueta interactiva, pero el código real seguía
  // sin pedir las invitaciones pendientes. Mismo queryKey que InviteModal.jsx
  // (['tripPendingInvites', tripId]) para compartir caché -- al enviar una
  // invitación desde ahí, esto se refresca solo.
  // Límite honesto: el rls de TripInvite solo deja leer una invitación a
  // quien la mandó o a quien va dirigida -- así que esto solo muestra
  // "pendiente" desde la cuenta de quien invitó, no a cualquier otro
  // miembro del viaje (no es un fallo, es la misma regla que evita filtrar
  // a quién ha invitado quién).
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['tripPendingInvites', tripId],
    queryFn: () => base44.entities.TripInvite.filter({ trip_id: tripId, status: 'pending' }),
    enabled: !!tripId,
    staleTime: 30000,
  });

  // José (15 sep 2026): "que salgan los avatares con nombre y apellido
  // (mismo formato que en invitaciones)" -- misma idea que ya se usa en
  // GridAvatarItem (InviteModal.jsx): primera palabra en una línea,
  // el resto en la siguiente, en vez de dejar que el texto envuelva donde
  // quiera. Nombres de una sola palabra se quedan en una línea, sin
  // segunda línea vacía.
  const splitName = (full) => {
    const parts = (full || '').trim().split(/\s+/);
    if (parts.length <= 1) return [full || '', ''];
    return [parts[0], parts.slice(1).join(' ')];
  };

  return (
    <div className="px-4 py-3 flex items-center gap-4 flex-wrap">
      {memberEmails.map((email, i) => {
        const profile = profileMap[email] || null;
        // Nunca el email en crudo como nombre visible — display_name y
        // username son campos obligatorios de UserProfile, así que si no
        // aparecen es que no se encontró el perfil (ver arriba), no que la
        // persona no tenga nombre. En ese caso, un placeholder neutro.
        const name = profile?.display_name || profile?.username || t('common.member');
        const initials = (profile?.display_name || profile?.username || '?').slice(0, 2).toUpperCase();
        const isMe = normalizeEmail(currentUserEmail) === email;
        const [l1, l2] = isMe ? [t('common.you'), ''] : splitName(name);
        return (
          <div key={email} className="flex flex-col items-center gap-1">
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt={name} className="w-9 h-9 rounded-full object-cover" />
              : <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${colors[i % colors.length]}`}>{initials}</div>
            }
            <span className="text-xs text-muted-foreground leading-tight text-center max-w-[64px]">
              {l1}{l2 && <><br />{l2}</>}
            </span>
          </div>
        );
      })}
      {pendingInvites.map(inv => (
        <div key={inv.id} className="flex flex-col items-center gap-1">
          <div className="w-9 h-9 rounded-full border-2 border-dashed border-amber-300 bg-amber-50 flex items-center justify-center">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <span className="text-[11px] text-amber-600 leading-tight text-center font-medium max-w-[64px]">
            {t('common.pending')}<br />{t('invites.modal.toAccept')}
          </span>
        </div>
      ))}
      <button onClick={onInvite} className="flex flex-col items-center gap-1">
        <div className="w-9 h-9 rounded-full border-2 border-dashed border-border flex items-center justify-center hover:border-primary/40 transition-colors">
          <UserPlus className="w-4 h-4 text-muted-foreground/50" />
        </div>
        <span className="text-xs text-muted-foreground">{t('common.add')}</span>
      </button>
    </div>
  );
}
