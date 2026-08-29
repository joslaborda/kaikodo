import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowRight, ChevronDown, ChevronUp, FileText, MapPin , CirclePlus, Thermometer, Route, GripVertical } from 'lucide-react';
import PDFViewer from '@/components/PDFViewer';
import SpotDetailModal from '@/components/trip/SpotDetailModal';
import ItemDetailSheet from './ItemDetailSheet';
import TodayRouteMap from './TodayRouteMap';
import { DOC_ICONS, SPOT_ICONS, SPOT_COLORS, WMO_ICON } from './constants';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/ui/use-toast';
import { cancelTicketReminder } from '@/lib/localReminders';
import { resolveDocViewUrl } from '@/lib/privateFiles';

export default function DayCard({ label, city, docs, spots, itineraryDays, tripId, defaultOpen, onReorderSpots, dateStr, onUpdateItemTime, hotelSpot, trip, currentUserEmail, profiles }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? undefined : es;
  // holidaysDB son ~120 KB: se cargan solo si hay ciudad y fecha.
  const [holidays, setHolidays] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!city?.country || !dateStr) { setHolidays([]); return; }
    import('@/lib/holidaysDB')
      .then(({ getHolidaysForDate }) => {
        if (!cancelled) setHolidays(getHolidaysForDate(city.country, dateStr, city.name) || []);
      })
      .catch(() => { if (!cancelled) setHolidays([]); });
    return () => { cancelled = true; };
  }, [city?.country, dateStr, city?.name]);
  const [open, setOpen]         = useState(defaultOpen);
  const [viewFile, setViewFile] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tick, setTick] = useState(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Antes esto era `= defaultOpen`, confundiendo "esta tarjeta arranca
  // expandida" con "esta tarjeta es hoy de verdad". DayCard se reutiliza
  // para la tarjeta del día siguiente (TomorrowTab la abre con
  // defaultOpen={true}), así que con la versión antigua el clima y el
  // aviso "sale en X minutos" de un vuelo de MAÑANA se calculaban como si
  // fuera hoy — un vuelo a las 09:00 de mañana visto hoy a las 08:30 podía
  // mostrar "sale en 30 minutos" con alarma roja.
  const isToday_ = dateStr === format(new Date(), 'yyyy-MM-dd');
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    if (!isToday_ || !city?.name) return;
    const key = 'mini_wx:' + city.name;
    const hit = sessionStorage.getItem(key);
    if (hit) { try { setWeather(JSON.parse(hit)); return; } catch {} }
    (async () => {
      try {
        const geo = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city.name) + '&count=1&language=es&format=json').then(r => r.json());
        const loc = geo.results?.[0];
        if (!loc) return;
        const wx = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,weathercode&timezone=' + encodeURIComponent(loc.timezone || 'auto') + '&forecast_days=1').then(r => r.json());
        const result = { temp: Math.round(wx.current.temperature_2m), code: wx.current.weathercode };
        setWeather(result);
        sessionStorage.setItem(key, JSON.stringify(result));
      } catch {}
    })();
  }, [isToday_, city?.name]);

  const hasItinerary = itineraryDays?.some(d => d.city_id === city?.id);

  // Mismo parseo que usa Cities.jsx para las notas de itinerario (raw JSON
  // string en ItineraryDay.content -> [{text,time,order}]). Se usa tanto al
  // construir el timeline como al borrar/reordenar.
  const parseNotesContent = (raw) => {
    if (!raw) return [];
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
    return raw.trim() ? [{ text: raw, time: '' }] : [];
  };

  const timeline = useMemo(() => {
    const docItems = docs.map(d => ({
      ...d, _kind: 'doc', time: d.time || null, type: d.category || d.type || 'other',
      _order: d.day_order ?? null,
    }));
    const dayNotes = (itineraryDays || [])
      .filter(d => d.city_id === city?.id && d.date === dateStr && d.content?.trim())
      .flatMap(d => parseNotesContent(d.content).filter(n => n.text?.trim()).map((n, i) => ({
        id: d.id + '-' + i, _kind: 'note', _dayId: d.id, _noteIdx: i,
        title: n.text.length > 50 ? n.text.slice(0, 50) + '…' : n.text,
        content: n.text, time: n.time || null, type: 'note',
        _order: n.order ?? null,
      })));
    const spotItems = spots.map(s => ({ ...s, _kind: 'spot', time: s.assigned_time || s.time || null, _order: s.day_order ?? null }));

    // Todo — docs, notas y spots — se puede arrastrar entre sí, tenga hora o
    // no. En cuanto arrastras cualquier cosa, esa posición se guarda de
    // verdad (day_order en Spot/Ticket, "order" dentro del objeto de nota) y
    // pasa a mandar sobre la hora para ordenar: así un doc, una nota o un
    // spot sin hora se puede colar justo entre otros dos que sí la tienen.
    // Lo que aún no se ha tocado nunca se intercala por hora si la tiene, o
    // va al final si no.
    const all = [...docItems, ...spotItems, ...dayNotes];
    const pinned = all.filter(i => i._order != null).sort((a, b) => a._order - b._order);
    const unpinnedTimed = all.filter(i => i._order == null && i.time).sort((a, b) => a.time.localeCompare(b.time));
    const unpinnedUntimed = all.filter(i => i._order == null && !i.time);

    const merged = [];
    let ui = 0;
    for (const item of pinned) {
      if (item.time) {
        while (ui < unpinnedTimed.length && unpinnedTimed[ui].time <= item.time) {
          merged.push(unpinnedTimed[ui]);
          ui++;
        }
      }
      merged.push(item);
    }
    while (ui < unpinnedTimed.length) { merged.push(unpinnedTimed[ui]); ui++; }

    return [...merged, ...unpinnedUntimed];
  }, [docs, spots, itineraryDays, city?.id, dateStr]);

  const hasContent = timeline.length > 0;

  // Documento destacado del día -- mismo criterio ya validado en InicioTab:
  // un doc (con archivo) "entra en ventana" 30min antes de su hora y sigue
  // activo hasta que pasa su margen de gracia (2h transporte, 1h el resto).
  // Si varios están en ventana a la vez, gana el de hora más reciente --
  // así un tren de hace rato no tapa la entrada de un museo que ya empezó.
  // Solo aplica a "Hoy" (isToday_) -- en "Mañana" nada está aún en ventana
  // de verdad, así que ahí todo se queda en fila pequeña, sin destacado.
  const featuredDoc = useMemo(() => {
    if (!isToday_) return null;
    const graceOf = (cat) => ['flight', 'train', 'bus'].includes(cat) ? 120 : 60;
    const toMin = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const candidates = timeline.filter(i => i._kind === 'doc' && i.time && (i.file_url || i.file_uri));
    const active = candidates.filter(c => {
      const start = toMin(c.time);
      return nowMin >= start - 30 && nowMin < start + graceOf(c.category || c.type);
    });
    if (active.length) return active.reduce((a, b) => toMin(b.time) > toMin(a.time) ? b : a);
    return candidates.filter(c => toMin(c.time) > nowMin).sort((a, b) => toMin(a.time) - toMin(b.time))[0] || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, isToday_, tick]);

  const [featuredViewLoading, setFeaturedViewLoading] = useState(false);
  const handleViewFeatured = async () => {
    if (!featuredDoc || featuredViewLoading) return;
    setFeaturedViewLoading(true);
    try {
      const url = await resolveDocViewUrl(featuredDoc);
      if (url) setViewFile(url);
    } finally {
      setFeaturedViewLoading(false);
    }
  };

  // El mini-mapa dibuja los spots y, ahora, también los documentos de
  // transporte con una ubicación guardada (aeropuerto/estación buscados en
  // DocumentForm) — en el mismo orden en que ya aparecen en el timeline de
  // abajo, así el número del pin coincide con la posición de la fila.
  const mapItems = timeline.filter(i =>
    i._kind === 'spot' ? (i.lat && i.lng) : (i._kind === 'doc' && i.location_lat && i.location_lng)
  );

  // Al soltar un arrastre, se reescribe TODO el orden del día de una vez —
  // spots y docs vía day_order, notas vía el campo "order" dentro de su
  // ItineraryDay.content — así el orden queda siempre denso y consistente
  // (0..N-1) sin importar de qué tipo sea cada item. El mapa de arriba, que
  // numera los spots por day_order, queda sincronizado sin tocar nada más.
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const touchDragId = useRef(null);

  // Se puede recolocar cualquier cosa donde quieras, EXCEPTO invertir el
  // orden entre dos items que ya tienen hora fija — un spot a las 14:00 no
  // puede terminar antes que uno a las 11:00. Si el drop deja esa inversión,
  // se rechaza entero (no se guarda nada, no cambia nada en pantalla) y se
  // avisa con un toast en vez de reordenar silenciosamente algo sin sentido.
  // Fix: antes esto escaneaba TODA la lista buscando cualquier inversion
    // cronologica entre items con hora, en vez de mirar solo el item que se
    // acababa de arrastrar. El propio diseno del timeline permite que un
    // item fijado (day_order) se quede fuera de orden por hora a proposito
    // (ver el comentario de mas arriba, "pasa a mandar sobre la hora"), asi
    // que en cuanto existia una inversion antigua en cualquier parte del dia
    // (p. ej. por haber cambiado la hora de un spot despues de fijarlo en
    // otra posicion), CUALQUIER arrastre en ese dia quedaba bloqueado con
    // "los horarios chocan" aunque los dos items que se estaban moviendo no
    // tuvieran nada que ver entre si. Ahora solo se comprueba si el item
    // movido queda cronologicamente antes del que tiene justo delante (con
    // hora) o despues del que tiene justo detras (con hora) -- el unico
    // choque que de verdad provoca este arrastre en concreto.
    const findTimeClash = (orderedItems, movedId) => {
          const idx = orderedItems.findIndex(i => (i.id || '') === movedId);
          if (idx === -1) return null;
          const moved = orderedItems[idx];
          if (!moved.time) return null;
          let prev = null;
          for (let k = idx - 1; k >= 0; k--) { if (orderedItems[k].time) { prev = orderedItems[k]; break; } }
          let next = null;
          for (let k = idx + 1; k < orderedItems.length; k++) { if (orderedItems[k].time) { next = orderedItems[k]; break; } }
          if (prev && prev.time > moved.time) return [prev, moved];
          if (next && next.time < moved.time) return [moved, next];
          return null;
    };

  const reorderTimeline = async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const seq = timeline;
    const from = seq.findIndex(i => (i.id || '') === fromId);
    const to = seq.findIndex(i => (i.id || '') === toId);
    if (from === -1 || to === -1) return;
    const reordered = [...seq];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

        const clash = findTimeClash(reordered, moved.id);
    if (clash) {
      const [a, b] = clash;
      toast({
        title: t('common.timeClashTitle'),
        description: t('common.timeClashBody', {
          a: a.title || a.name || t('home.dayCard.noTitle'), aTime: a.time,
          b: b.title || b.name || t('home.dayCard.noTitle'), bTime: b.time,
        }),
        variant: 'destructive',
      });
      return;
    }

    const spotUpdates = [];
    const docUpdates = [];
    const notesByDay = {};

    reordered.forEach((item, idx) => {
      if (item._kind === 'spot') {
        if (item.day_order !== idx) spotUpdates.push(base44.entities.Spot.update(item.id, { day_order: idx }));
      } else if (item._kind === 'doc') {
        if (item.day_order !== idx) docUpdates.push(base44.entities.Ticket.update(item.id, { day_order: idx }));
      } else if (item._kind === 'note') {
        if (!notesByDay[item._dayId]) {
          const day = (itineraryDays || []).find(d => d.id === item._dayId);
          notesByDay[item._dayId] = parseNotesContent(day?.content);
        }
        if (notesByDay[item._dayId][item._noteIdx]) {
          notesByDay[item._dayId][item._noteIdx] = { ...notesByDay[item._dayId][item._noteIdx], order: idx };
        }
      }
    });

    try {
      await Promise.all([
        ...spotUpdates,
        ...docUpdates,
        ...Object.entries(notesByDay).map(([dayId, content]) =>
          base44.entities.ItineraryDay.update(dayId, { content: JSON.stringify(content) })
        ),
      ]);
      if (spotUpdates.length) queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      if (docUpdates.length) queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      if (Object.keys(notesByDay).length) queryClient.invalidateQueries({ queryKey: ['itineraryDays', tripId] });
    } catch {
      // Best-effort: reordenar no es destructivo, si falla el próximo
      // refetch trae de vuelta el orden anterior sin bloquear la UI.
    }
  };

  const handleTouchStart = (item) => (e) => {
    touchDragId.current = item.id;
    setDraggingId(item.id);
  };
  const handleTouchMove = (e) => {
    if (!touchDragId.current) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const row = el?.closest?.('[data-item-id]');
    setDragOverId(row?.dataset?.itemId || null);
  };
  const handleTouchEnd = async () => {
    if (touchDragId.current && dragOverId) await reorderTimeline(touchDragId.current, dragOverId);
    touchDragId.current = null;
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleSaveTime = async (item, time) => {
    if (onUpdateItemTime) await onUpdateItemTime(item, time);
    setSelected(prev => prev ? { ...prev, time } : null);
  };

  // Antes SpotDetailModal se abría aquí sin onRemove, así que "Quitar del día"
  // no aparecía (a diferencia de Cities.jsx/Ruta, que sí lo pasa) — mismo modal,
  // dos comportamientos distintos. Se desasigna el spot del día, no se borra
  // la entidad (eso solo pasa desde Spots/Restaurants.jsx, que es la vista de
  // gestión de spots).
  const handleRemoveSpot = async (spot) => {
    try {
      await base44.entities.Spot.update(spot.id, { assigned_date: null, day_order: null, assigned_time: null });
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
      setSelected(null);
    } catch (e) {
      // Antes sin try/catch: un fallo dejaba la ficha abierta sin decir nada.
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    }
  };

  // Antes ItemDetailSheet no podía borrar nada — ni documento ni nota — a
  // diferencia de Documents.jsx (doc) y Cities.jsx/Ruta (nota). Las notas no
  // son su propia entidad: viven serializadas dentro de ItineraryDay.content,
  // así que borrar una nota es reescribir esa lista sin ella.
  const handleDeleteItem = async (item) => {
    try {
      if (item._kind === 'doc') {
        await base44.entities.Ticket.delete(item.id);
        cancelTicketReminder(item.id);
        queryClient.invalidateQueries({ queryKey: ['allDocs', tripId] });
      } else if (item._kind === 'note') {
        const lastDash = item.id.lastIndexOf('-');
        const dayId = item.id.slice(0, lastDash);
        const idx = parseInt(item.id.slice(lastDash + 1), 10);
        const day = (itineraryDays || []).find(d => d.id === dayId);
        if (day) {
          const clean = parseNotesContent(day.content).filter(n => n.text?.trim());
          clean.splice(idx, 1);
          await base44.entities.ItineraryDay.update(dayId, { content: JSON.stringify(clean) });
          queryClient.invalidateQueries({ queryKey: ['itineraryDays', tripId] });
        }
      }
      setSelected(null);
    } catch (e) {
      toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' });
    }
  };

  return (
    <div className={`bg-card rounded-2xl border overflow-hidden ${isToday_ ? 'border-orange-200' : 'border-border'}`}>
      <button onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${isToday_ ? 'bg-orange-50 hover:bg-orange-100/50' : 'bg-secondary/30 hover:bg-secondary/50'}`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xs font-medium uppercase tracking-wider shrink-0 ${isToday_ ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
          <span className="text-sm font-medium text-foreground truncate">{city?.name}</span>
          {dateStr && <span className="text-xs text-muted-foreground shrink-0">{format(parseISO(dateStr), 'dd MMM', { locale: dateLocale })}</span>}
        </div>
        {isToday_ && weather && (
          <span className="inline-flex items-center gap-1 shrink-0 mr-1">{(() => { const I = WMO_ICON[weather.code] || Thermometer; return <I className="w-3.5 h-3.5 text-muted-foreground" />; })()}<span className="text-xs font-medium text-foreground">{weather.temp}°</span></span>
        )}
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {(() => {
        if (!holidays.length) return null;
        return (
          <div className="border-t border-amber-200/60 dark:border-amber-900/30 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-2 flex flex-col gap-1">
            {holidays.map((h, i) => (
              <p key={i} className="text-xs text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span className="font-medium">{h.name}</span>
                {h.note && <span className="text-amber-600 dark:text-amber-500 opacity-80">· {h.note}</span>}
              </p>
            ))}
          </div>
        );
      })()}

      {featuredDoc && (() => {
        const FeaturedIcon = DOC_ICONS[featuredDoc.category] || DOC_ICONS[featuredDoc.type] || DOC_ICONS.other;
        return (
          <div className="border-t border-border px-4 py-3">
            <div className="bg-orange-50/60 dark:bg-orange-950/20 rounded-2xl border border-orange-200/60 dark:border-orange-900/30 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-background flex items-center justify-center shrink-0">
                  {FeaturedIcon && <FeaturedIcon size={18} className="text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{featuredDoc.title || featuredDoc.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{featuredDoc.time}</p>
                </div>
                <p className="text-base font-semibold text-foreground shrink-0">{featuredDoc.time}</p>
              </div>
              <div className="px-4 pb-3">
                <button type="button" onClick={handleViewFeatured} disabled={featuredViewLoading}
                  className="block w-full py-2.5 bg-primary text-white text-sm font-medium text-center rounded-full disabled:opacity-60">
                  {t('home.inicio.viewTicket')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {open && (
        <div>
          {((hotelSpot?.lat && hotelSpot?.lng) || mapItems.length > 0 || !hotelSpot) ? (
            <div className="border-t border-border px-4 pt-3 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Route className="w-3.5 h-3.5 text-primary" />{t('home.dayCard.todayRoute')}
                </span>
                {hotelSpot ? (
                  <span className="text-xs text-muted-foreground">{t('home.dayCard.hotelPlusStops', { count: mapItems.length })}</span>
                ) : (
                  <Link
                    to={createPageUrl('Restaurants') + '?trip_id=' + tripId + '&open_create=hotel&city_id=' + (city?.id || '')}
                    className="text-xs text-primary font-medium hover:text-primary/80 transition-colors"
                  >
                    {t('home.dayCard.addHotel')}
                  </Link>
                )}
              </div>
              <TodayRouteMap hotelSpot={hotelSpot} items={mapItems} onSelectSpot={setSelected} />
            </div>
          ) : null}
          {hasContent ? (
            timeline.filter(item => item.id !== featuredDoc?.id).map((item, idx, arr) => {
              const isDoc   = item._kind === 'doc';
              const isNote  = item._kind === 'note';
              const DocIcon = isDoc ? (DOC_ICONS[item.category] || DOC_ICONS[item.type] || DOC_ICONS.other) : null;
              const SpotIcon = (!isDoc && !isNote) ? (SPOT_ICONS[item.type] || CirclePlus) : null;
              const spotColor = (!isDoc && !isNote) ? (SPOT_COLORS[item.type] || SPOT_COLORS.custom) : '';
              const isLast  = idx === arr.length - 1;
              const hasTime = !!item.time;
              // Un doc con hora ya se apaga en la fila una vez pasa su propio
              // margen de gracia (mismo criterio que el destacado de arriba)
              // -- deja de competir visualmente con lo que sí toca ahora.
              const isPastDoc = isToday_ && isDoc && item.time && (() => {
                const [h, m] = item.time.split(':').map(Number);
                const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
                const grace = ['flight', 'train', 'bus'].includes(item.category || item.type) ? 120 : 60;
                return nowMin >= (h * 60 + m) + grace;
              })();
              // Todo — docs, notas y spots — se puede arrastrar entre sí,
              // tenga hora o no: así cualquiera se puede colar entre otros
              // dos que sí la tienen.
              const isDragging = draggingId === item.id;
              const isDragOver  = dragOverId === item.id && draggingId !== item.id;

              return (
                <button key={item.id || idx} onClick={async () => {
                    if (isDoc && (item.file_url || item.file_uri)) {
                      const url = await resolveDocViewUrl(item);
                      if (url) { setViewFile(url); return; }
                    }
                    setSelected(item);
                  }}
                  data-item-id={item.id}
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); setDraggingId(item.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverId(item.id); }}
                  onDrop={(e) => { e.preventDefault(); reorderTimeline(draggingId, item.id); setDraggingId(null); setDragOverId(null); }}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                  onTouchStart={handleTouchStart(item)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  className={`w-full flex items-center gap-2 px-4 py-3 border-t border-border transition-colors text-left ${
                    isDragging ? 'opacity-40' : isPastDoc ? 'opacity-50' : ''
                  } ${
                    isDragOver ? 'bg-primary/5 border-t-primary/40' : ''
                  } ${
                    isToday_ && isDoc && item.time && ['flight','train','bus'].includes(item.category || item.type) && (() => {
                      const now = new Date();
                      const [h, m] = item.time.split(':').map(Number);
                      const dep = new Date(now); dep.setHours(h, m, 0, 0);
                      const diffMin = Math.round((dep - now) / 60000);
                      if (diffMin <= 0 || diffMin > 240) return false;
                      return diffMin <= 60 ? 'bg-red-50 hover:bg-red-50' : 'bg-orange-50/60 hover:bg-orange-50/80';
                    })() || (isDragOver ? '' : 'hover:bg-secondary/20')
                  }`}>
                  <div className="w-9 shrink-0 flex flex-col items-center self-stretch justify-start pt-0.5">
                    {hasTime
                      ? <span className="text-label2 font-medium text-primary leading-none whitespace-nowrap">{item.time}</span>
                      : <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 cursor-grab active:cursor-grabbing mt-0.5" />}
                    {!isLast && <div className="w-px flex-1 bg-border/60 mt-1.5" />}
                  </div>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isDoc ? 'bg-orange-50 dark:bg-orange-950/30' : isNote ? 'bg-secondary' : spotColor || 'bg-secondary'}`}>
                    {isDoc && DocIcon ? <DocIcon size={16} stroke="currentColor" className="text-primary" />
                      : isNote ? <FileText size={16} className="text-muted-foreground" />
                      : SpotIcon ? <SpotIcon size={16} /> : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.title || item.name || t('home.dayCard.noTitle')}</p>
                    {!isDoc && !isNote && item.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.notes}</p>}
                    {isNote && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.content}</p>}
                    {isDoc && !hasTime && <p className="text-xs text-muted-foreground mt-0.5">{t('home.dayCard.noTime')}</p>}
                    {isToday_ && isDoc && item.time && ['flight','train','bus'].includes(item.category || item.type) && (() => {
                      const now = new Date();
                      const [h, m] = item.time.split(':').map(Number);
                      const dep = new Date(now); dep.setHours(h, m, 0, 0);
                      const diffMin = Math.round((dep - now) / 60000);
                      if (diffMin <= 0 || diffMin > 240) return null;
                      const hrs = Math.floor(diffMin / 60);
                      const mins = diffMin % 60;
                      const lbl = hrs > 0
                        ? (mins > 0 ? t('home.dayCard.departsInHoursMinutes', { hours: hrs, minutes: mins }) : t('home.dayCard.departsInHours', { hours: hrs }))
                        : t('home.dayCard.departsInMinutes', { count: diffMin });
                      return <p className="text-xs font-semibold mt-0.5" style={{color: diffMin <= 60 ? '#dc2626' : 'hsl(var(--primary))'}}>{lbl}</p>;
                    })()}
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              );
            })
          ) : (
            <Link to={createPageUrl('Restaurants') + '?trip_id=' + tripId}
              className="flex items-center gap-3 px-4 py-4 border-t border-border hover:bg-secondary/30 transition-colors">
              <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0"><MapPin size={16} className="text-muted-foreground" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{t('home.dayCard.exploreSpotsIn', { city: city?.name })}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t('home.dayCard.addPlaces')}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </Link>
          )}
          {/* Antes iba a CityDetail (página vieja, sin usar en ningún otro
              flujo) — ahora abre Ruta con esta ciudad concreta desplegada
              (ver forceOpenCityId en Cities.jsx). Si la ciudad se repite en
              el viaje, city.id identifica justo esta estancia, no cualquiera
              con el mismo nombre. */}
          <Link to={createPageUrl('Cities') + '?trip_id=' + tripId + '&city_id=' + (city?.id || '')}
            className="flex items-center justify-between px-4 py-3 border-t border-border hover:bg-secondary/20 transition-colors">
            <span className="text-xs font-medium text-primary">{hasItinerary ? t('home.dayCard.viewItineraryOf', { city: city?.name }) : t('home.dayCard.openCity', { city: city?.name })}</span>
            <ArrowRight className="w-3.5 h-3.5 text-primary" />
          </Link>
        </div>
      )}

      {viewFile && <PDFViewer fileUrl={viewFile} onClose={() => setViewFile(null)} />}
      {selected && selected._kind !== 'spot' && (
        <ItemDetailSheet item={selected} onClose={() => setSelected(null)} onSaveTime={handleSaveTime} onOpenPdf={(url) => setViewFile(url)} onDelete={handleDeleteItem} />
      )}
      {selected && selected._kind === 'spot' && (
        <SpotDetailModal spot={selected} open={true} onClose={() => setSelected(null)} onRemove={handleRemoveSpot} queryClient={queryClient} tripId={tripId} trip={trip} currentUserEmail={currentUserEmail} profiles={profiles} />
      )}
    </div>
  );
}
