import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTripContext } from '@/hooks/useTripContext';
import { notify, resolveUserIds } from '@/lib/notifications';
import { Download, X, ArrowRight, Camera, Plus, Loader2, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseServerDate } from '@/lib/parseServerDate';
import { useTranslation } from 'react-i18next';
import { checkUpload, convertHeicIfNeeded } from '@/lib/uploadLimits';
import { useToast } from '@/components/ui/use-toast';
import { normalizeEmail } from '@/lib/utils';

function groupByDate(photos) {
  const groups = {};
  photos.forEach(p => {
    const key = (p.taken_at || p.created_date || '').slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, items }));
}

export default function Photos() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const tripId = urlParams.get('trip_id');
  const { trip, myProfile } = useTripContext(tripId);

  const [lbIdx, setLbIdx] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [deletePhoto, setDeletePhoto] = useState(null);

  const { data: messages = [], isLoading: loadingPhotos } = useQuery({
    queryKey: ['tripMessages', tripId],
    // Con orden ascendente y un límite de 500, un viaje con mucho chat+fotos
    // se quedaba con los 500 mensajes MÁS ANTIGUOS — las fotos recientes ni
    // siquiera llegaban a bajarse. Orden descendente para que el límite se
    // coma lo viejo, no lo nuevo (el reordenado cronológico para mostrar es
    // aparte, más abajo).
    queryFn: () => base44.entities.TripMessage.filter({ trip_id: tripId }, '-created_date', 500),
    enabled: !!tripId,
    staleTime: 0,
  });

  const photos = messages
    .filter(m => m.file_type === 'image' && m.file_url)
    .sort((a, b) => {
      const da = a.taken_at || a.created_date || '';
      const db = b.taken_at || b.created_date || '';
      return da.localeCompare(db);
    });

  const groups = groupByDate(photos);

  // Solo quien subió la foto puede borrarla (misma lógica que "isMine" en
  // ChatTab.jsx). Comparamos user_id y, si falta, el email normalizado.
  const isMine = (photo) =>
    !!photo && !!user && (
      photo.user_id === user.id ||
      normalizeEmail(photo.user_email) === normalizeEmail(user.email)
    );

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TripMessage.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tripMessages', tripId] });
      setDeletePhoto(null);
      // Si se borró desde el visor a pantalla completa, ciérralo — el índice
      // ya no es válido una vez que `photos` pierde un elemento.
      setLbIdx(null);
    },
    onError: () => {
      toast({ title: t('common.saveError'), description: t('common.tryAgain'), variant: 'destructive' });
    },
  });

  const notifyMembers = async (count) => {
    try {
      const members = trip?.members || [];
      // trip.members está normalizado en minúsculas; user.email tal cual
      // viene del proveedor de auth no siempre lo está — sin normalizar
      // aquí, resolveUserIds() no encontraba coincidencia y la notificación
      // de "foto añadida" simplemente no se creaba, sin ningún error.
      const others = members.filter(e => normalizeEmail(e) !== normalizeEmail(user.email));
      if (!others.length) return;
      const myProfArr = await base44.entities.UserProfile.filter({ email: normalizeEmail(user.email) });
      const myProf = myProfArr[0] || null;
      const resolved = await resolveUserIds(others);
      resolved.forEach(({ userId }) => notify({
        userId,
        type: 'photo_added',
        actor: myProf,
        tripId: trip?.id,
        tripName: trip?.name,
        refTitle: t('photos.uploaded', { count }),
      }));
    } catch {}
  };

  const uploadMutation = useMutation({
    mutationFn: async (files) => {
      // Cada foto se sube por separado: si una falla, las demás siguen. Antes el
      // bucle abortaba en la primera excepción y las ya subidas ni se mostraban.
      const uploaded = [];
      const failed = [];
      // Si `trip` no ha cargado todavía, antes se guardaba trip_members con
      // solo quien sube la foto — el resto del grupo no podía leer ese
      // TripMessage (falla su propia rls) y la foto quedaba invisible para
      // ellos aunque el que la subió sí la viera. Se corta ANTES de subir
      // los archivos (no solo antes de crear el TripMessage) para no gastar
      // subidas que de todas formas habría que rehacer.
      if (!trip?.members?.length) {
        setUploadProgress({ current: files.length, total: files.length });
        return { uploaded, failed: files.map(f => f.name) };
      }
      setUploadProgress({ current: 0, total: files.length });
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const chk = checkUpload(file);
          if (!chk.ok) { failed.push(file.name); setUploadProgress({ current: i + 1, total: files.length }); continue; }
          // EXIF se lee del archivo original (antes de convertir HEIC), la
          // conversión a JPEG no conserva esos metadatos.
          const takenAt = await getExifDate(file);
          const uploadFile = await convertHeicIfNeeded(file);
          const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadFile });
          await base44.entities.TripMessage.create({
            trip_id: tripId,
            user_id: user.id,
            user_email: user.email,
            display_name: myProfile?.display_name || user.email,
            avatar_url: myProfile?.avatar_url || null,
            content: '',
            file_url,
            file_type: 'image',
            file_name: file.name,
            taken_at: takenAt || new Date().toISOString(),
            trip_members: trip.members,
          });
          uploaded.push(file_url);
        } catch {
          failed.push(file.name);
        }
        setUploadProgress({ current: i + 1, total: files.length });
      }
      return { uploaded, failed };
    },
    onSuccess: async ({ uploaded, failed }) => {
      // Se refresca siempre: aunque algunas fallen, las que sí subieron deben verse.
      queryClient.invalidateQueries({ queryKey: ['tripMessages', tripId] });
      if (uploaded.length) await notifyMembers(uploaded.length);
      if (failed.length) {
        toast({
          title: t('photos.uploadFailedTitle', { count: failed.length }),
          description: uploaded.length
            ? t('photos.uploadPartial', { ok: uploaded.length, failed: failed.length })
            : t('photos.uploadRetry'),
          variant: 'destructive',
        });
      }
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['tripMessages', tripId] });
      toast({ title: t('photos.uploadErrorTitle'), description: t('photos.uploadRetry'), variant: 'destructive' });
    },
    onSettled: () => {
      setUploading(false);
      setUploadProgress({ current: 0, total: 0 });
    },
  });

  const handleFiles = async (e) => {
    const allFiles = Array.from(e.target.files || []);
    const files = allFiles.slice(0, 10);
    if (!files.length) return;
    e.target.value = '';
    if (allFiles.length > 10) {
      toast({ title: t('photos.tooManyFilesTitle'), description: t('photos.tooManyFilesDesc', { count: 10 }) });
    }
    setUploading(true);
    uploadMutation.mutate(files);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    // Antes se filtraba por f.type.startsWith('image/') ANTES de llegar a
    // checkUpload, que ya tiene su propio fallback por extensión para
    // cuando file.type viene vacío (típico de HEIC en iOS, ver
    // uploadLimits.js). Un HEIC arrastrado y soltado desaparecía en
    // silencio, sin ningún toast — mientras que el mismo archivo elegido con
    // el selector (handleFiles, sin este filtro) sí se subía. checkUpload ya
    // es la única fuente de verdad en el bucle de subida; se deja que decida
    // él, igual que en handleFiles.
    const allFiles = Array.from(e.dataTransfer.files);
    const files = allFiles.slice(0, 10);
    if (!files.length) return;
    if (allFiles.length > 10) {
      toast({ title: t('photos.tooManyFilesTitle'), description: t('photos.tooManyFilesDesc', { count: 10 }) });
    }
    setUploading(true);
    uploadMutation.mutate(files);
  };

  // Keyboard nav for lightbox
  useEffect(() => {
    if (lbIdx === null) return;
    const h = (e) => {
      if (e.key === 'Escape') setLbIdx(null);
      if (e.key === 'ArrowLeft') setLbIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setLbIdx(i => Math.min(photos.length - 1, i + 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [lbIdx, photos.length]);

  const currentPhoto = lbIdx !== null ? photos[lbIdx] : null;

  return (
    <div className="bg-background min-h-screen pb-32">
      {/* Header */}
      <div className="bg-background sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 pt-12 pb-0">
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('Home') + '?trip_id=' + tripId}>
              <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                {t('photos.backHome')}
              </button>
            </Link>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 text-primary text-sm font-medium hover:text-primary/80 transition-colors disabled:opacity-50"
            >
              {uploading
                ? <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                : <Plus className="w-4 h-4" />}
              {t('photos.addButton')}
            </button>
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-4">{t('photos.title')}</h1>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFiles}
      />

      <div className="max-w-3xl mx-auto">
        {/* Empty state */}
        {/* Barra de progreso de subida */}
      {uploading && uploadProgress.total > 0 && (
        <div className="max-w-3xl mx-auto px-5 py-3">
          <div className="bg-card border border-border rounded-2xl px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">
                {t('photos.uploading')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('photos.progress', { current: uploadProgress.current, total: uploadProgress.total })}
              </p>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {loadingPhotos && photos.length === 0 && (
        <div className="mx-4 mt-8 border border-border rounded-2xl p-12 flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">{t('utilities.loading')}</p>
        </div>
      )}

      {!loadingPhotos && photos.length === 0 && !uploading && (
          <div
            className="mx-4 mt-8 border border-border rounded-2xl p-12 flex flex-col items-center gap-3 cursor-pointer hover:bg-secondary/40 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center">
              <Camera className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">{t('photos.emptyTitle')}</p>
            <p className="text-xs text-muted-foreground text-center">{t('photos.emptySubtitle')}</p>
          </div>
        )}



        {/* Grouped grid */}
        {groups.map(({ date, items }) => (
          <div key={date} className="mt-4">
            <div className="px-4 mb-2 flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                {date ? format(parseISO(date), i18n?.language === 'en' ? 'd MMMM' : "d 'de' MMMM", { locale: i18n?.language === 'en' ? undefined : es }) : t('expenses.noDate')}
              </span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-px">
              {items.map((photo, i) => {
                const globalIdx = photos.indexOf(photo);
                return (
                  <div
                    key={photo.id}
                    className="aspect-square bg-secondary cursor-pointer relative group overflow-hidden"
                    onClick={() => setLbIdx(globalIdx)}
                  >
                    <img
                      src={photo.file_url}
                      alt=""
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
                    {isMine(photo) && (
                      <button
                        onClick={e => { e.stopPropagation(); setDeletePhoto(photo); }}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="w-3 h-3 text-white" />
                      </button>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.5))' }}>
                      <p className="text-micro text-white/90 truncate">{photo.display_name || photo.user_email}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {currentPhoto && typeof document !== 'undefined' && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setLbIdx(null)}
        >
          {/* Top actions */}
          <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
            <a
              href={currentPhoto.file_url}
              download={currentPhoto.file_name || 'foto.jpg'}
              onClick={e => e.stopPropagation()}
              style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', textDecoration: 'none' }}
            >
              <Download size={18} />
            </a>
            {isMine(currentPhoto) && (
              <button
                onClick={e => { e.stopPropagation(); setDeletePhoto(currentPhoto); }}
                aria-label={t('common.delete')}
                style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              onClick={() => setLbIdx(null)}
              style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Prev */}
          {lbIdx > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setLbIdx(i => i - 1); }}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ArrowRight size={18} style={{ transform: 'rotate(180deg)' }} />
            </button>
          )}

          {/* Image */}
          <img
            src={currentPhoto.file_url}
            alt=""
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '95vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 8, width: '100%' }}
          />

          {/* Next */}
          {lbIdx < photos.length - 1 && (
            <button
              onClick={e => { e.stopPropagation(); setLbIdx(i => i + 1); }}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ArrowRight size={18} />
            </button>
          )}

          {/* Bottom info */}
          <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center' }}>
            <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: 500 }}>
              {currentPhoto.display_name || currentPhoto.user_email}
            </p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 }}>
              {currentPhoto.taken_at || currentPhoto.created_date
                ? format(
                    // taken_at lo pone el cliente con toISOString() (trae Z);
                    // created_date es el timestamp automático de base44, que
                    // puede no traerlo — de ahí parseServerDate en ese caso.
                    currentPhoto.taken_at ? parseISO(currentPhoto.taken_at) : parseServerDate(currentPhoto.created_date),
                    "d MMM yyyy · HH:mm",
                    { locale: i18n?.language === 'en' ? undefined : es }
                  )
                : ''}
            </p>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 4 }}>
              {lbIdx + 1} / {photos.length}
            </p>
          </div>
        </div>,
        document.body
      )}

      {/* Delete confirmation — mismo patrón que Documents.jsx */}
      {!!deletePhoto && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/50" onClick={() => setDeletePhoto(null)}>
          <div className="bg-card w-full max-w-lg rounded-t-3xl p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="w-9 h-1 bg-border rounded-full mx-auto mb-5" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <p className="text-sm font-medium text-foreground">{t('photos.deleteConfirm')}</p>
            </div>
            <p className="text-xs text-muted-foreground mb-5 ml-11">{t('photos.deletePermanent')}</p>
            <div className="flex gap-3">
              <button onClick={() => setDeletePhoto(null)} className="flex-1 py-3 border border-border rounded-full text-sm text-muted-foreground">{t('common.cancel')}</button>
              <button
                onClick={() => deleteMutation.mutate(deletePhoto.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-3 bg-primary text-white rounded-full text-sm font-medium disabled:opacity-60 disabled:pointer-events-none"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

async function getExifDate(file) {
  try {
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint16(0) !== 0xFFD8) return null;
    let offset = 2;
    while (offset < view.byteLength) {
      const marker = view.getUint16(offset);
      const len = view.getUint16(offset + 2);
      if (marker === 0xFFE1) {
        const str = String.fromCharCode(...new Uint8Array(buf, offset + 4, 6));
        if (str.startsWith('Exif')) {
          const tiffStart = offset + 10;
          const le = view.getUint16(tiffStart) === 0x4949;
          const readUint16 = o => le ? view.getUint16(tiffStart + o, true) : view.getUint16(tiffStart + o);
          const readUint32 = o => le ? view.getUint32(tiffStart + o, true) : view.getUint32(tiffStart + o);
          const ifdOffset = readUint32(4);
          const entries = readUint16(ifdOffset);
          for (let i = 0; i < entries; i++) {
            const e = ifdOffset + 2 + i * 12;
            const tag = readUint16(e);
            if (tag === 0x9003 || tag === 0x0132) {
              const valOffset = readUint32(e + 8);
              const dateStr = String.fromCharCode(...new Uint8Array(buf, tiffStart + valOffset, 19));
              const iso = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
              return new Date(iso).toISOString();
            }
          }
        }
      }
      offset += 2 + len;
    }
  } catch {}
  return null;
}

