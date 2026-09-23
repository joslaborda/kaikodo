import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Check, Eye } from 'lucide-react';
import { Hotel, Train, Ticket, Shield, CirclePlus, Trash2, Search, X, MapPin, Loader2 } from 'lucide-react';
import { PlaneIcon, BusFront } from '@/lib/icons';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { getTripDays, tripDayOptionValue, parseTripDayOptionValue } from '@/lib/tripDays';
import { useToast } from '@/components/ui/use-toast';
import { checkUpload, convertHeicIfNeeded } from '@/lib/uploadLimits';
import { normalizeEmail, isSafeHttpUrl } from '@/lib/utils';
import { profileFor, displayNameFor } from '@/lib/docHolders';
import { uploadDocFile, resolveDocViewUrl } from '@/lib/privateFiles';
import { canUseGoogleToday, markGoogleUsed, getGoogleMapsApiKey } from '@/lib/googleMaps';

// ── Exported config (used by DocumentCard, Calendar) ─────────────────────────
export const CATEGORY_CONFIG = {
  flight:   { icon: PlaneIcon, label: 'Vuelo',    labelKey: 'documents.types.flight',    color: 'bg-blue-50 dark:bg-blue-950/30'   },
  train:    { icon: Train,     label: 'Tren',     labelKey: 'documents.types.train',     color: 'bg-green-50 dark:bg-green-950/30'  },
  // "bus" ya tenía icono y traducción listos en otros sitios (Documents.jsx:
  // DOC_ICONS/ICON_BG; InicioTab.jsx: DOC_ICON/TRANSPORT_TYPES) pero nunca
  // fue una categoría elegible aquí ni en el enum de Ticket.jsonc — así que
  // nadie podía llegar a crear un documento con category:'bus' desde la UI.
  bus:      { icon: BusFront,  label: 'Bus',      labelKey: 'documents.types.bus',       color: 'bg-amber-50 dark:bg-amber-950/30'  },
  hotel:    { icon: Hotel,     label: 'Hotel',    labelKey: 'documents.types.hotel',     color: 'bg-purple-50 dark:bg-purple-950/30' },
  event:    { icon: Ticket,    label: 'Evento',   labelKey: 'documents.types.ticket',    color: 'bg-orange-50 dark:bg-orange-950/30' },
  personal: { icon: Shield,    label: 'Seguro',   labelKey: 'documents.types.insurance', color: 'bg-amber-50 dark:bg-amber-950/30'  },
  other:    { icon: CirclePlus, label: 'Otro',    labelKey: 'documents.types.other',     color: 'bg-secondary' },
};

const CATEGORIES = [
  { key: 'flight',   Icon: PlaneIcon,  labelKey: 'documents.types.flight'   },
  { key: 'hotel',    Icon: Hotel,      labelKey: 'documents.types.hotel'    },
  { key: 'train',    Icon: Train,      labelKey: 'documents.types.train'    },
  { key: 'bus',      Icon: BusFront,   labelKey: 'documents.types.bus'      },
  { key: 'event',    Icon: Ticket,     labelKey: 'documents.types.ticket'   },
  { key: 'personal', Icon: Shield,     labelKey: 'documents.types.insurance' },
  { key: 'other',    Icon: CirclePlus, labelKey: 'documents.types.other'    },
];

// José (21 sep 2026): un formulario mucho más corto. Se quitaron origen,
// destino, compañía/nº de vuelo, hora de llegada y hora de la nota (los
// documentos que ya los tienen los conservan, solo dejan de pedirse). El
// único dato de lugar que importa es DÓNDE tienes que estar (el buscador, que
// da nombre y pin en el mapa). En un hotel ese mismo buscador es el hotel, y
// al guardar deja el alojamiento puesto en la ciudad (src/lib/hotelStay.js).
const SHOW_FIELDS = {
  flight:   ['name','location','date','time','notes'],
  train:    ['name','location','date','time','notes'],
  bus:      ['name','location','date','time','notes'],
  hotel:    ['name','location','date','end_date','notes'],
  event:    ['name','date','time','notes'],
  personal: ['name','date','end_date','notes'],
  other:    ['name','date','time','notes'],
};

// Quién VE el documento (independiente de quién lo USA). Por defecto todo el
// grupo en billetes/eventos/hotel (así cualquiera lo encuentra si hace
// falta), y solo quien lo usa en seguros y "otro" (pasaporte, etc.).
const AUDIENCE_OPTS = [
  { key: 'group',   tk: 'documents.form.vis.group',   dk: 'documents.form.vis.groupDesc'   },
  { key: 'holders', tk: 'documents.form.vis.holders', dk: 'documents.form.vis.holdersDesc' },
  { key: 'choose',  tk: 'documents.form.vis.choose',  dk: 'documents.form.vis.chooseDesc'  },
];
const defaultAudienceFor = (cat) => (cat === 'personal' || cat === 'other') ? 'holders' : 'group';

// Buscador de ubicacion (aeropuerto/estacion) para vuelos y trenes. Usa
// Google Places API (New, Text Search) cuando hay una API key configurada
// (VITE_GOOGLE_MAPS_API_KEY, ver src/lib/googleMaps.js) -- mejores
// resultados, fotos/nombres reales de aeropuertos y estaciones en vez del
// indice mas flojo de OpenStreetMap.
//
// Bug reportado por Jose (14 sep 2026): la key de Google ya esta activa
// desde hace tiempo, pero este buscador seguia teniendo un fallback a
// Nominatim/OSM (sin key, o si Google fallaba/agotaba el tope diario) que
// colaba resultados de OSM mezclados con los de Google. Restaurants.jsx ya
// se habia corregido para ser SOLO Google (ver searchPlaces ahi: sin key o
// con error, devuelve [] en vez de caer a Nominatim) -- aqui se replica
// exactamente el mismo patron para que la busqueda de aeropuertos/estaciones
// sea consistente con la de sitios/restaurantes.
async function searchLocationGooglePlaces(query, signal, apiKey) {
      if (!canUseGoogleToday('autocomplete')) throw new Error('daily-cap-reached');
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          headers: {
                  'Content-Type': 'application/json',
                  'X-Goog-Api-Key': apiKey,
          },
          body: JSON.stringify({ input: query, languageCode: 'es' }),
          signal,
    });
    if (!res.ok) return [];
      markGoogleUsed('autocomplete');
    const data = await res.json();
    return (data.suggestions || [])
      .map(s => s.placePrediction)
      .filter(Boolean)
      .slice(0, 6)
      .map(p => ({
              id: p.placeId,
              name: p.structuredFormat?.mainText?.text || p.text?.text || query,
              address: p.structuredFormat?.secondaryText?.text || '',
              lat: null, lng: null,
              _placeId: p.placeId,
      }));
}

async function fetchGooglePlaceDetails(placeId, apiKey, signal) {
      if (!canUseGoogleToday('placeDetails')) return null;
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
          headers: {
                  'X-Goog-Api-Key': apiKey,
                  // José (23 sep 2026): solo coordenadas (Essentials). Nombre y
                  // dirección de Google no se pueden guardar (términos EEA).
                  'X-Goog-FieldMask': 'id,location',
          },
          signal,
    });
    if (!res.ok) return null;
      markGoogleUsed('placeDetails');
    const p = await res.json();
    return { lat: p.location?.latitude, lng: p.location?.longitude };
}
async function searchLocation(query, signal) {
    const apiKey = await getGoogleMapsApiKey();
    if (!apiKey) { console.warn('[searchLocation] getGoogleMapsApiKey devolvió clave vacía — el backend devolvió 401/500 o el secreto no está inyectado'); return []; }
    try {
          return await searchLocationGooglePlaces(query, signal, apiKey);
    } catch (err) {
          if (err.name === 'AbortError') throw err;
          return [];
    }
}

const FIELD_LABELS = {
  name: 'Nombre', origin: 'Origen', destination: 'Destino',
  airline: 'Compañía / Nº vuelo', city: 'Ciudad',
  date: 'Fecha', end_date: 'Fecha fin', time: 'Hora salida', end_time: 'Hora llegada',
  notes: 'Notas', note_time: 'Hora de la nota',
};

const FIELD_PLACEHOLDERS = {
  name: 'Ej. Vuelo Madrid-Tokyo', origin: 'MAD', destination: 'NRT',
  airline: 'IB-6832', city: 'Tokyo',
  date: 'yyyy-mm-dd', end_date: 'yyyy-mm-dd', time: '08:45', end_time: '13:20',
  notes: 'Notas adicionales...', note_time: '14:00',
};

// Personal categories that should NOT restrict to trip dates
const PERSONAL_CATEGORIES = ['personal'];

export default function DocumentForm({
  initialData, cities, itineraryDays, members, profiles, tripCities, minDate, maxDate, onSave, onCancel, onDelete, saving, onView, currentUserEmail }) {
  const { t, i18n } = useTranslation();
  // "jue 24 sep" en vez de "2026-09-24" en el desplegable de días.
  const dayLabel = (iso) => { try { return format(parseISO(iso), 'EEE d MMM', { locale: i18n.language === 'en' ? undefined : es }); } catch { return iso; } };
  const { toast } = useToast();
  const [category, setCategory]     = useState(initialData?.category || 'flight');
  // José (21 sep 2026): "¿Para quién es?" es lo más importante del formulario
  // — decide a quién le sale el billete en SU Ruta y en Home, y en qué móvil
  // suena el aviso (used_by). Viene "Yo" marcado (lo normal es subir tu propio
  // billete) y siempre se ve en pantalla; subir el de otro es un gesto
  // deliberado. Quién puede VERLO es una segunda decisión, plegada debajo, con
  // un valor por defecto según el tipo. Quien usa un documento SIEMPRE tiene
  // acceso a él (además de esta lógica, lo garantiza el rls de Ticket.jsonc).
  const meEmail = normalizeEmail(currentUserEmail);
  const soloTrip = (members || []).length <= 1;
  const [usedByTouched, setUsedByTouched] = useState(false);
  const [usedBy, setUsedBy] = useState(() => {
    if (Array.isArray(initialData?.used_by) && initialData.used_by.length) {
      // '*' = todo el grupo (docHolders.js): en pantalla son todos los chips marcados.
      return initialData.used_by.includes('*') ? [...(members || [])] : initialData.used_by;
    }
    if (initialData?.id && initialData?.created_by) return [initialData.created_by];
    // Un documento ANTIGUO sin dueño conocido es "de todos" (docHolders.js): al editarlo
    // (subirle un archivo, cambiarle la hora) no debe pasar a ser solo tuyo.
    if (initialData?.id) return [...(members || [])];
    // Una reserva de hotel nueva es, casi siempre, de todo el grupo.
    if (!initialData?.id && initialData?.category === 'hotel' && (members || []).length) return [...members];
    const me = (members || []).find(e => normalizeEmail(e) === meEmail);
    return me ? [me] : (currentUserEmail ? [currentUserEmail] : []);
  });
  // null = el usuario aún no ha tocado "quién lo verá" → se deriva del tipo.
  const [audienceChoice, setAudienceChoice] = useState(() => {
    if (!initialData?.id) return null;
    const v = initialData.visibility;
    if (v === 'shared') return 'group';
    if (v === 'selected_users') {
      const holders = (Array.isArray(initialData.used_by) && initialData.used_by.length ? initialData.used_by : [initialData.created_by]).map(normalizeEmail);
      return (initialData.shared_with || []).some(e => !holders.includes(normalizeEmail(e))) ? 'choose' : 'holders';
    }
    return 'holders';
  });
  const [showAudience, setShowAudience] = useState(false);
  const audience = audienceChoice || defaultAudienceFor(category);
  // Cambiar el tipo a Hotel (sin haber tocado "para quién") lo deja en todos; y
  // volver a otro tipo, en yo.
  useEffect(() => {
    if (usedByTouched || initialData?.id || soloTrip) return;
    const me = (members || []).find(e => normalizeEmail(e) === meEmail);
    setUsedBy(category === 'hotel' ? [...(members || [])] : (me ? [me] : (currentUserEmail ? [currentUserEmail] : [])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);
  const [sharedWith, setSharedWith] = useState(initialData?.shared_with || []);
  const [fileUploading, setFileUploading] = useState(false);
  const [fields, setFields]         = useState({
    name:        initialData?.name        || '',
    origin:      initialData?.origin      || '',
    destination: initialData?.destination || '',
    airline:     initialData?.airline     || '',
    city:        initialData?.city        || '',
    date:        initialData?.date        || '',
    end_date:    initialData?.end_date    || '',
    time:        initialData?.time        || '',
    end_time:    initialData?.end_time    || '',
    note_time:   initialData?.note_time   || '',
    notes:       initialData?.notes       || '',
    file_url:    initialData?.file_url    || '',
    // file_uri: referencia a storage PRIVADO (ver handleFileUpload) — lo que
    // de verdad se guarda para archivos nuevos. file_url en documentos
    // nuevos solo sirve como vista previa temporal dentro de este formulario
    // (URL firmada, caduca) — nunca se persiste tal cual, ver handleSave.
    // Los documentos antiguos (subidos antes de este fix) solo tienen
    // file_url público y siguen funcionando igual que siempre.
    file_uri:    initialData?.file_uri    || '',
    city_id:     initialData?.city_id     || '',
    arrival_city_id: initialData?.arrival_city_id || '',
    location_name: initialData?.location_name || '',
    spot_id:       initialData?.spot_id       || '',
    location_lat:  initialData?.location_lat  || '',
    location_lng:  initialData?.location_lng  || '',
    location_place_id:  initialData?.location_place_id  || '',
    place_refreshed_at: initialData?.place_refreshed_at || '',
  });

  // Buscador de aeropuerto/estación (solo vuelo/tren, ver SHOW_FIELDS). El
  // texto de búsqueda es local hasta que se elige un resultado; lo elegido
  // vive en fields.location_* (lo que de verdad se guarda).
  const [locationQuery, setLocationQuery] = useState(initialData?.location_name || '');
  const [locationResults, setLocationResults] = useState([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const [resolvingLocationId, setResolvingLocationId] = useState(null);
  const locationTimer = useRef(null);
  const locationAbortRef = useRef(null);
  const resolveAbortRef = useRef(null);

  // Al editar un documento que ya tiene file_uri (subido a storage privado),
  // fields.file_url arranca vacío a propósito (no se persiste la firma
  // temporal, ver handleSave) — sin esto, la sección de "archivo adjunto"
  // de más abajo pensaría que el documento no tiene ningún archivo y
  // mostraría el botón de subir uno nuevo en vez de la vista previa del que
  // ya existe. Se pide una URL firmada fresca solo para previsualizar aquí.
  useEffect(() => {
    if (!initialData?.file_uri || fields.file_url) return;
    let cancelled = false;
    resolveDocViewUrl(initialData).then(url => {
      if (!cancelled && url) setField('file_url', url);
    });
    return () => { cancelled = true; };
     
  }, [initialData?.file_uri]);

  useEffect(() => {
    if (fields.location_lat) { setLocationResults([]); return; }
    if (!locationQuery.trim() || locationQuery.trim().length < 2) { setLocationResults([]); return; }
    clearTimeout(locationTimer.current);
    locationTimer.current = setTimeout(async () => {
      if (locationAbortRef.current) locationAbortRef.current.abort();
      locationAbortRef.current = new AbortController();
      setLocationSearching(true);
      try {
        setLocationResults(await searchLocation(locationQuery.trim(), locationAbortRef.current.signal));
      } catch (e) {
        if (e?.name !== 'AbortError') setLocationResults([]);
      } finally {
        setLocationSearching(false);
      }
    }, 700);
    return () => clearTimeout(locationTimer.current);
  }, [locationQuery, fields.location_lat]);

  // Build trip day options from tripCities prop
  const tripDayOptions = useMemo(() => {
    return getTripDays(tripCities || []);
  }, [tripCities]);

  const isPersonalCategory = PERSONAL_CATEGORIES.includes(category);
  const useTripDays = !isPersonalCategory && tripDayOptions.length > 0;

  // Documentos guardados antes de este fix no tienen city_id para su día — en
  // ese caso, para que el <select> siga mostrando algo seleccionado, cae al
  // primer option cuya fecha coincida (comportamiento anterior).
  const selectedDayOption = useMemo(() => {
    if (!fields.date) return null;
    if (fields.city_id) {
      const exact = tripDayOptions.find(d => d.date === fields.date && d.cityId === fields.city_id);
      if (exact) return exact;
    }
    return tripDayOptions.find(d => d.date === fields.date) || null;
  }, [tripDayOptions, fields.date, fields.city_id]);

  const showFields = SHOW_FIELDS[category] || SHOW_FIELDS.other;
  const hasField   = (f) => showFields.includes(f);

  const setField = (k, v) => setFields(prev => ({ ...prev, [k]: v }));

  const toggleUsedBy = (email) => {
    setUsedByTouched(true);
    setUsedBy(prev => prev.some(e => normalizeEmail(e) === normalizeEmail(email))
      ? prev.filter(e => normalizeEmail(e) !== normalizeEmail(email))
      : [...prev, email]);
  };

  const toggleAllUsers = () => {
    setUsedByTouched(true);
    const all = members || [];
    const allOn = all.length > 0 && all.every(m => usedBy.some(e => normalizeEmail(e) === normalizeEmail(m)));
    if (allOn) {
      const me = all.find(e => normalizeEmail(e) === meEmail);
      setUsedBy(me ? [me] : []);
    } else setUsedBy([...all]);
  };

  const canSave = !!fields.name.trim() && (soloTrip || usedBy.length > 0);

  const toggleSharedWith = (email) => {
    setSharedWith(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Este campo admite tickets/documentos (a menudo PDFs), no solo fotos —
    // por eso images:false, para no rechazar un PDF por "no ser imagen" y
    // usar el límite de tamaño de documentos (20 MB) en vez del de fotos.
    // Antes no había ningún límite aquí: un archivo enorme desde la galería
    // se quedaba subiendo sin que el usuario supiera por qué.
    const chk = checkUpload(file, { images: false });
    if (!chk.ok) {
      toast({ title: t('upload.tooLarge'), description: t('upload.maxMb', { mb: chk.maxMb }), variant: 'destructive' });
      return;
    }
    setFileUploading(true);
    try {
      // Este campo admite PDFs además de fotos (p.ej. una foto del pasaporte
      // tomada con el móvil), por eso también puede llegar un HEIC aquí.
      const uploadFile = await convertHeicIfNeeded(file);
      // UploadPrivateFile (no UploadFile): documentos como pasaporte/seguro
      // no deben quedar en storage público solo porque alguien conozca la
      // URL — ver src/lib/privateFiles.js para el hallazgo completo.
      // file_uri es lo permanente (se guarda en el Ticket); previewUrl es
      // una URL firmada de corta duración solo para la vista previa de aquí
      // abajo mientras se edita este formulario — nunca se persiste.
      const { file_uri, previewUrl } = await uploadDocFile(uploadFile);
      setField('file_uri', file_uri);
      setField('file_url', previewUrl);
    } catch (err) {
      // Antes un fallo aquí no dejaba ningún rastro: sin toast, el campo de
      // archivo simplemente se quedaba vacío como si nada se hubiera intentado.
      toast({ title: t('common.error'), description: t('common.tryAgain'), variant: 'destructive' });
    }
    setFileUploading(false);
  };

  const handleSave = () => {
    if (!fields.name.trim()) return;
    if (!soloTrip && usedBy.length === 0) {
      toast({ title: t('documents.form.requiredTitle'), description: t('documents.form.requiredDesc'), variant: 'destructive' });
      return;
    }
    // Quien va a usar un documento SIEMPRE puede verlo: se traduce la opción
    // elegida a visibility/shared_with metiendo siempre a los que lo usan.
    const othersUse = usedBy.filter(e => normalizeEmail(e) !== meEmail);
    let visibilityOut = 'personal';
    let sharedOut = [];
    if (!soloTrip) {
      if (audience === 'group') {
        visibilityOut = 'shared';
      } else {
        const extra = audience === 'choose' ? sharedWith : [];
        const all = [...new Set([...extra, ...othersUse])];
        if (all.length) { visibilityOut = 'selected_users'; sharedOut = all; }
      }
    }
    // Nada validaba que la fecha de fin (checkout de hotel, fin de seguro...)
    // fuera posterior a la de inicio — igual que el bug ya corregido en
    // NewTripModal.jsx (viaje con end_date < start_date). Aquí se podía
    // guardar p. ej. un hotel con checkout antes del checkin sin ningún aviso,
    // rompiendo el orden de las tarjetas en el calendario/Documents.jsx.
    if (fields.end_date && fields.date && fields.end_date < fields.date) {
      toast({ title: t('documents.form.endBeforeStart'), description: t('documents.form.endBeforeStartDesc'), variant: 'destructive' });
      return;
    }
    // location_lat/location_lng se inicializan como '' cuando no se ha
    // buscado un aeropuerto/estación (el campo es opcional). El backend
    // valida estos campos como número y rechaza la petición entera si
    // llega un string vacío ("Input should be a valid number"), lo que
    // bloqueaba silenciosamente la creación/edición de CUALQUIER documento
    // sin ubicación buscada. Los omitimos del payload si no son números.
    const { location_lat, location_lng, ...rest } = fields;
    const payload = { ...rest };
    if (!payload.spot_id) delete payload.spot_id;
    // Vacíos fuera: el backend valida formato y rechazaría '' (mismo caso que lat/lng).
    if (!payload.location_place_id) delete payload.location_place_id;
    if (!payload.place_refreshed_at) delete payload.place_refreshed_at;
    // El campo "Ciudad" (texto libre) se quitó del formulario -- era
    // redundante con la fecha, que ya lleva la ciudad del día embebida
    // (fields.city_id, elegido en el desplegable de FECHA). Se resuelve
    // aquí para que ticket.city (usado en DocumentCard.jsx/Documents.jsx
    // para mostrar la ciudad) siga rellenándose igual que antes.
    payload.city = (cities || []).find(c => c.id === fields.city_id)?.name || '';
    if (typeof location_lat === 'number' || (location_lat && !isNaN(Number(location_lat)))) {
      payload.location_lat = location_lat;
      payload.location_lng = location_lng;
    }
    // Si hay file_uri (archivo subido a storage privado tras este fix),
    // fields.file_url en este punto es solo la URL firmada de vista previa
    // de este formulario (caduca en 1h) — no tiene sentido persistirla como
    // si fuera permanente. Se guarda vacía; resolveDocViewUrl() siempre
    // pedirá una firma nueva a partir de file_uri para ver el documento.
    if (payload.file_uri) {
      payload.file_url = '';
    }
    onSave({
      ...payload,
      category,
      visibility: visibilityOut,
      // en minúsculas: el rls de Ticket compara used_by/shared_with con el email
      // de la sesión tal cual, y trip.members puede venir con otras mayúsculas.
      used_by: (() => {
        const list = (soloTrip ? (usedBy.length ? usedBy : (currentUserEmail ? [currentUserEmail] : [])) : usedBy).map(normalizeEmail);
        // Todos marcados (con más de una persona) → también '*': sigue valiendo para quien se una después.
        const everyone = !soloTrip && members.length > 1 && members.every(m => list.includes(normalizeEmail(m)));
        return everyone ? [...list, '*'] : list;
      })(),
      shared_with: sharedOut.map(normalizeEmail),
    });
  };

  return (
    <div className="flex flex-col gap-5">

      {/* Category tabs */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('documents.form.type')}</p>
        <div className="flex border-b border-border">
          {CATEGORIES.map(cat => (
            <button key={cat.key} onClick={() => setCategory(cat.key)}
              className={`flex-1 flex flex-col items-center py-2 pb-2.5 gap-0.5 border-b-2 transition-colors ${category === cat.key ? 'border-primary' : 'border-transparent'}`}>
              <cat.Icon size={16} className="flex-shrink-0" />
              <span className={`text-xs font-medium leading-none ${category === cat.key ? 'text-primary' : 'text-muted-foreground'}`}>{t(cat.labelKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Name — en una reserva de hotel el nombre ES el hotel elegido en el buscador
          de abajo: una vez elegido se oculta (antes salía dos veces: "Nombre" y
          "Hotel" con el mismo texto). Sin hotel elegido sigue pidiéndose a mano. */}
      {!(category === 'hotel' && typeof fields.location_lat === 'number') && (
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{category === 'hotel' ? t('documents.form.nameHotel') : t('documents.form.name')}</p>
        <Input value={fields.name} onChange={e => setField('name', e.target.value)}
          placeholder={category === 'hotel' ? t('documents.form.ph.hotel') : t('documents.form.ph.name')} className="h-10 text-sm" />
      </div>
      )}

      {/* Origin / Destination */}
      {(hasField('origin') || hasField('destination')) && (
        <div className="grid grid-cols-2 gap-3">
          {hasField('origin') && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('documents.form.fields.origin')}</p>
              <Input value={fields.origin} onChange={e => setField('origin', e.target.value)}
                placeholder={FIELD_PLACEHOLDERS.origin} className="h-10 text-sm" />
            </div>
          )}
          {hasField('destination') && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('documents.form.fields.destination')}</p>
              <Input value={fields.destination} onChange={e => setField('destination', e.target.value)}
                placeholder={FIELD_PLACEHOLDERS.destination} className="h-10 text-sm" />
            </div>
          )}
        </div>
      )}

      {/* Ubicación (aeropuerto/estación) — solo vuelo/tren. Da lat/lng reales
          al documento, que antes no tenía ninguna, para que pueda aparecer
          en el mini-mapa del día junto al hotel y los spots. */}
      {hasField('location') && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            {category === 'hotel' ? t('documents.form.fields.hotelPlace') : <>{t('documents.form.fields.location')} <span className="font-normal normal-case tracking-normal text-muted-foreground">{t('documents.form.optional')}</span></>}
          </p>
          <p className="text-xs text-muted-foreground/70 mb-1.5">{category === 'hotel' ? t('documents.form.hotelHint') : t('documents.form.locationHint')}</p>
          {fields.location_lat && fields.location_lng ? (
            <div className="flex items-center gap-2 bg-secondary/40 border border-border rounded-xl px-3 py-2.5">
              <MapPin className="w-4 h-4 text-primary shrink-0" />
              <span className="flex-1 text-sm text-foreground truncate">{fields.location_name}</span>
              <button type="button" onClick={() => { setFields(prev => ({ ...prev, location_name: '', location_lat: '', location_lng: '', location_place_id: '', place_refreshed_at: '' })); setLocationQuery(''); }}
                className="text-muted-foreground hover:text-red-500 transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2.5 focus-within:border-primary transition-colors">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input value={locationQuery} onChange={e => setLocationQuery(e.target.value)}
                  placeholder={category === 'hotel' ? t('documents.form.ph.hotel') : t('documents.form.ph.location')} className="flex-1 text-sm outline-none bg-transparent text-foreground min-w-0" />
                {locationSearching && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />}
              </div>
              {locationResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                  {locationResults.map(r => (
                    <button key={r.id} type="button" disabled={resolvingLocationId === r.id} onClick={async () => {
                                            if (r.lat && r.lng) {
                                                                      setFields(prev => ({ ...prev, location_name: r.name, location_lat: r.lat, location_lng: r.lng, ...(category === 'hotel' && !prev.name.trim() ? { name: r.name } : {}) }));
                                                                      setLocationQuery(r.name);
                                                                      setLocationResults([]);
                                                                      return;
                                            }
                                                                    const apiKey = await getGoogleMapsApiKey();
                                                                if (!r._placeId || !apiKey) return;
                                          if (resolveAbortRef.current) resolveAbortRef.current.abort();
                                          resolveAbortRef.current = new AbortController();
                                          setResolvingLocationId(r.id);
                                          try {
                                                                  const details = await fetchGooglePlaceDetails(r._placeId, apiKey, resolveAbortRef.current.signal);
                                                                  if (details?.lat && details?.lng) {
                                                                                            // José (23 sep 2026): el nombre que se guarda es lo que
                                                                                            // escribió el usuario (contenido suyo), no el de Google
                                                                                            // (términos EEA). Se guarda el place id para la ficha de
                                                                                            // Google y para refrescar coordenadas (máx. 30 días).
                                                                                            const ownName = locationQuery.trim() || r.name;
                                                                                            setFields(prev => ({ ...prev, location_name: ownName, location_lat: details.lat, location_lng: details.lng, location_place_id: r._placeId, place_refreshed_at: new Date().toISOString(), ...(category === 'hotel' && !prev.name.trim() ? { name: ownName } : {}) }));
                                                                                            setLocationQuery(ownName);
                                                                                            setLocationResults([]);
                                                                  } else {
                                                                                            toast({ title: t('common.error'), description: t('common.tryAgain'), variant: 'destructive' });
                                                                  }
                                          } catch (err) {
                                                                  if (err?.name !== 'AbortError') {
                                                                                            toast({ title: t('common.error'), description: t('common.tryAgain'), variant: 'destructive' });
                                                                  }
                                          } finally {
                                                                  setResolvingLocationId(null);
                                          }
                    }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-secondary/30 transition-colors border-b border-border last:border-0 disabled:opacity-60">
                                          <span className="flex flex-col items-start flex-1 min-w-0">
                                                                    <span className="text-sm font-medium text-foreground truncate w-full">{r.name}</span>
                                            {r.address && <span className="text-xs text-muted-foreground truncate w-full">{r.address}</span>}
                                          </span>
                 {resolvingLocationId === r.id && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />}
                    </button>
            ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Airline */}
      {hasField('airline') && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('documents.form.fields.airline')}</p>
          <Input value={fields.airline} onChange={e => setField('airline', e.target.value)}
            placeholder={FIELD_PLACEHOLDERS.airline} className="h-10 text-sm" />
        </div>
      )}

      {/* Date + Time in same row */}
      {(hasField('date') || hasField('time')) && (
        <div className={`grid gap-3 ${hasField('date') && hasField('time') ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {hasField('date') && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{category === 'hotel' ? t('documents.form.fields.checkIn') : t('documents.form.fields.date')}</p>
              {useTripDays ? (
                <select
                  value={selectedDayOption ? tripDayOptionValue(selectedDayOption) : ''}
                  onChange={e => {
                    const { date, cityId } = parseTripDayOptionValue(e.target.value);
                    setFields(prev => ({ ...prev, date, city_id: cityId || '' }));
                  }}
                  className="w-full h-10 border border-border rounded-md px-3 text-sm outline-none focus:border-primary bg-input"
                >
                  <option value="">{t('documents.form.selectDay')}</option>
                  {tripDayOptions.map(d => (
                    <option key={tripDayOptionValue(d)} value={tripDayOptionValue(d)}>{dayLabel(d.date)} · {d.city}</option>
                  ))}
                </select>
              ) : (
                <Input type="date" value={fields.date} onChange={e => setField('date', e.target.value)} className="h-10 text-sm" min={minDate || undefined} max={maxDate || undefined} />
              )}
            </div>
          )}
          {hasField('time') && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                {['flight', 'train', 'bus'].includes(category) ? t('documents.form.fields.time') : t('common.time')}
              </p>
              <Input type="time" value={fields.time} onChange={e => setField('time', e.target.value)} className="h-10 text-sm" />
            </div>
          )}
        </div>
      )}

      {/* Ciudad de llegada — solo vuelo/tren en viajes multi-ciudad. El campo
          arrival_city_id existía en el esquema y Cities.jsx ya lo usaba para
          decidir bajo qué ciudad mostrar un documento en un día de tránsito
          (origen vs. destino), pero ningún formulario lo escribía nunca —
          siempre quedaba null, así que ese documento solo aparecía bajo la
          ciudad de origen elegida arriba, nunca bajo la de llegada. Opcional:
          si no se elige, se mantiene el comportamiento anterior (solo city_id). */}
      {(category === 'flight' || category === 'train' || category === 'bus') && (cities || []).length > 1 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            {t('documents.form.fields.arrivalCity')} <span className="font-normal normal-case tracking-normal text-muted-foreground">{t('documents.form.optional')}</span>
          </p>
          <select
            value={fields.arrival_city_id}
            onChange={e => setField('arrival_city_id', e.target.value)}
            className="w-full h-10 border border-border rounded-md px-3 text-sm outline-none focus:border-primary bg-input"
          >
            <option value="">{t('documents.form.selectCity')}</option>
            {cities.filter(c => c.id !== fields.city_id).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* End time — hora de llegada para vuelos y trenes */}
      {hasField('end_time') && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            {t('documents.form.fields.endTime')} <span className="font-normal normal-case tracking-normal text-muted-foreground">{t('documents.form.optional')}</span>
          </p>
          <Input type="time" value={fields.end_time} onChange={e => setField('end_time', e.target.value)} className="h-10 text-sm" placeholder={FIELD_PLACEHOLDERS.end_time} />
        </div>
      )}

      {/* End date */}
      {hasField('end_date') && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{category === 'hotel' ? t('documents.form.fields.checkOut') : t('documents.form.fields.endDate')}</p>
          <Input type="date" value={fields.end_date} onChange={e => setField('end_date', e.target.value)} className="h-10 text-sm" min={minDate || undefined} max={maxDate || undefined} />
        </div>
      )}

      {/* Notes */}
      {hasField('notes') && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{t('documents.form.fields.notes')}</p>
          <Textarea value={fields.notes} onChange={e => setField('notes', e.target.value)}
            placeholder={t('documents.form.ph.notes')} className="text-sm resize-none" rows={2} />
        </div>
      )}

      {/* Note time — hora opcional para notas */}
      {hasField('note_time') && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            {t('documents.form.fields.noteTime')} <span className="font-normal normal-case tracking-normal text-muted-foreground">{t('documents.form.optional')}</span>
          </p>
          <Input type="time" value={fields.note_time} onChange={e => setField('note_time', e.target.value)} className="h-10 text-sm" />
        </div>
      )}

      {/* ¿Para quién es? — lo más importante del formulario. No sale en un
          viaje de una sola persona (no hay nadie más a quien asignárselo). */}
      {!soloTrip && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{t('documents.form.usedBy')}</p>
          <p className="text-xs text-muted-foreground/70 mb-2">{category === 'hotel' ? t('documents.form.usedByHintStay') : t('documents.form.usedByHint')}</p>
          <div className="flex flex-wrap gap-2">
            {members.map((email) => {
              const p = profileFor(email, profiles);
              const name = displayNameFor(email, profiles);
              const isMe = normalizeEmail(email) === meEmail;
              const on = usedBy.some(e => normalizeEmail(e) === normalizeEmail(email));
              return (
                <button key={email} type="button" onClick={() => toggleUsedBy(email)}
                  className={`inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border text-sm transition-colors ${
                    on ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 text-primary font-medium' : 'bg-card border-border text-foreground hover:bg-secondary/30'
                  }`}>
                  {p?.avatar_url
                    ? <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                    : <span className="w-6 h-6 rounded-full bg-orange-100 text-primary flex items-center justify-center text-xs font-semibold shrink-0">{(name?.[0] || '?').toUpperCase()}</span>}
                  <span className="truncate max-w-[9rem]">{isMe ? t('documents.form.me') : name}</span>
                  {on && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })}
            {members.length > 1 && (
              <button type="button" onClick={toggleAllUsers}
                className={`inline-flex items-center px-3 py-1.5 rounded-full border text-sm transition-colors ${
                  members.every(m => usedBy.some(e => normalizeEmail(e) === normalizeEmail(m)))
                    ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 text-primary font-medium'
                    : 'bg-card border-border text-foreground hover:bg-secondary/30'
                }`}>
                {t('documents.form.everyone')}
              </button>
            )}
          </div>
          {usedBy.length === 0 && <p className="text-xs text-red-500 mt-2">{t('documents.form.usedByRequired')}</p>}

          {/* Quién lo verá — plegado, con valor por defecto según el tipo */}
          <div className="mt-3">
            <button type="button" onClick={() => setShowAudience(s => !s)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span>{t('documents.form.seenBy', { who: t(AUDIENCE_OPTS.find(o => o.key === audience)?.tk).toLowerCase() })}</span>
              <span className="text-primary font-medium underline underline-offset-2">{showAudience ? t('common.close') : t('documents.form.change')}</span>
            </button>
            {showAudience && (
              <div className="mt-2 flex flex-col gap-2">
                {AUDIENCE_OPTS.map(opt => (
                  <button key={opt.key} type="button" onClick={() => setAudienceChoice(opt.key)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                      audience === opt.key ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200' : 'bg-card border-border hover:bg-secondary/30'
                    }`}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${audience === opt.key ? 'text-primary' : 'text-foreground'}`}>{t(opt.tk)}</p>
                      <p className={`text-xs mt-0.5 ${audience === opt.key ? 'text-primary/70' : 'text-muted-foreground'}`}>{t(opt.dk)}</p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${audience === opt.key ? 'bg-primary border-primary' : 'border-border'}`}>
                      {audience === opt.key && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </button>
                ))}
                {audience === 'choose' && (
                  <div className="flex flex-col gap-2">
                    {members.map((email) => {
                      const name = displayNameFor(email, profiles);
                      const isYou = normalizeEmail(email) === meEmail;
                      const isHolder = usedBy.some(e => normalizeEmail(e) === normalizeEmail(email));
                      const selected = sharedWith.includes(email) || isYou || isHolder;
                      return (
                        <button key={email} type="button"
                          onClick={() => !isYou && !isHolder && toggleSharedWith(email)}
                          disabled={isYou || isHolder}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                            selected ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200' : 'bg-card border-border hover:bg-secondary/20'
                          } ${(isYou || isHolder) ? 'cursor-default' : ''}`}>
                          <div className="flex-1 min-w-0 text-left">
                            <p className={`text-sm font-medium truncate ${selected ? 'text-primary' : 'text-foreground'}`}>{isYou ? t('documents.form.me') : name}</p>
                            {(isYou || isHolder) && <p className="text-xs text-muted-foreground">{isYou ? t('documents.form.alwaysIncluded') : t('documents.form.usesItSoSees')}</p>}
                          </div>
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${selected ? 'bg-primary' : 'bg-secondary border border-border'}`}>
                            {selected && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* File upload + preview */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('documents.form.file')}</p>
        {fields.file_url ? (
          <div className="border border-border rounded-xl overflow-hidden">
            {/* José (22 sep 2026) -- auditoría de seguridad: fields.file_url
                arranca con initialData.file_url tal cual para un documento
                legado (sin file_uri, ver el useEffect de arriba) -- texto
                libre editable por cualquier miembro del viaje, nunca pasaba
                por isSafeFileUrl()/resolveDocViewUrl() antes de llegar aquí.
                Mismo bug, mismo sitio que el ya cerrado en Cities.jsx (ver
                ese commit) -- aquí es donde de verdad nace el valor para
                los 3 onView(...) y el <img src> de abajo, así que se valida
                una sola vez, en el único punto de origen. */}
            <div className="flex items-center gap-3 px-4 py-3 bg-secondary/40 border-b border-border">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <button onClick={() => onView && isSafeHttpUrl(fields.file_url) && onView(fields.file_url)}
                className="text-sm text-foreground flex-1 truncate text-left hover:text-primary transition-colors">
                {t('documents.form.fileAttached')}
              </button>
              <button onClick={() => { setField('file_url', ''); setField('file_uri', ''); }}
                className="text-xs text-muted-foreground hover:text-red-500 transition-colors ml-2">
                {t('documents.form.removeFile')}
              </button>
            </div>
            {/* Inline preview for images — clickable to open viewer */}
            {isSafeHttpUrl(fields.file_url) && fields.file_url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i) && (
              <button onClick={() => onView && onView(fields.file_url)}
                className="w-full block cursor-pointer">
                <img src={fields.file_url} alt="preview"
                  className="w-full max-h-48 object-contain bg-secondary/20" />
              </button>
            )}
            {/* PDF preview — clickable hint */}
            {isSafeHttpUrl(fields.file_url) && fields.file_url.match(/\.pdf(\?|$)/i) && (
              <button onClick={() => onView && onView(fields.file_url)}
                className="w-full px-4 py-3 bg-orange-50 border-t border-orange-100 text-left hover:bg-orange-100 transition-colors">
                <p className="text-xs text-primary">{t('documents.form.pdfHint')}</p>
              </button>
            )}
          </div>
        ) : (
          <label className={`flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-5 cursor-pointer hover:border-primary/40 hover:bg-secondary/20 transition-all ${fileUploading ? 'opacity-50' : ''}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground mb-2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p className="text-sm font-medium text-muted-foreground">{fileUploading ? t('documents.form.uploading') : t('documents.form.tapToAttach')}</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">{t('documents.form.fileTypes')}</p>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" onChange={handleFileUpload} className="hidden" disabled={fileUploading} />
          </label>
        )}
      </div>

      {/* Actions */}
      {onDelete && (
        <button onClick={onDelete} className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 rounded-full border border-red-200 transition-colors">
          <Trash2 className="w-4 h-4" />{t('documents.form.deleteDoc')}
        </button>
      )}
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">{t('common.cancel')}</Button>
        <Button onClick={handleSave} disabled={!canSave || saving} className="flex-1 bg-primary hover:bg-primary/90 text-white">
          {saving ? t('documents.form.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}