import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { notify, resolveUserIds } from '@/lib/notifications';
import { normalizeEmail } from '@/lib/utils';
import { computeEditors } from '@/lib/syncTripMembers';
import { format, differenceInDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Trash2, LogOut, Link2, RefreshCw, X, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TripDateRangePicker from '@/components/trip/TripDateRangePicker';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CitySearch, CountryField } from '@/components/trip/stopFields';
import MembersPanel from '@/components/trip/MembersPanel';
import { normalizeCountry, getCountryLabel, getCountryIso } from '@/lib/countryConfig';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle } from 'lucide-react';
import { cityDateSpan, syncTripFromCities, sortCitiesByDate } from '@/lib/tripDates';
import { getOrCreateTripInviteLink, regenerateTripInviteLink, buildTripInviteLinkUrl } from '@/lib/inviteLinks';

// José (14 sep 2026): sección del link general de invitación (grupo, hasta
// 20 usos, caduca en 7 días) -- ver base44/functions/createTripInviteLink
// para el modelo completo. Solo visible para admins: crear/ver el estado lo
// permitiría también un editor (createTripInviteLink), pero regenerar exige
// admin, así que se simplifica mostrando la sección entera solo a admins.
function TripInviteLinkSection({ trip, tripId }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const { data: link, refetch } = useQuery({
    queryKey: ['tripInviteLink', tripId],
    // createTripInviteLink reutiliza el activo si ya existe -- llamarla
    // aquí no crea uno nuevo de más, solo sirve también para "consultar el
    // estado", que es justo lo que hace falta pintar aquí.
    queryFn: () => getOrCreateTripInviteLink(tripId),
    enabled: !!tripId,
    staleTime: 30000,
  });

  const handleCopy = async () => {
    if (!link) return;
    const url = buildTripInviteLinkUrl(link, trip);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t('invites.modal.linkCopied') });
    } catch {}
  };

  const handleRegenerate = async () => {
    setBusy(true);
    try {
      await regenerateTripInviteLink(tripId);
      await refetch();
      toast({ title: t('trip.dialog.linkRegenerated') });
    } catch (e) {
      toast({ title: t('common.error'), description: e.message, variant: 'destructive' });
    }
    setBusy(false);
  };

  if (!link) return null;

  const usesLeft = Math.max(0, (link.max_uses || 0) - (link.use_count || 0));
  const daysLeft = Math.max(0, Math.ceil((new Date(link.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

  return (
    <div className="px-5 py-4 border-b border-border">
      <div className="flex items-center gap-2 mb-2">
        <Link2 className="w-4 h-4 text-primary" />
        <p className="text-sm font-medium text-foreground">{t('trip.dialog.groupLink')}</p>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {t('trip.dialog.groupLinkStatus', { used: link.use_count || 0, max: link.max_uses, days: daysLeft })}
      </p>
      <div className="flex gap-2">
        <button onClick={handleCopy}
          className="flex-1 h-9 rounded-full border border-border text-xs font-medium text-foreground bg-card">
          {t('trip.dialog.copyLink')}
        </button>
        <button onClick={handleRegenerate} disabled={busy}
          className="flex-1 h-9 rounded-full border border-border text-xs font-medium text-foreground bg-card flex items-center justify-center gap-1.5 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />{t('trip.dialog.regenerateLink')}
        </button>
      </div>
    </div>
  );
}

export default
function SettingsDialog({
  open, onClose, trip, cities, tripId, isAdmin, onDelete, onLeave, onSaved, profiles = [], currentUserEmail = ''
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [cityToDelete, setCityToDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cityLoading, setCityLoading] = useState(null);

  // Con paradas fechadas, las fechas del viaje se calculan solas (tripDates.js).
  const stopsSpan = cityDateSpan(cities);
  const datesFromStops = !!stopsSpan;

  // Init form from trip data
  useEffect(() => {
    if (open && trip) {
      setName(trip.name || '');
      setStartDate(stopsSpan?.start || trip.start_date || '');
      setEndDate(stopsSpan?.end || trip.end_date || '');
    }
  }, [open, trip, stopsSpan?.start, stopsSpan?.end]);

  const totalDays = startDate && endDate
    ? differenceInDays(parseISO(endDate), parseISO(startDate)) + 1
    : null;

  const handleSaveTrip = async () => {
    if (!name.trim()) return;
    // Antes se guardaba igual aunque la fecha de fin quedara antes que la de
    // inicio — no rompía nada de golpe, pero dejaba el viaje sin ningún día
    // generado (getTripDays descarta el rango entero) sin avisar de por qué.
    if (startDate && endDate && endDate < startDate) {
      toast({ title: t('trip.dialog.endBeforeStart'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await base44.entities.Trip.update(tripId, {
        name: name.trim(),
        // Con paradas fechadas las fechas no se tocan desde aquí (se calculan).
        ...(datesFromStops ? {} : { start_date: startDate, end_date: endDate }),
      });
            // Avisa al resto de miembros si el nombre o las fechas cambian de
            // verdad -- antes esto era un cambio silencioso, nadie se enteraba
            // hasta que se volvia a abrir Ajustes.
            const tripChanged = (trip?.name || '') !== name.trim() || (trip?.start_date || '') !== startDate || (trip?.end_date || '') !== endDate;
            if (tripChanged) {
                      const targets = (trip?.members || []).filter(e => normalizeEmail(e) !== normalizeEmail(currentUserEmail));
                      if (targets.length) {
                                  resolveUserIds(targets).then(resolved => {
                                                resolved.forEach(({ userId }) => notify({
                                                                userId,
                                                                type: 'trip_updated',
                                                                tripId,
                                                                tripName: name.trim(),
                                                                refExtra: { startDate, endDate },
                                                }));
                                  });
                      }
            }
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    }
    setSaving(false);
  };

  // ── Paradas (José, 24 sep 2026): mismo componente que el viaje nuevo --
  // línea numerada, un solo campo de ciudad (el país sale de Google), fechas
  // en pastilla (opcionales) y cada cambio se guarda al momento, sin paneles
  // de "Hecho / Cancelar".
  const [editingCityId, setEditingCityId] = useState(null); // ciudad cuyo nombre se cambia
  const [dateDrafts, setDateDrafts] = useState({}); // { cityId: {start,end} } mientras se elige la vuelta
  const countryTimers = useRef({});
  const sortedCities = sortCitiesByDate(cities || []);

  const notifyCityChange = (cityName, country) => {
    const targets = (trip?.members || []).filter(e => normalizeEmail(e) !== normalizeEmail(currentUserEmail));
    if (!targets.length) return;
    resolveUserIds(targets).then(resolved => {
      resolved.forEach(({ userId }) => notify({
        userId, type: 'trip_updated', tripId, tripName: trip?.name,
        refTitle: cityName, refExtra: { city: cityName, country: country || '' },
      }));
    });
  };

  const updateCity = async (city, patch) => {
    setCityLoading(city.id);
    try {
      await base44.entities.City.update(city.id, patch);
      const changed = ('country' in patch && normalizeCountry(city.country || '') !== normalizeCountry(patch.country || ''))
        || ('start_date' in patch && (city.start_date || '') !== (patch.start_date || ''))
        || ('end_date' in patch && (city.end_date || '') !== (patch.end_date || ''))
        || ('name' in patch && city.name !== patch.name);
      if (changed) notifyCityChange(patch.name || city.name, patch.country ?? city.country);
      await syncTripFromCities(tripId, queryClient);
      queryClient.invalidateQueries({ queryKey: ['cities', tripId] });
    } catch (e) {
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    }
    setCityLoading(null);
  };

  const changeCityPlace = (city, data, opts = {}) => {
    if (opts.coordsOnly) {
      if (data.lat != null) updateCity(city, { lat: data.lat, lng: data.lng, place_id: data.placeId, place_refreshed_at: new Date().toISOString() });
      return;
    }
    setEditingCityId(null);
    updateCity(city, {
      name: data.city,
      ...(data.country ? { country: normalizeCountry(data.country) } : {}),
      // Coordenadas nuevas llegan después (coordsOnly); mientras, se limpian las viejas.
      lat: null, lng: null, place_id: data.placeId || null, place_refreshed_at: null,
    });
  };

  const changeCityDates = (city, { start, end }) => {
    // Se guarda con el rango completo o vacío; mientras se elige la vuelta, borrador.
    if ((start && end) || (!start && !end)) {
      setDateDrafts(p => { const n = { ...p }; delete n[city.id]; return n; });
      updateCity(city, { start_date: start || '', end_date: end || '' });
    } else {
      setDateDrafts(p => ({ ...p, [city.id]: { start, end } }));
    }
  };

  const changeCityCountry = (city, value) => {
    clearTimeout(countryTimers.current[city.id]);
    const canon = normalizeCountry(value || '');
    if (!canon || !getCountryIso(canon) || canon === normalizeCountry(city.country || '')) return;
    countryTimers.current[city.id] = setTimeout(() => updateCity(city, { country: canon }), 600);
  };

  const pendingNewRef = useRef(null);
  const addCityFrom = async (data, opts = {}) => {
    if (opts.coordsOnly) {
      // La parada ya se creó: se le ponen las coordenadas en cuanto llegan.
      const created = await pendingNewRef.current;
      if (created?.id && data.lat != null) {
        base44.entities.City.update(created.id, { lat: data.lat, lng: data.lng, place_refreshed_at: new Date().toISOString() })
          .then(() => queryClient.invalidateQueries({ queryKey: ['cities', tripId] })).catch(() => {});
      }
      return;
    }
    if (!trip?.members?.length) { toast({ title: t('common.saveError'), description: t('cities.tripNotLoadedRetry'), variant: 'destructive' }); return; }
    const last = sortedCities[sortedCities.length - 1];
    setCityLoading('new');
    const p = base44.entities.City.create({
      trip_id: tripId,
      name: data.city,
      country: normalizeCountry(data.country || (data.placeId ? '' : last?.country || '')),
      place_id: data.placeId || undefined,
      order: (cities || []).length,
      trip_members: trip.members,
      trip_editors: computeEditors(trip.members, trip),
    });
    pendingNewRef.current = p;
    try {
      await p;
      await syncTripFromCities(tripId, queryClient);
      queryClient.invalidateQueries({ queryKey: ['cities', tripId] });
    } catch (e) {
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    }
    setCityLoading(null);
  };

  const deleteCity = async (cityId) => {
    if (cities.length <= 1) return;
    setCityLoading(cityId);
    try {
      // Los días de la parada se borran también: si no, quedan huérfanos en la BD
      // apuntando a un city_id que ya no existe.
      const days = await base44.entities.ItineraryDay.filter({ city_id: cityId });
      await Promise.all(days.map(d => base44.entities.ItineraryDay.delete(d.id)));
      await base44.entities.City.delete(cityId);
      await syncTripFromCities(tripId, queryClient);
      queryClient.invalidateQueries({ queryKey: ['cities', tripId] });
      queryClient.invalidateQueries({ queryKey: ['itineraryDays', tripId] });
      setCityToDelete(null);
    } catch (e) {
      toast({
        title: t('trip.dialog.deleteStopError'),
        description: e?.message || t('common.tryAgain'),
        variant: 'destructive',
      });
    }
    setCityLoading(null);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      {/* José (24 sep 2026): Radix enfoca el primer campo al abrir -- el nombre
          del viaje salía seleccionado y saltaba el teclado. Se abre sin foco;
          el nombre se edita solo si el usuario lo toca. */}
      <DialogContent className="bg-card border-border p-0 max-w-md max-h-[90vh] overflow-y-auto gap-0"
        onOpenAutoFocus={e => e.preventDefault()}>
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle className="text-foreground text-base font-semibold">{t('trip.settings')}</DialogTitle>
        </DialogHeader>

        {/* Nombre — esta auditoría cerró Trip.update a "solo admin" (ver el
            comentario largo en base44/entities/Trip.jsonc: antes cualquier
            miembro podía tocar members/roles vía este mismo update, no solo
            el nombre/fechas). Antes de eso, cualquier miembro podía renombrar
            el viaje o cambiar sus fechas; ahora eso pasa a ser solo-admin
            también en la UI, para no dejar a un editor/viewer con campos
            editables que el backend va a rechazar en silencio. */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-1">{t('trip.tripName')}</p>
            {isAdmin ? (
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                className="h-8 text-sm font-medium border-0 p-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                placeholder={t('trip.tripName')}
              />
            ) : (
              <p className="text-sm font-medium text-foreground">{name}</p>
            )}
          </div>
        </div>

        {/* Fechas */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-1.5">{t('trip.dialog.tripDates')}</p>
            {isAdmin && !datesFromStops ? (
              <div>
                {/* José (24 sep 2026): mismo calendario de rango que al crear el viaje. */}
                <TripDateRangePicker
                  compact
                  start={startDate}
                  end={endDate}
                  onChange={({ start, end }) => { setStartDate(start); setEndDate(end); }}
                />
                {totalDays && (
                  <span className="inline-block mt-1.5 text-xs bg-accent text-primary px-2 py-1 rounded-full font-medium">
                    {totalDays}d
                  </span>
                )}
              </div>
            ) : (
              <div>
                <p className="text-sm text-foreground">
                  {startDate ? format(parseISO(startDate), 'dd MMM yyyy', { locale: i18n.language === 'en' ? undefined : es }) : '—'} → {endDate ? format(parseISO(endDate), 'dd MMM yyyy', { locale: i18n.language === 'en' ? undefined : es }) : '—'}
                  {totalDays && <span className="text-xs bg-accent text-primary px-2 py-1 rounded-full font-medium ml-2">{totalDays}d</span>}
                </p>
                {datesFromStops && <p className="text-xs text-muted-foreground mt-1">{t('trip.dialog.datesFromStops')}</p>}
              </div>
            )}
          </div>
        </div>
        {!isAdmin && (
          <div className="px-5 py-2 border-b border-border bg-secondary/30">
            <p className="text-xs text-muted-foreground">{t(datesFromStops ? 'trip.dialog.adminOnlyEditName' : 'trip.dialog.adminOnlyEdit')}</p>
          </div>
        )}

        {/* Paradas — misma línea numerada que el viaje nuevo */}
        <div className="px-5 py-4 border-b border-border">
          <p className="text-sm font-bold text-foreground mb-3">{t('trip.dialog.stops', { count: sortedCities.length })}</p>
          {sortedCities.map((city, idx) => {
            const draft = dateDrafts[city.id];
            const prev = [...sortedCities.slice(0, idx)].reverse().find(c => c.end_date);
            const next = sortedCities.slice(idx + 1).find(c => c.start_date);
            const noPlace = !city.place_id;
            return (
              <div key={city.id} className="flex gap-3">
                <div className="flex flex-col items-center w-6 flex-shrink-0">
                  <div className="w-6 h-6 rounded-full border-[1.5px] border-orange-300 bg-orange-50 dark:bg-orange-950/30 text-primary text-[11px] font-bold flex items-center justify-center">
                    {cityLoading === city.id ? <Loader2 className="w-3 h-3 animate-spin" /> : idx + 1}
                  </div>
                  <div className="flex-1 w-[1.5px] bg-orange-200 dark:bg-orange-900/50 my-1" />
                </div>
                <div className="flex-1 min-w-0 bg-card border border-border rounded-2xl px-3 py-2.5 mb-2.5">
                  <div className="flex items-start gap-2">
                    {editingCityId === city.id ? (
                      <CitySearch initial={city.name} autoFocus placeholder={t('trip.new.searchCity')}
                        onPick={(data, opts) => changeCityPlace(city, data, opts)}
                        onCancel={() => setEditingCityId(null)} />
                    ) : (
                      <button type="button" onClick={() => setEditingCityId(city.id)} className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-semibold text-foreground truncate">{city.name}</p>
                        {!noPlace && city.country && <p className="text-xs text-muted-foreground truncate">{getCountryLabel(city.country, i18n.language)}</p>}
                      </button>
                    )}
                    {sortedCities.length > 1 && (
                      <button type="button" onClick={() => setCityToDelete(city)} aria-label={t('trip.dialog.deleteStop')}
                        className="w-8 h-8 -m-1 rounded-full flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-secondary flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {/* Ciudad sin sugerencia de Google (o antigua): país editable. */}
                  {noPlace && editingCityId !== city.id && (
                    <div className="mt-2">
                      <CountryField value={city.country || ''} onChange={v => changeCityCountry(city, v)} />
                    </div>
                  )}
                  <div className="mt-2">
                    <TripDateRangePicker
                      variant="pill"
                      start={draft ? draft.start : (city.start_date || '')}
                      end={draft ? draft.end : (city.end_date || '')}
                      minDate={prev?.end_date || undefined}
                      maxDate={next?.start_date || undefined}
                      onChange={range => changeCityDates(city, range)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex gap-3 items-center">
            <div className="w-6 flex-shrink-0 flex justify-center">
              <div className="w-6 h-6 rounded-full border-[1.5px] border-dashed border-orange-300 text-primary flex items-center justify-center">
                {cityLoading === 'new' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </div>
            </div>
            <CitySearch key={sortedCities.length} placeholder={t('trip.new.addCity')} onPick={addCityFrom} />
          </div>
        </div>

        {/* Viajeros — antes solo mostraba avatares con un botón "Invitar";
            MembersPanel existía en el proyecto pero no estaba conectado a
            ninguna pantalla, así que no había forma de ver el rol de cada
            miembro, cambiarlo o expulsar a alguien desde la app. */}
        <div className="px-5 py-4 border-b border-border">
          <MembersPanel trip={trip} currentUserEmail={currentUserEmail} isAdmin={isAdmin} profiles={profiles} />
        </div>

        {isAdmin && <TripInviteLinkSection trip={trip} tripId={tripId} />}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5">
          {isAdmin && (
            <button onClick={onDelete}
              className="text-sm text-red-500 flex items-center gap-1.5 hover:text-red-700 transition-colors">
              <Trash2 className="w-4 h-4" />{t('trip.dialog.deleteTrip')}
            </button>
          )}
          {/* Sin esto, un miembro no-admin no tenía forma de abandonar el
              viaje: solo el admin puede expulsar a otros, y el admin no
              puede expulsarse a sí mismo. leaveTrip() ya existía en el
              backend (base44/functions/leaveTrip) y en tripMembers.js, solo
              faltaba exponerlo aquí. */}
          {!isAdmin && (
            <button onClick={onLeave}
              className="text-sm text-red-500 flex items-center gap-1.5 hover:text-red-700 transition-colors">
              <LogOut className="w-4 h-4" />{t('trip.dialog.leaveTrip')}
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
            {isAdmin && (
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-white"
                onClick={handleSaveTrip}
                disabled={!name.trim() || saving}>
                {saving ? t('trip.dialog.saving') : t('common.save')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>

      {/* Confirmación de borrado de parada: antes desaparecía de un toque, y con
          ella los días de esa ciudad, sin avisar. */}
      <Dialog open={!!cityToDelete} onOpenChange={o => !o && setCityToDelete(null)}>
        <DialogContent className="max-w-xs rounded-2xl p-5">
          <DialogHeader className="sr-only"><DialogTitle>{t('trip.dialog.deleteStopConfirm')}</DialogTitle></DialogHeader>
          <div className="flex items-start gap-3 mb-1">
            <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-red-500" />
            </div>
            <p className="text-sm font-medium text-foreground pt-1.5">{t('trip.dialog.deleteStopConfirm')}</p>
          </div>
          <p className="text-xs text-muted-foreground mb-5 ml-11">
            {t('trip.dialog.deleteStopWarning', { city: cityToDelete?.name || '' })}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setCityToDelete(null)}
              className="flex-1 py-3 border border-border rounded-full text-sm text-muted-foreground">
              {t('common.cancel')}
            </button>
            <button onClick={() => deleteCity(cityToDelete.id)}
              disabled={cityLoading === cityToDelete?.id}
              className="flex-1 py-3 bg-primary text-white rounded-full text-sm font-medium disabled:opacity-50">
              {cityLoading === cityToDelete?.id ? t('trip.dialog.deleting') : t('common.delete')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

