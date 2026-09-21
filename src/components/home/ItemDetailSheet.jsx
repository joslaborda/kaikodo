import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, CirclePlus, Trash2 } from 'lucide-react';
import { DOC_ICONS, SPOT_ICONS, SPOT_COLORS } from './constants';
import { useTranslation } from 'react-i18next';
import { resolveDocViewUrl } from '@/lib/privateFiles';

export default function ItemDetailSheet({ item, onClose, onSaveTime, onOpenPdf, onDelete }) {
  const { t } = useTranslation();
  const [editingTime, setEditingTime] = useState(false);
  const [time, setTime] = useState(item?.time || '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Mientras la hoja está abierta, la página de detrás no debe hacer scroll (en
  // escritorio se podía subir y bajar toda la página con la hoja encima).
  useEffect(() => {
    if (!item) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [!!item]);

  if (!item) return null;

  const isDoc  = item._kind === 'doc';
  const isNote = item._kind === 'note';
  const EmojiIcon = isDoc ? (DOC_ICONS[item.type] || DOC_ICONS.other) : null;
  const SpotIcon  = !isDoc ? (SPOT_ICONS[item.type] || CirclePlus) : null;
  const spotColor = !isDoc ? (SPOT_COLORS[item.type] || SPOT_COLORS.custom) : '';
  const title = item.title || item.name || t('itemDetail.untitled');
  // El tipo se mostraba tal cual ("train" → "Train", en inglés aunque la app esté en
  // español): se traduce con las mismas claves que el resto de la app.
  const typeLabel = item.type
    ? t((isDoc ? 'documents.types.' : 'spots.types.') + item.type, { defaultValue: item.type })
    : null;
  // Las notas de itinerario traen el texto en `content`, no en `notes` — antes
  // este sheet solo miraba `item.notes`, así que el cuerpo de la nota nunca
  // se veía aquí (aunque sí en el editor de Ruta).
  const noteText = isNote ? item.content : item.notes;

  const handleSave = async () => {
    setSaving(true);
    await onSaveTime(item, time);
    setSaving(false);
    setEditingTime(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await onDelete(item); } finally { setDeleting(false); }
  };

  // Resuelve la URL en el momento de abrir — para documentos con file_uri
  // (storage privado) pide una URL firmada nueva cada vez en vez de una que
  // podría haber caducado. Ver src/lib/privateFiles.js.
  const handleOpenPdf = async () => {
    const url = await resolveDocViewUrl(item);
    onClose();
    if (url) setTimeout(() => onOpenPdf(url), 50);
  };

  // Portal a <body> (mismo patrón que FeedbackModal / NotificationBell): pegada al
  // borde inferior de la pantalla y por encima de la barra, sea cual sea el
  // contenedor desde el que se abra.
  const sheet = (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="bg-card w-full max-w-lg rounded-t-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="pt-3 pb-1 flex justify-center">
          <div className="w-9 h-1 rounded-full bg-border" />
        </div>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isDoc ? 'bg-orange-50' : spotColor || 'bg-secondary'}`}>
            {isDoc ? <EmojiIcon size={20} className="text-primary" /> : SpotIcon ? <SpotIcon size={20} /> : null}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium text-foreground leading-snug">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 capitalize">
              {typeLabel || (isDoc ? t('itemDetail.document') : t('itemDetail.spot'))}
              {item.time && <span className="text-primary font-medium"> · {item.time}</span>}
            </p>
          </div>
          <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">{t('itemDetail.time')}</p>
            {editingTime ? (
              <div className="flex items-center gap-2">
                <input type="time" value={time} onChange={e => setTime(e.target.value)}
                  className="h-9 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary" />
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-1.5 bg-primary text-white text-sm rounded-full font-medium disabled:opacity-50">
                  {saving ? '...' : t('common.save')}
                </button>
                <button onClick={() => { setEditingTime(false); setTime(item?.time || ''); }}
                  className="text-sm text-muted-foreground">{t('common.cancel')}</button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-sm text-foreground">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  {item.time
                    ? <span className="text-primary font-medium">{item.time}</span>
                    : <span className="text-muted-foreground">{t('itemDetail.noTimeAssigned')}</span>}
                </div>
                <button onClick={() => setEditingTime(true)} className="text-xs text-primary font-medium underline underline-offset-2">
                  {item.time ? t('itemDetail.edit') : t('itemDetail.addTime')}
                </button>
              </div>
            )}
          </div>

          {!isDoc && noteText && (
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">{t('itemDetail.note')}</p>
              <div className="bg-secondary rounded-xl p-3">
                <p className="text-sm text-foreground leading-relaxed">{noteText}</p>
              </div>
            </div>
          )}

          {isDoc && item.type && (
            <div className="flex gap-2">
              <div className="bg-secondary rounded-xl p-3 flex-1">
                <p className="text-xs text-muted-foreground mb-1">{t('itemDetail.type')}</p>
                <p className="text-sm font-medium text-foreground capitalize">{typeLabel}</p>
              </div>
              {!item.file_url && !item.file_uri && (
                <div className="bg-secondary rounded-xl p-3 flex-1">
                  <p className="text-xs text-muted-foreground mb-1">{t('itemDetail.file')}</p>
                  <p className="text-sm text-muted-foreground">{t('itemDetail.noFile')}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {onDelete && confirmDelete && (
          <div className="mx-5 mb-3 flex items-center justify-between gap-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl px-4 py-2.5">
            <span className="text-xs text-red-600">{t('itemDetail.deleteConfirm')}</span>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted-foreground">{t('common.cancel')}</button>
              <button onClick={handleDelete} disabled={deleting} className="text-xs font-medium text-red-600 disabled:opacity-50">
                {deleting ? '...' : t('common.delete')}
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 px-5 pt-0" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
          {onDelete && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors shrink-0">
              <Trash2 className="w-3.5 h-3.5" />{t('common.delete')}
            </button>
          )}
          {isDoc && (item.file_url || item.file_uri) && (
            <button onClick={handleOpenPdf}
              className="flex-1 py-3 bg-primary text-white rounded-full text-sm font-medium">
              {t('itemDetail.viewDocument')}
            </button>
          )}
          {!isDoc && item.lat && item.lng && (
            <a href={`https://maps.google.com/?q=${item.lat},${item.lng}`} target="_blank" rel="noopener noreferrer"
              className="flex-1 py-3 bg-primary text-white rounded-full text-sm font-medium text-center">
              {t('itemDetail.viewOnMap')}
            </a>
          )}
          <button onClick={onClose}
            className="flex-1 py-3 bg-secondary border border-border rounded-full text-sm text-muted-foreground">
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
}
