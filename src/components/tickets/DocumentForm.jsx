import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Camera, FileUp, Pencil, Calendar, Navigation, StickyNote } from 'lucide-react';
import { FormSection, FormCard, FormRow, DatePill, TimePill, OptionPill, Chip, PersonAvatar } from '@/components/form/FormPills';
import { Hotel, Train, Ticket, Shield, CirclePlus, Trash2, X, MapPin, Loader2 } from 'lucide-react';
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
    // José (24 sep 2026): en un viaje donde aún estás solo (p. ej. acabas de
    // crearlo e invitar a gente que todavía no ha aceptado) antes TODO se
    // guardaba como 'personal', sin preguntar: el vuelo o el hotel que
    // subías quedaban ocultos para siempre a quien se uniera después. Ahora
    // se respeta "Lo verá" también estando solo (por defecto, todo el grupo
    // en billetes/hotel/eventos).
    if (soloTrip) {
      if (audience === 'group') visibilityOut = 'shared';
    } else {
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
        // Hotel creado estando solo y visible para el grupo: es de todos,
        // también de quien se una después ('*').
        if (soloTrip && category === 'hotel' && audience === 'group') return [...list, '*'];
        // Todos marcados (con más de una persona) → también '*': sigue valiendo para quien se una después.
        const everyone = !soloTrip && members.length > 1 && members.every(m => list.includes(normalizeEmail(m)));
        return everyone ? [...list, '*'] : list;
      })(),
      shared_with: sharedOut.map(normalizeEmail),
    });
  };

  // Elegir un resultado del buscador de lugar (aeropuerto/estación/hotel).
  const pickLocationResult = async (r) => {
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
                    };

  // ── "¿Quién lo ve?" como chips (José, 24 sep 2026: el selector de tres
  // opciones desentonaba al lado de "¿Para quién es?"). Mismo modelo que
  // antes (audience + sharedWith → visibility/shared_with en handleSave):
  //  - "Todo el grupo" = shared (también quien se una después).
  //  - Quien lo usa y tú estáis siempre marcados (bloqueados).
  //  - Marcar/desmarcar a otra persona = elegir a mano.
  const isHolder = (email) => usedBy.some(e => normalizeEmail(e) === normalizeEmail(email));
  const isLockedViewer = (email) => normalizeEmail(email) === meEmail || isHolder(email);
  const seesIt = (email) => audience === 'group' || isLockedViewer(email) || sharedWith.some(e => normalizeEmail(e) === normalizeEmail(email));
  const tapGroupViewer = () => {
    if (audience === 'group') { setAudienceChoice('holders'); setSharedWith([]); }
    else setAudienceChoice('group');
  };
  const tapPersonViewer = (email) => {
    if (isLockedViewer(email)) return;
    const n = normalizeEmail(email);
    if (audience === 'group') {
      setSharedWith((members || []).filter(m => !isLockedViewer(m) && normalizeEmail(m) !== n));
      setAudienceChoice('choose');
      return;
    }
    const next = sharedWith.some(e => normalizeEmail(e) === n) ? sharedWith.filter(e => normalizeEmail(e) !== n) : [...sharedWith, email];
    setSharedWith(next);
    setAudienceChoice(next.length ? 'choose' : 'holders');
  };

  const transport = ['flight', 'train', 'bus'].includes(category);
  const dayOptions = tripDayOptions.map(d => ({ value: tripDayOptionValue(d), label: dayLabel(d.date), sublabel: d.city }));
  const nameHidden = category === 'hotel' && typeof fields.location_lat === 'number';

  return (
    <div className="flex flex-col gap-5">

      {/* 1. Archivo — lo primero: es lo que haces casi siempre */}
      <div>
        {fields.file_url ? (
          <div className="border border-border rounded-2xl overflow-hidden">
            {/* José (22 sep 2026) -- auditoría de seguridad: fields.file_url
                se valida con isSafeHttpUrl() antes de abrirlo o pintarlo
                (documentos legados con URL en texto libre). */}
            <div className="flex items-center gap-3 px-4 py-3 bg-secondary/40">
              <FileText className="w-[18px] h-[18px] text-primary shrink-0" />
              <button type="button" onClick={() => onView && isSafeHttpUrl(fields.file_url) && onView(fields.file_url)}
                className="text-sm text-foreground flex-1 truncate text-left hover:text-primary transition-colors">
                {t('documents.form.fileAttached')}
              </button>
              <button type="button" onClick={() => { setField('file_url', ''); setField('file_uri', ''); }}
                className="text-xs text-muted-foreground hover:text-red-500 transition-colors ml-2">
                {t('documents.form.removeFile')}
              </button>
            </div>
            {isSafeHttpUrl(fields.file_url) && fields.file_url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i) && (
              <button type="button" onClick={() => onView && onView(fields.file_url)} className="w-full block cursor-pointer border-t border-border">
                <img src={fields.file_url} alt="preview" className="w-full max-h-48 object-contain bg-secondary/20" />
              </button>
            )}
            {isSafeHttpUrl(fields.file_url) && fields.file_url.match(/\.pdf(\?|$)/i) && (
              <button type="button" onClick={() => onView && onView(fields.file_url)}
                className="w-full px-4 py-3 bg-orange-50 dark:bg-orange-950/20 border-t border-orange-100 dark:border-orange-900/40 text-left hover:bg-orange-100 transition-colors">
                <p className="text-xs text-primary">{t('documents.form.pdfHint')}</p>
              </button>
            )}
          </div>
        ) : (
          <div className={`flex gap-2 p-3 rounded-2xl border-[1.5px] border-dashed border-orange-300 dark:border-orange-900/60 bg-orange-50/50 dark:bg-orange-950/10 ${fileUploading ? 'opacity-60 pointer-events-none' : ''}`}>
            {fileUploading ? (
              <div className="flex-1 flex items-center justify-center gap-2 py-4 text-sm text-primary font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />{t('documents.form.uploading')}
              </div>
            ) : (
              <>
                <label className="flex-1 flex flex-col items-center gap-1 py-3 rounded-xl bg-card border border-orange-200 dark:border-orange-900/50 text-primary text-xs font-semibold cursor-pointer text-center">
                  <Camera className="w-5 h-5" />{t('documents.form.takePhoto')}
                  <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} className="hidden" />
                </label>
                <label className="flex-1 flex flex-col items-center gap-1 py-3 rounded-xl bg-card border border-orange-200 dark:border-orange-900/50 text-primary text-xs font-semibold cursor-pointer text-center">
                  <FileUp className="w-5 h-5" />{t('documents.form.uploadFile')}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic" onChange={handleFileUpload} className="hidden" />
                </label>
              </>
            )}
          </div>
        )}
      </div>

      {/* 2. Tipo — pastillas con icono, como los filtros de Spots */}
      <FormSection title={t('documents.form.type')}>
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
          {CATEGORIES.map(cat => {
            const on = category === cat.key;
            return (
              <button key={cat.key} type="button" onClick={() => setCategory(cat.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors ${
                  on ? 'bg-primary text-white border-primary' : 'bg-card text-foreground border-border hover:bg-secondary/40'}`}>
                <cat.Icon size={14} className="flex-shrink-0" />{t(cat.labelKey)}
              </button>
            );
          })}
        </div>
      </FormSection>

      {/* 3. Detalles — una sola tarjeta, sin etiquetas en mayúsculas */}
      <FormSection title={t('documents.form.details')}>
        <FormCard>
          {!nameHidden && (
            <FormRow icon={Pencil}>
              <input value={fields.name} onChange={e => setField('name', e.target.value)}
                placeholder={category === 'hotel' ? t('documents.form.ph.hotel') : t('documents.form.ph.name')}
                autoCapitalize="sentences" autoCorrect="on" spellCheck
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />
            </FormRow>
          )}

          {hasField('location') && (
            <FormRow icon={MapPin} align="start">
              {fields.location_lat && fields.location_lng ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-foreground truncate">{fields.location_name}</span>
                  <button type="button" aria-label={t('forms.clear')}
                    onClick={() => { setFields(prev => ({ ...prev, location_name: '', location_lat: '', location_lng: '', location_place_id: '', place_refreshed_at: '' })); setLocationQuery(''); }}
                    className="w-7 h-7 -m-1 rounded-full flex items-center justify-center text-muted-foreground hover:text-red-500 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <input value={locationQuery} onChange={e => setLocationQuery(e.target.value)}
                      placeholder={category === 'hotel' ? t('documents.form.ph.hotelSearch') : t('documents.form.ph.locationOptional')}
                      autoComplete="off" autoCorrect="off"
                      className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />
                    {locationSearching && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />}
                  </div>
                  {locationResults.length > 0 && (
                    <div className="mt-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                      {locationResults.map(r => (
                        <button key={r.id} type="button" disabled={resolvingLocationId === r.id} onClick={() => pickLocationResult(r)}
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
            </FormRow>
          )}

          {(hasField('date') || hasField('time')) && (
            <FormRow icon={Calendar} align="start">
              <div className="flex flex-wrap items-center gap-2">
                {hasField('date') && (useTripDays ? (
                  <OptionPill
                    value={selectedDayOption ? tripDayOptionValue(selectedDayOption) : ''}
                    onChange={v => {
                      if (!v) { setFields(prev => ({ ...prev, date: '', city_id: '' })); return; }
                      const { date, cityId } = parseTripDayOptionValue(v);
                      setFields(prev => ({ ...prev, date, city_id: cityId || '' }));
                    }}
                    options={dayOptions}
                    placeholder={category === 'hotel' ? t('documents.form.fields.checkIn') : t('documents.form.selectDay')}
                    allowEmpty emptyLabel={t('documents.form.noDay')}
                  />
                ) : (
                  <DatePill value={fields.date} onChange={v => setField('date', v)}
                    minDate={isPersonalCategory ? undefined : minDate} maxDate={isPersonalCategory ? undefined : maxDate}
                    placeholder={category === 'hotel' ? t('documents.form.fields.checkIn') : t('documents.form.fields.date')} clearable />
                ))}
                {hasField('end_date') && (
                  <>
                    <span className="text-xs text-muted-foreground">→</span>
                    <DatePill value={fields.end_date} onChange={v => setField('end_date', v)}
                      minDate={fields.date || (isPersonalCategory ? undefined : minDate)} maxDate={isPersonalCategory ? undefined : maxDate}
                      placeholder={category === 'hotel' ? t('documents.form.fields.checkOut') : t('documents.form.fields.endDate')} clearable />
                  </>
                )}
                {hasField('time') && (
                  <TimePill value={fields.time} onChange={v => setField('time', v)}
                    placeholder={transport ? t('documents.form.fields.time') : t('common.time')} />
                )}
              </div>
            </FormRow>
          )}

          {/* Ciudad de llegada — solo transporte en viajes multi-ciudad (ver
              Cities.jsx: decide bajo qué ciudad sale en un día de tránsito). */}
          {transport && (cities || []).length > 1 && (
            <FormRow icon={Navigation}>
              <OptionPill
                value={fields.arrival_city_id}
                onChange={v => setField('arrival_city_id', v)}
                options={cities.filter(c => c.id !== fields.city_id).map(c => ({ value: c.id, label: c.name }))}
                placeholder={t('documents.form.fields.arrivalCityOptional')}
                allowEmpty emptyLabel={t('documents.form.noArrivalCity')}
              />
            </FormRow>
          )}

          {hasField('notes') && (
            <FormRow icon={StickyNote} align="start">
              <textarea value={fields.notes} onChange={e => setField('notes', e.target.value)} rows={2}
                placeholder={t('documents.form.ph.notesShort')}
                autoCapitalize="sentences" autoCorrect="on" spellCheck
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none" />
            </FormRow>
          )}
        </FormCard>
      </FormSection>

      {/* 4. ¿Para quién es? — no sale estando solo en el viaje */}
      {!soloTrip && (
        <FormSection title={t('documents.form.usedBy')} hint={category === 'hotel' ? t('documents.form.usedByHintStay') : t('documents.form.usedByHint')}>
          <div className="flex flex-wrap gap-2">
            {members.map((email) => {
              const isMe = normalizeEmail(email) === meEmail;
              return (
                <Chip key={email} on={isHolder(email)} onClick={() => toggleUsedBy(email)}
                  avatar={<PersonAvatar email={email} profile={profileFor(email, profiles)} />}>
                  {isMe ? t('documents.form.me') : displayNameFor(email, profiles)}
                </Chip>
              );
            })}
            {members.length > 1 && (
              <Chip on={members.every(m => isHolder(m))} onClick={toggleAllUsers}>{t('documents.form.everyone')}</Chip>
            )}
          </div>
          {usedBy.length === 0 && <p className="text-xs text-red-500 mt-2">{t('documents.form.usedByRequired')}</p>}
        </FormSection>
      )}

      {/* 5. ¿Quién lo ve? — mismos chips */}
      <FormSection title={t('documents.form.whoSees')}>
        <div className="flex flex-wrap gap-2">
          {soloTrip ? (
            <Chip on locked avatar={<PersonAvatar email={currentUserEmail} profile={profileFor(currentUserEmail, profiles)} />}>
              {t('documents.form.me')}
            </Chip>
          ) : members.map(email => (
            <Chip key={email} on={seesIt(email)} locked={isLockedViewer(email)} onClick={() => tapPersonViewer(email)}
              avatar={<PersonAvatar email={email} profile={profileFor(email, profiles)} />}>
              {normalizeEmail(email) === meEmail ? t('documents.form.me') : displayNameFor(email, profiles)}
            </Chip>
          ))}
          <Chip on={audience === 'group'} onClick={tapGroupViewer}>{t('documents.form.vis.group')}</Chip>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {audience === 'group'
            ? t('documents.form.vis.groupDescSolo')
            : soloTrip ? t('documents.form.vis.onlyMeDesc') : t('documents.form.whoSeesHint')}
        </p>
      </FormSection>

      {/* Actions */}
      {onDelete && (
        <button type="button" onClick={onDelete} className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 rounded-full border border-red-200 transition-colors">
          <Trash2 className="w-4 h-4" />{t('documents.form.deleteDoc')}
        </button>
      )}
      <div className="flex gap-3 pt-1">
        <Button variant="outline" onClick={onCancel} className="flex-1 rounded-full">{t('common.cancel')}</Button>
        <Button onClick={handleSave} disabled={!canSave || saving || fileUploading} className="flex-1 rounded-full bg-primary hover:bg-primary/90 text-white">
          {saving ? t('documents.form.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
