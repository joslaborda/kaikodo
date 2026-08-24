import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { notify, resolveUserIds } from '@/lib/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin, Calendar, Mail, Check, X, ChevronLeft } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { toast } from '@/components/ui/use-toast';
import { acceptTripInvite, declineTripInvite } from '@/lib/invites';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { getCountryLabel } from '@/lib/countryConfig';
import { normalizeEmail } from '@/lib/utils';

export default function Invites() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? undefined : es;
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { user: currentUser, navigateToLogin } = useAuth();
  const [processing, setProcessing] = useState(false);

  // ── Con token: aceptar desde email ─────────────────────────────────────────
  const { data: invite, isLoading: inviteLoading } = useQuery({
    queryKey: ['invite', token],
    queryFn: async () => {
      if (!token) return null;
      // Buscar pendiente primero
      const pending = await base44.entities.TripInvite.filter({ invite_token: token, status: 'pending' });
      if (pending[0]) return { ...pending[0], _status: 'pending' };
      // Si no hay pendiente, puede estar ya aceptada — buscar sin filtro de status
      const accepted = await base44.entities.TripInvite.filter({ invite_token: token });
      if (accepted[0]) return { ...accepted[0], _status: accepted[0].status };
      return null;
    },
    enabled: !!token,
  });

  // Trip.read ahora solo deja leer a quien ya es miembro (antes estaba
  // abierto a cualquier usuario logueado de Kōdo, lo cual dejaba ver nombre,
  // destino, fechas y el email de todos los miembros de CUALQUIER viaje —
  // no solo los tuyos). Quien abre este enlace normalmente todavía NO es
  // miembro, así que Trip.get directo ya no le sirve: se pide la vista
  // previa vía la función getTripPreview, que sí puede leer el viaje (con
  // permisos de servicio) pero solo si el token coincide con una invitación
  // real dirigida a su email.
  const { data: trip, isLoading: tripLoading } = useQuery({
    queryKey: ['tripPreview', invite?.trip_id, token],
    queryFn: async () => {
      const result = await base44.functions.invoke('getTripPreview', { tripId: invite.trip_id, token });
      const data = result?.data ?? result;
      if (data?.error) throw new Error(data.error);
      return data.trip;
    },
    enabled: !!invite?.trip_id && !!token,
  });

  // ── Sin token: listar invitaciones del usuario ──────────────────────────────
  const { data: pendingInvites = [], refetch: refetchInvites } = useQuery({
    queryKey: ['myPendingInvites', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      // invites.js guarda el email siempre en minúsculas — sin normalizar
      // aquí, un email con mayúsculas no encontraba sus propias invitaciones.
      return base44.entities.TripInvite.filter({ email: currentUser.email.toLowerCase(), status: 'pending' });
    },
    enabled: !!currentUser?.email && !token,
  });

  // Mismo motivo que la vista previa de arriba: todavía no eres miembro de
  // estos viajes, así que Trip.get directo ya no vale con Trip.read cerrado
  // a solo miembros — se pide cada uno vía getTripPreview con el token de
  // su propia invitación. Si una falla (token corrupto, etc.) no revienta
  // la lista entera: esa tarjeta simplemente sale sin datos del viaje.
  const { data: pendingTrips = [] } = useQuery({
    queryKey: ['pendingTrips', pendingInvites.map(i => i.id).join(',')],
    queryFn: async () => {
      if (!pendingInvites.length) return [];
      return Promise.all(pendingInvites.map(async inv => {
        try {
          const result = await base44.functions.invoke('getTripPreview', { tripId: inv.trip_id, token: inv.invite_token });
          const data = result?.data ?? result;
          return data?.trip || null;
        } catch {
          return null;
        }
      }));
    },
    enabled: pendingInvites.length > 0,
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const notifyMembers = async (tripId, tripName, acceptingEmail, acceptingUserId) => {
    try {
      const myProfArr = await base44.entities.UserProfile.filter({ email: acceptingEmail });
      const myProf = myProfArr[0] || null;
      const tripData = await base44.entities.Trip.get(tripId);
      // Sin normalizar, un email de sesión con distinto casing al de
      // trip.members hacía que este filtro no excluyera a quien acaba de
      // aceptar — podía llegar a notificarse a sí mismo de su propia unión.
      const others = (tripData?.members || []).filter(e => normalizeEmail(e) !== normalizeEmail(acceptingEmail));
      const resolved = await resolveUserIds(others);
      resolved.forEach(({ userId }) =>
        notify({ userId, type: 'member_joined', actor: myProf, tripId, tripName: tripData?.name })
      );
    } catch {}
  };

  // ── Aceptar desde token ──────────────────────────────────────────────────────
  const handleAccept = async () => {
    if (!invite || !currentUser?.email || invite._status !== 'pending') return;
    setProcessing(true);
    try {
      await acceptTripInvite(invite.id, token);
      await notifyMembers(invite.trip_id, trip?.name, currentUser.email, currentUser.id);
      qc.invalidateQueries({ queryKey: ['myPendingInvites'] });
      navigate(createPageUrl(`Home?trip_id=${invite.trip_id}`));
    } catch (e) {
      toast({ title: t('common.error'), description: e.message || t('invites.page.acceptError'), variant: 'destructive' });
      setProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!invite) return;
    setProcessing(true);
    try {
      await declineTripInvite(invite.id, token);
      navigate(createPageUrl('TripsList'));
    } catch (e) {
      toast({ title: t('common.error'), description: e.message || t('invites.page.rejectError'), variant: 'destructive' });
      setProcessing(false);
    }
  };

  // ── Aceptar desde lista ──────────────────────────────────────────────────────
  const handleAcceptFromList = async (inv) => {
    if (!currentUser?.email) return;
    setProcessing(true);
    try {
      await acceptTripInvite(inv.id, inv.invite_token);
      await notifyMembers(inv.trip_id, null, currentUser.email, currentUser.id);
      qc.invalidateQueries({ queryKey: ['myPendingInvites'] });
      navigate(createPageUrl(`Home?trip_id=${inv.trip_id}`));
    } catch (e) {
      toast({ title: t('common.error'), description: e.message || t('invites.page.acceptError2'), variant: 'destructive' });
      setProcessing(false);
    }
  };

  const handleDeclineFromList = async (inv) => {
    setProcessing(true);
    try {
      await declineTripInvite(inv.id, inv.invite_token);
      await refetchInvites();
    } catch (e) {
      // Antes catch {} mudo, inconsistente con handleDecline (arriba) que sí
      // avisa de un fallo en la misma acción vía token.
      toast({ title: t('common.error'), description: e.message || t('invites.page.rejectError'), variant: 'destructive' });
    }
    setProcessing(false);
  };

  // ── Render: con token ────────────────────────────────────────────────────────
  if (token) {
    if (inviteLoading || tripLoading) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      );
    }

    if (!invite || !trip) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-4">
          <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
            <X className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{t('invites.page.invalidTitle')}</h2>
          <p className="text-sm text-muted-foreground text-center">
            {t('invites.page.invalidBody')}
          </p>
          <button onClick={() => navigate(createPageUrl('TripsList'))}
            className="h-11 px-8 rounded-full bg-primary text-white text-sm font-medium mt-2">
            {t('invites.page.goToTrips')}
          </button>
        </div>
      );
    }

    // Ya es miembro del viaje (aceptó esta invitación u otra, o ya estaba dentro).
    const isMember = currentUser?.email && trip?.members?.includes(currentUser.email.toLowerCase());

    if (isMember) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-4">
          <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center">
            <Check className="w-7 h-7 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{t('invites.page.alreadyMemberTitle')}</h2>
          <p className="text-sm text-muted-foreground text-center">
            {t('invites.page.alreadyMemberBody1')} <span className="font-medium text-foreground">{trip.name}</span>.
          </p>
          <button onClick={() => navigate(createPageUrl('Home') + `?trip_id=${trip.id}`)}
            className="h-11 px-8 rounded-full bg-primary text-white text-sm font-medium mt-2">
            {t('invites.page.goToTrip')}
          </button>
        </div>
      );
    }

    // Antes esto se trataba igual que "ya eres miembro" (cualquier status
    // distinto de 'pending' caía en esa pantalla con botón "ir al viaje") —
    // alguien que había RECHAZADO la invitación, o cuyo enlace ya no era
    // válido por otro motivo, veía "ya eres miembro de X" sin serlo: la
    // tarjeta del viaje se veía, pero ningún botón de aceptar/rechazar tenía
    // sentido ni aparecía. Se distingue cada caso con su propio mensaje.
    if (invite._status === 'declined') {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-4">
          <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-7 h-7 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{t('invites.page.declinedTitle')}</h2>
          <p className="text-sm text-muted-foreground text-center">
            {t('invites.page.declinedBody')} <span className="font-medium text-foreground">{trip.name}</span>.
          </p>
          <button onClick={() => navigate(createPageUrl('TripsList'))}
            className="h-11 px-8 rounded-full bg-primary text-white text-sm font-medium mt-2">
            {t('invites.page.goToTrips')}
          </button>
        </div>
      );
    }

    if (invite._status !== 'pending') {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-4">
          <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
            <X className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{t('invites.page.invalidTitle')}</h2>
          <p className="text-sm text-muted-foreground text-center">
            {t('invites.page.invalidBody')}
          </p>
          <button onClick={() => navigate(createPageUrl('TripsList'))}
            className="h-11 px-8 rounded-full bg-primary text-white text-sm font-medium mt-2">
            {t('invites.page.goToTrips')}
          </button>
        </div>
      );
    }

    // El enlace está atado al email invitado: si la sesión es de otra cuenta, avisar.
    const emailMismatch = currentUser?.email && invite.email &&
      currentUser.email.toLowerCase() !== invite.email.toLowerCase();

    if (emailMismatch) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-4">
          <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
            <Mail className="w-7 h-7 text-amber-600" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{t('invites.page.mismatchTitle')}</h2>
          <p className="text-sm text-muted-foreground text-center max-w-xs">
            {t('invites.page.mismatch1')} <span className="font-medium text-foreground">{invite.email}</span>{t('invites.page.mismatch2')} <span className="font-medium text-foreground">{currentUser.email}</span>. {t('invites.page.mismatch3')}
          </p>
          <button onClick={() => navigate(createPageUrl('TripsList'))}
            className="h-11 px-8 rounded-full bg-primary text-white text-sm font-medium mt-2">
            {t('invites.page.goToTrips')}
          </button>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header Kōdo */}
        <div className="px-5 pt-14 pb-6 border-b border-border bg-background">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-950/30 flex items-center justify-center">
              <Mail className="w-4 h-4 text-primary" />
            </div>
            <p className="text-xs text-muted-foreground">{t('invites.page.youHaveInvite')}</p>
          </div>
          <h1 className="text-xl font-semibold text-foreground">{t('invites.page.joinQuestion')}</h1>
        </div>

        <div className="px-5 py-6 space-y-4">
          {/* Trip card */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
            <p className="text-lg font-semibold text-foreground">{trip.name}</p>

            {trip.destination && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
                {trip.destination}{trip.country ? `, ${getCountryLabel(trip.country, i18n.language)}` : ''}
              </div>
            )}

            {trip.start_date && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="w-4 h-4 text-primary flex-shrink-0" />
                {format(parseISO(trip.start_date), i18n.language === 'en' ? 'MMMM d, yyyy' : "d 'de' MMMM yyyy", { locale: dateLocale })}
                {trip.end_date && ` — ${format(parseISO(trip.end_date), i18n.language === 'en' ? 'MMMM d, yyyy' : "d 'de' MMMM yyyy", { locale: dateLocale })}`}
              </div>
            )}

            <div className="pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {t('invites.page.invitedBy')} <span className="font-medium text-foreground">{invite.invited_by || t('invites.page.aCompanion')}</span>
                {' · '}{t('invites.page.role')} <span className="font-medium text-foreground capitalize">{invite.role || 'editor'}</span>
              </p>
            </div>
          </div>

          {!currentUser && (
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-primary/20 rounded-2xl px-4 py-3">
              <p className="text-xs text-primary font-medium">{t('invites.page.createAccountHint')}</p>
            </div>
          )}

          {/* Botones — antes iban en un contenedor aparte empujado al fondo
              del viewport con flex-1 (mt-auto en la práctica). En el navegador
              in-app que abre el enlace del email (Outlook, Gmail, etc.) la
              barra de herramientas inferior se come parte de ese "100vh", así
              que los botones quedaban tapados o exigían hacer scroll sin que
              se notara que hacía falta. Ahora van justo debajo de la tarjeta
              del viaje, en el flujo normal — siempre visibles sin adivinar. */}
          <div className="flex gap-3 pt-1">
            <button onClick={handleDecline} disabled={processing}
              className="flex-1 h-12 rounded-full border border-border text-sm font-medium text-muted-foreground bg-card">
              {t('common.reject')}
            </button>
            {currentUser ? (
              <button onClick={handleAccept} disabled={processing}
                className="flex-1 h-12 rounded-full bg-primary text-white text-sm font-semibold disabled:opacity-50">
                {processing ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('invites.page.joinTrip')}
              </button>
            ) : (
              <button onClick={() => navigateToLogin()}
                className="flex-1 h-12 rounded-full bg-primary text-white text-sm font-semibold">
                {t('invites.page.loginToAccept')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Render: lista sin token ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-5 pt-14 pb-5 bg-background border-b border-border sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(createPageUrl('TripsList'))} className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center">
            <ChevronLeft className="w-4 h-4 text-foreground" />
          </button>
          <div>
            <h1 className="text-base font-semibold text-foreground">{t('invites.title')}</h1>
            <p className="text-xs text-muted-foreground">
              {pendingInvites.length === 0 ? t('invites.noPending')
                : t('invites.pendingCount', { count: pendingInvites.length })}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 space-y-3">
        {pendingInvites.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6" style={{minHeight: 'calc(100vh - 120px)'}}>
            {/* Icono con acento naranja */}
            <div className="relative mb-5">
              <div className="w-20 h-20 rounded-2xl bg-orange-50 dark:bg-orange-950/30 border border-orange-100 dark:border-orange-900/40 flex items-center justify-center">
                <Mail className="w-9 h-9 text-primary" />
              </div>
            </div>

            <p className="text-base font-semibold text-foreground mb-2">{t('invites.noPending')}</p>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mb-7">
              {t('invites.noPendingHint')}
            </p>

            {/* Pasos — qué esperar */}
            <div className="w-full space-y-2 text-left">
              <div className="flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3">
                <div className="w-7 h-7 rounded-full bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">1</span>
                </div>
                <p className="text-xs text-muted-foreground">{t('invites.page.step1')}</p>
              </div>
              <div className="flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3">
                <div className="w-7 h-7 rounded-full bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">2</span>
                </div>
                <p className="text-xs text-muted-foreground">{t('invites.page.step2')}</p>
              </div>
              <div className="flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3">
                <div className="w-7 h-7 rounded-full bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">3</span>
                </div>
                <p className="text-xs text-muted-foreground">{t('invites.page.step3')}</p>
              </div>
            </div>
          </div>
        ) : (
          pendingInvites.map(inv => {
            const tripData = pendingTrips.find(tripItem => tripItem?.id === inv.trip_id);
            return (
              <div key={inv.id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-orange-100 dark:bg-orange-950/30 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm">
                      {tripData?.name || t('utilities.loading')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('invites.page.invitedBy')} {inv.invited_by || t('invites.page.aCompanion')}
                    </p>
                  </div>
                </div>

                {tripData && (
                  <div className="space-y-1.5 pl-12">
                    {tripData.destination && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-primary" />
                        {tripData.destination}{tripData.country ? `, ${tripData.country}` : ''}
                      </p>
                    )}
                    {tripData.start_date && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-primary" />
                        {format(parseISO(tripData.start_date), "d MMM yyyy", { locale: dateLocale })}
                        {tripData.end_date && ` — ${format(parseISO(tripData.end_date), "d MMM yyyy", { locale: dateLocale })}`}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={() => handleDeclineFromList(inv)} disabled={processing}
                    className="flex-1 h-9 rounded-full border border-border text-xs font-medium text-muted-foreground">
                    {t('invites.reject')}
                  </button>
                  <button onClick={() => handleAcceptFromList(inv)} disabled={processing}
                    className="flex-1 h-9 rounded-full bg-primary text-white text-xs font-semibold disabled:opacity-50">
                    {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : t('invites.accept')}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
