import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { X, MapPin, Navigation, RefreshCw, Search, Loader2, Trash2 } from 'lucide-react';
import { searchNewPlaces, fetchPlaceDetails } from './placesAutocomplete';
import { invalidateTripDocs } from '@/hooks/useTripDocs';
import GooglePlaceCard, { googlePlaceIdOf } from './GooglePlaceCard';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { TYPE_CONFIG, getMapsUrl } from './spotsHelpers';
import { useTranslation } from 'react-i18next';
import DayTimeAssign from '@/components/spots/DayTimeAssign';
import { getTripDays, sameCityName } from '@/lib/tripDays';
import { normalizeEmail } from '@/lib/utils';

// José (24 sep 2026): "Cambiar alojamiento". El sitio de un spot no se edita
// (con ficha de Google, nombre y ubicación son los de Google), así que cambiar
// de hotel era borrar + añadir + volver a enlazar la reserva a mano. Esto lo
// hace de una vez: buscas el hotel nuevo, se crea como alojamiento de la misma
// ciudad, las reservas enlazadas al anterior pasan al nuevo y el anterior se
// borra. Se guarda solo el place id y el nombre que escribiste (términos EEA).
export function ChangeStay({ spot, tripId, currentUserEmail, canDelete, onDone }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 3) { setResults(r => (r.length ? [] : r)); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchNewPlaces(`${text} ${spot.city_name || ''}`.trim(), controller.signal)
        .then(setResults).catch(() => {})
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, spot.city_name]);

  const pick = async (r) => {
    if (busy) return;
    setBusy(true);
    try {
      const details = await fetchPlaceDetails(r._placeId).catch(() => null);
      const created = await base44.entities.Spot.create({
        trip_id: tripId || spot.trip_id,
        city_id: spot.city_id, city_name: spot.city_name, ...(spot.country ? { country: spot.country } : {}),
        title: q.trim() || r.title, title_is_own: true, type: 'hotel',
        ...(details?.lat != null ? { lat: details.lat, lng: details.lng, place_refreshed_at: new Date().toISOString() } : {}),
        osm_id: r._placeId, source: 'google_places',
        visibility: 'trip_members', visited: false,
        created_by: null, created_by_user_id: null, saved_by: [currentUserEmail].filter(Boolean),
        trip_members: spot.trip_members || [],
      });
      // Reservas enlazadas al alojamiento anterior -> al nuevo.
      const linked = await base44.entities.Ticket.filter({ spot_id: spot.id }).catch(() => []);
      await Promise.all((linked || []).map(d => base44.entities.Ticket.update(d.id, { spot_id: created.id }).catch(() => null)));
      // El anterior se borra si se puede; si no, el nuevo manda igual (es el más reciente).
      if (canDelete) await base44.entities.Spot.delete(spot.id).catch(() => null);
      queryClient.invalidateQueries({ queryKey: ['spots', tripId || spot.trip_id] });
      invalidateTripDocs(queryClient, tripId || spot.trip_id);
      toast({ title: t('spots.changeStay.done') });
      onDone?.();
    } catch (e) {
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full mt-2 inline-flex items-center justify-center gap-2 py-2.5 rounded-full border border-primary text-primary text-sm font-semibold hover:bg-orange-50 transition-colors">
        <RefreshCw className="w-4 h-4" />{t('spots.changeStay.button')}
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="relative">
        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={q} onChange={e => setQ(e.target.value)} autoFocus
          placeholder={t('spots.changeStay.placeholder')} autoComplete="off" autoCorrect="off" spellCheck={false}
          className="w-full h-10 pl-9 pr-9 rounded-xl border border-border bg-card text-sm outline-none focus:border-primary" />
        {(searching || busy) && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {results.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden max-h-56 overflow-y-auto">
          {results.map(r => (
            <button key={r.id} type="button" disabled={busy} onClick={() => pick(r)}
              className="w-full text-left px-3 py-2.5 border-b border-border last:border-0 hover:bg-secondary/40 disabled:opacity-50">
              <span className="block text-sm text-foreground truncate">{r.title}</span>
              {r.subtitle && <span className="block text-xs text-muted-foreground truncate">{r.subtitle}</span>}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => { setOpen(false); setQ(''); }} className="w-full text-xs text-muted-foreground py-1">{t('common.cancel')}</button>
    </div>
  );
}

export default function SpotDetailSheet({ spot, open, onClose, onSave, onDelete, tripId, tripCities, userId, onNotify, currentUserEmail }) {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(spot?.notes || '');
  const [assignedDate, setAssignedDate] = useState(spot?.assigned_date || '');
  // Ciudad explícitamente elegida en el <select> (por su cityId real), no
  // solo la fecha — ver comentario en tripDayOptions/handleSave más abajo
  // sobre por qué re-derivar la ciudad SOLO a partir de la fecha es ambiguo
  // en un día de tránsito entre dos ciudades distintas.
  const [assignedCityId, setAssignedCityId] = useState(spot?.city_id || null);
  const [assignedTime, setAssignedTime] = useState(spot?.assigned_time || '');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Mismo criterio que SpotCard.jsx: solo quien creó el spot puede borrarlo.
  // Antes cualquier miembro del grupo veía el botón de borrar sin confirmación.
  //
  // Caso especial: los spots guardados desde "Buscar" (resultados de OSM,
  // ver saveOsmPlace en Restaurants.jsx) se crean con created_by: null a
  // propósito — no tienen autor. La primera versión de este arreglo exigía
  // además estar en spot.saved_by, pero los spots guardados ANTES de que
  // saved_by existiera en el schema no lo tienen relleno — para esos,
  // seguía sin aparecer el botón aunque fueran del usuario. Un spot sin
  // autor no tiene a nadie a quien pertenecerle más que al viaje: si el
  // usuario actual puede verlo (es miembro del viaje), puede borrarlo.
  const canDelete = normalizeEmail(spot?.created_by) === normalizeEmail(currentUserEmail) || !spot?.created_by;

  // Build trip day options from cities — must be before early return.
  //
  // Si el viaje pasa por la misma ciudad más de una vez (p. ej. Lima 14-16
  // ago, luego otras paradas, y de vuelta a Lima 19-20 ago y 26-30 ago), son
  // TRES registros City distintos con el mismo nombre. Antes esto filtraba
  // solo por spot.city_id — el id exacto de la estancia en la que se creó el
  // spot — así que un spot guardado durante la primera estancia en Lima solo
  // podía asignarse a esos 3 primeros días, aunque el spot fuera de Lima en
  // general y el usuario quisiera planificarlo para la vuelta. Ahora se
  // agrupan por NOMBRE de ciudad: se ofrecen los días de todas las estancias
  // que se llamen igual que la del spot. (Ver handleSave: al guardar se
  // recalcula city_id según qué estancia contiene la fecha elegida — si no,
  // el spot quedaría con la fecha nueva pero el city_id de la estancia
  // vieja, y desaparecería de las vistas de itinerario que filtran por
  // ambos a la vez.)
  const tripDayOptions = useMemo(() => {
    const allDays = getTripDays(tripCities || []);
    const spotCityName = spot?.city_name
      || (tripCities || []).find(c => c.id === spot?.city_id)?.name;
    if (!spotCityName) {
      if (!spot?.city_id) return allDays;
      const own = allDays.filter(d => d.cityId === spot.city_id);
      return own.length > 0 ? own : allDays;
    }
    const sameCity = allDays.filter(d => sameCityName(d.city, spotCityName));
    return sameCity.length > 0 ? sameCity : allDays;
  }, [tripCities, spot?.city_id, spot?.city_name]);

  const hasTripDays = tripDayOptions.length > 0;

  useEffect(() => {
    if (spot) {
      setNotes(spot.notes || '');
      setAssignedDate(spot.assigned_date || '');
      setAssignedTime(spot.assigned_time || '');
      setAssignedCityId(spot.city_id || null);
    }
  }, [spot?.id]);

  useBodyScrollLock(!!open && !!spot);
  if (!open || !spot) return null;

  const tc = TYPE_CONFIG[spot.type] || TYPE_CONFIG.custom;
  // Un alojamiento es de toda la estancia: ni día ni hora (src/lib/cityStay.js).
  const isStay = spot.type === 'hotel';

  const handleSave = async () => {
    setSaving(true);
    const timeChanged = assignedTime !== (spot?.assigned_time || '');
    const dateChanged = assignedDate !== (spot?.assigned_date || '');
    // Se usa el cityId que el usuario eligió EXPLÍCITAMENTE en el <select>
    // (assignedCityId, ver el onChange de arriba), no un resolveCityIdForDate
    // recalculado solo a partir de la fecha: en un día de tránsito entre dos
    // ciudades (p. ej. Madrid termina el 5 ago el mismo día que Zaragoza
    // empieza), ese recálculo podía devolver la ciudad equivocada aunque el
    // usuario hubiera elegido explícitamente "Zaragoza" en el desplegable.
    const cityIdUpdate = assignedCityId && assignedCityId !== spot?.city_id
      ? { city_id: assignedCityId }
      : {};
    try {
      await base44.entities.Spot.update(spot.id, isStay
        ? { notes, assigned_date: null, assigned_time: null, day_order: null }
        : {
          notes,
          assigned_date: assignedDate || null,
          assigned_time: assignedTime || null,
          ...(timeChanged || dateChanged ? { day_order: null } : {}),
          ...cityIdUpdate,
        });
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      if (!isStay && timeChanged && assignedTime) onNotify?.('spot_time', null, spot.title, { time: assignedTime });
      onClose();
    } catch (e) {
      toast({ title: t('common.saveError'), description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const compactHeader = !!googlePlaceIdOf(spot) && online;

  return (
    <>
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="bg-card w-full max-w-lg rounded-t-3xl flex flex-col" style={{ maxHeight: '90vh', paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={e => e.stopPropagation()}>
        {/* Handle + Header — fixed */}
        <div className="flex-shrink-0">
          <div className="w-9 h-1 bg-border rounded-full mx-auto mt-4 mb-3" />
          {/* José (23 sep 2026): con ficha de Google (con conexión) la cabecera
              se reduce a categoría · ciudad: el nombre ya lo pone la ficha justo
              debajo, y el icono + título propio duplicaban y ocupaban mucho. */}
          <div className={`flex items-start justify-between px-5 border-b border-border ${compactHeader ? 'pb-2' : 'pb-4'}`}>
            {compactHeader ? (
              <p className="text-xs text-muted-foreground self-center">{t(tc.tk)}{spot.city_name ? ' · ' + spot.city_name : ''}</p>
            ) : (
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${tc.color}`}>
                {tc.Icon && <tc.Icon size={14} />}
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">{spot.title}</p>
                <p className="text-xs text-muted-foreground">{t(tc.tk)}{spot.city_name ? ' · ' + spot.city_name : ''}</p>
              </div>
            </div>
            )}
            {/* José (24 sep 2026): "una vez guardados no puedes hacer nada, no
                hay botón de eliminar" -- estaba al final del contenido, debajo
                de la ficha de Google (que es larga), y no se veía. Ahora va
                arriba, junto a cerrar. */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {canDelete && (
                <button aria-label={t('spots.sheet.deleteSpot')} onClick={() => setShowDeleteConfirm(true)}
                  className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Dirección + Cómo llegar — antes este sheet no tenía ningún enlace
              a Maps, a diferencia de SpotCard.jsx (misma info, otra vista) y
              SpotDetailModal.jsx (Home/Ruta). Mismo getMapsUrl que ya usan. */}
          {/* Con ficha de Google no hace falta: la ficha ya trae dirección y
              el botón de abrir en Google Maps (José, 23 sep 2026). */}
          {!googlePlaceIdOf(spot) && (spot.address || (spot.lat && spot.lng)) && (
            <div className="flex items-center justify-between gap-3">
              {spot.address ? (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5 flex-1 min-w-0">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  <span className="truncate">{spot.address}</span>
                </p>
              ) : <div className="flex-1" />}
              <a href={getMapsUrl(spot)} target="_blank" rel="noopener noreferrer"
                className="shrink-0 flex items-center gap-1.5 text-xs text-primary font-medium hover:text-primary/80 transition-colors">
                <Navigation className="w-3.5 h-3.5" />{t('spots.sheet.directions')}
              </a>
            </div>
          )}

          {/* José (23 sep 2026): ficha de Google vía Places UI Kit -- rating,
              fotos, horario y precio los pinta Google en vivo, nunca se
              guardan (términos EEA de Google Maps Platform). Va debajo de la
              nota; día y hora van fijos abajo, así la ficha no los aleja. */}
          {googlePlaceIdOf(spot) && (
            <GooglePlaceCard placeId={googlePlaceIdOf(spot)} variant="full" className="rounded-xl overflow-hidden" />
          )}

          {/* Notes */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('spots.sheet.myNote')}</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('spots.sheet.notePlaceholder')}
              className="w-full text-sm border border-border rounded-xl px-3 py-2.5 h-20 resize-none outline-none focus:border-primary bg-secondary"
            />
          </div>

        </div>

        {/* José (23 sep 2026): Día/Hora fijos encima de los botones (antes
            aquí iba el Like, que se ha quitado: no tenía uso en un viaje).
            La ficha de Google es larga y alejaba estos controles. */}
        <div className="flex-shrink-0 px-5 pt-3 pb-1 border-t border-border bg-card">
          {isStay ? (
            <div className="pb-2">
              <p className="text-xs text-muted-foreground bg-secondary/50 rounded-xl px-3 py-2.5">{t('spots.stayInfo')}</p>
              <ChangeStay spot={spot} tripId={tripId} currentUserEmail={currentUserEmail} canDelete={canDelete} onDone={onClose} />
            </div>
          ) : (
          <DayTimeAssign
            tripDayOptions={hasTripDays ? tripDayOptions : []}
            date={assignedDate} cityId={assignedCityId} time={assignedTime}
            onDayChange={({ date, cityId }) => { setAssignedDate(date); setAssignedCityId(cityId); }}
            onTimeChange={setAssignedTime}
          />
          )}
        </div>

        {/* Sticky footer buttons */}
        <div className="flex-shrink-0 flex gap-3 px-5 py-4 border-t border-border bg-card">
          <Button variant="outline" onClick={onClose} className="flex-1">{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 bg-primary hover:bg-primary/90 text-white">
            {saving ? t('spots.section.saving') : t('spots.sheet.saveChanges')}
          </Button>
        </div>
      </div>
    </div>
    {showDeleteConfirm && (
      <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
        <div className="bg-card w-full max-w-md rounded-t-2xl p-5 pb-8" onClick={e => e.stopPropagation()}>
          <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />
          <p className="font-semibold text-foreground text-sm mb-1">{t('spots.delete.title')}</p>
          <p className="text-xs text-muted-foreground mb-5">{t('spots.delete.body1')} <strong>{spot.title}</strong> {t('spots.delete.body2')}</p>
          <div className="flex gap-3">
            <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 rounded-full border border-border text-sm text-muted-foreground">{t('common.cancel')}</button>
            <button onClick={() => { onDelete(spot.id); setShowDeleteConfirm(false); onClose(); }}
              className="flex-1 py-3 rounded-full bg-primary text-white text-sm font-medium">{t('common.delete')}</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}