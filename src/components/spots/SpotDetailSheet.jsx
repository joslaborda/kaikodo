import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { X, MapPin, Navigation, Star, Clock, Phone, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { TYPE_CONFIG, getMapsUrl } from './spotsHelpers';
import useLikeSimple from './useLikeSimple';
import InlineCommentsPopup from './InlineCommentsPopup';
import { useTranslation } from 'react-i18next';
import { getTripDays, tripDayOptionValue, parseTripDayOptionValue, sameCityName } from '@/lib/tripDays';
import { normalizeEmail } from '@/lib/utils';

export default
function SpotDetailSheet({ spot, open, onClose, onSave, onDelete, tripId, tripCities, userId, onNotify, currentUserEmail }) {
  const { t } = useTranslation();
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
  const [showComments, setShowComments] = useState(false);
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
  const { isLiked, count: likeCount, toggle: toggleLike } = useLikeSimple(spot?.id, userId, spot?.created_by_user_id);
  const isReal = spot?.id && !String(spot?.id || '').startsWith('seed_');
  const { data: comments = [] } = useQuery({
    queryKey: ['spotComments', spot?.id],
    queryFn: () => base44.entities.SpotComment.filter({ spot_id: spot.id }),
    enabled: !!spot?.id && isReal,
    staleTime: 30000,
  });

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

  if (!open || !spot) return null;

  const tc = TYPE_CONFIG[spot.type] || TYPE_CONFIG.custom;

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
      await base44.entities.Spot.update(spot.id, {
        notes,
        assigned_date: assignedDate || null,
        assigned_time: assignedTime || null,
        ...(timeChanged || dateChanged ? { day_order: null } : {}),
        ...cityIdUpdate,
      });
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      if (timeChanged && assignedTime) onNotify?.('spot_time', null, spot.title, { time: assignedTime });
      onClose();
    } catch (e) {
      toast({ title: t('common.saveError'), description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 pb-[80px]" onClick={onClose}>
      <div className="bg-card w-full max-w-lg rounded-t-3xl flex flex-col" style={{ maxHeight: 'calc(85vh - 80px)' }} onClick={e => e.stopPropagation()}>
        {/* Handle + Header — fixed */}
        <div className="flex-shrink-0">
          <div className="w-9 h-1 bg-border rounded-full mx-auto mt-4 mb-3" />
          <div className="flex items-start justify-between px-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${tc.color}`}>
                {tc.Icon && <tc.Icon size={14} />}
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">{spot.title}</p>
                <p className="text-xs text-muted-foreground">{t(tc.tk)}{spot.city_name ? ' · ' + spot.city_name : ''}</p>
              </div>
            </div>
            <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Dirección + Cómo llegar — antes este sheet no tenía ningún enlace
              a Maps, a diferencia de SpotCard.jsx (misma info, otra vista) y
              SpotDetailModal.jsx (Home/Ruta). Mismo getMapsUrl que ya usan. */}
          {(spot.address || (spot.lat && spot.lng)) && (
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

          {/* Place info from Google Places */}
          {(spot.photo_url || spot.rating != null || spot.opening_hours_json || spot.phone || spot.website) && (
            <div className="space-y-3">
              {spot.photo_url && (
                <img src={spot.photo_url} alt="" className="w-full h-40 rounded-xl object-cover" />
              )}
              {spot.rating != null && (
                <div className="flex items-center gap-1.5 text-sm">
                  <Star className="w-4 h-4 fill-current text-amber-400" />
                  <span className="font-medium text-foreground">{Number(spot.rating).toFixed(1)}</span>
                  {spot.user_rating_count != null && (
                    <span className="text-muted-foreground">({spot.user_rating_count} {t('spotDetail.placeInfo.ratings')})</span>
                  )}
                </div>
              )}
              {(() => {
                let hours = null;
                try { hours = spot.opening_hours_json ? JSON.parse(spot.opening_hours_json) : null; } catch { hours = null; }
                if (!hours) return null;
                const descs = hours.weekdayDescriptions;
                if (!Array.isArray(descs) || !descs.length) return null;
                return (
                  <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      {descs.map((d, i) => <p key={i}>{d}</p>)}
                    </div>
                  </div>
                );
              })()}
              {spot.phone && (
                <a href={`tel:${spot.phone}`} className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors">
                  <Phone className="w-3.5 h-3.5 shrink-0" />{spot.phone}
                </a>
              )}
              {spot.website && (
                <a href={spot.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors break-all">
                  <Globe className="w-3.5 h-3.5 shrink-0" />{spot.website}
                </a>
              )}
            </div>
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

          {/* Day + Hour assignment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('spots.sheet.day')}</p>
              {hasTripDays ? (
                <select
                  // value combina fecha+ciudad (tripDayOptionValue), no solo
                  // la fecha — con solo la fecha, un día de tránsito entre
                  // dos ciudades distintas (misma fecha, dos City) no se
                  // puede distinguir cuál eligió el usuario en el <select>.
                  value={assignedDate ? tripDayOptionValue({ date: assignedDate, cityId: assignedCityId }) : ''}
                  onChange={e => {
                    const { date, cityId } = parseTripDayOptionValue(e.target.value);
                    setAssignedDate(date);
                    setAssignedCityId(cityId);
                  }}
                  className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary"
                >
                  <option value="">{t('spots.sheet.unassigned')}</option>
                  {tripDayOptions.map(d => (
                    <option key={tripDayOptionValue(d)} value={tripDayOptionValue(d)}>{d.date} · {d.city}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="date"
                  value={assignedDate}
                  onChange={e => setAssignedDate(e.target.value)}
                  className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary"
                />
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('spots.sheet.time')}</p>
              <select
                value={assignedTime || ''}
                onChange={e => setAssignedTime(e.target.value)}
                className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary appearance-none"
              >
                <option value="">{t('spots.sheet.noTime')}</option>
                {Array.from({ length: 24 * 4 }, (_, i) => {
                  const h = Math.floor(i / 4).toString().padStart(2, '0');
                  const m = ((i % 4) * 15).toString().padStart(2, '0');
                  const val = `${h}:${m}`;
                  return <option key={val} value={val}>{val}</option>;
                })}
              </select>
            </div>
          </div>

          {/* Delete — solo quien lo creó, y con confirmación (antes borraba al instante) */}
          {canDelete && (
            <button onClick={() => setShowDeleteConfirm(true)}
              className="w-full text-xs text-red-500 hover:text-red-700 transition-colors py-2 text-center">
              {t('spots.sheet.deleteSpot')}
            </button>
          )}
        </div>

        {/* Like / Comentar row */}
        <div className="flex-shrink-0 flex border-t border-border">
          <button
            onClick={e => { e.stopPropagation(); toggleLike(); }}
            className="flex-1 flex items-center justify-center gap-2 py-3 hover:bg-secondary/30 transition-colors text-sm"
          >
            {isLiked
              ? <svg width="17" height="17" viewBox="0 0 24 24" fill="hsl(var(--primary))" stroke="hsl(var(--primary))" strokeWidth="0"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            }
            <span className={isLiked ? 'text-primary' : 'text-muted-foreground'}>{t('spots.sheet.like')}{likeCount > 0 ? ` · ${likeCount}` : ''}</span>
          </button>
          <div className="w-px bg-border" />
          {isReal && (
            <button
              onClick={e => { e.stopPropagation(); setShowComments(true); }}
              className="flex-1 flex items-center justify-center gap-2 py-3 hover:bg-secondary/30 transition-colors text-sm text-muted-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              {t('spots.sheet.comment')}{comments.length > 0 ? ` · ${comments.length}` : ''}
            </button>
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
    {showComments && isReal && <InlineCommentsPopup spot={spot} userId={userId} onClose={() => setShowComments(false)} />}
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