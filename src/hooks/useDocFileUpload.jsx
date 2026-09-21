import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { checkUpload, convertHeicIfNeeded } from '@/lib/uploadLimits';
import { uploadDocFile } from '@/lib/privateFiles';
import { saveTicketBlob } from '@/lib/ticketCache';
import { invalidateTripDocs } from '@/hooks/useTripDocs';

// José (21 sep 2026): "llega la hora del tren y pum, ¿dónde está? no puedo subirlo…".
// Subir o CAMBIAR el archivo de un documento tiene que poder hacerse desde donde
// lo necesitas (la tarjeta del próximo tren, la hoja de detalle), en un toque y sin
// pasar por el formulario. Una sola implementación, la misma que el formulario
// usa para subir (almacenamiento privado, file_uri).
//
// const { pickFor, uploadingId, input } = useDocFileUpload({ onUploaded });
//   pickFor(doc)  → abre el selector de archivos para ESE documento
//   input         → <input> oculto: hay que renderizarlo una vez en el componente
export function useDocFileUpload({ onUploaded } = {}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const targetRef = useRef(null);
  const [uploadingId, setUploadingId] = useState(null);

  const pickFor = (doc) => {
    if (!doc?.id) return;
    targetRef.current = doc;
    inputRef.current?.click();
  };

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const doc = targetRef.current;
    if (!file || !doc?.id) return;
    // Sin conexión no se puede subir: se dice claro (antes: un "error" genérico).
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast({ title: t('offline.uploadNeedsNetwork'), description: t('offline.uploadNeedsNetworkHint'), variant: 'destructive' });
      return;
    }
    const chk = checkUpload(file, { images: false });
    if (!chk.ok) {
      toast({ title: t('upload.tooLarge'), description: t('upload.maxMb', { mb: chk.maxMb }), variant: 'destructive' });
      return;
    }
    setUploadingId(doc.id);
    try {
      const uploadFile = await convertHeicIfNeeded(file);
      const { file_uri } = await uploadDocFile(uploadFile);
      await base44.entities.Ticket.update(doc.id, { file_uri, file_url: '' });
      if (doc.trip_id) invalidateTripDocs(queryClient, doc.trip_id);
      // La copia ya está en el móvil: se guarda para abrirla sin red desde el primer momento.
      await saveTicketBlob({ ...doc, file_uri, file_url: '' }, uploadFile);
      toast({ title: t('itemDetail.uploaded') });
      onUploaded?.(doc, file_uri);
    } catch {
      toast({ title: t('common.error'), description: t('common.tryAgain'), variant: 'destructive' });
    }
    setUploadingId(null);
  };

  const input = (
    <input ref={inputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handleChange} />
  );

  return { pickFor, uploadingId, input };
}
