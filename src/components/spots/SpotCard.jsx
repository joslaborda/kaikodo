import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { MapPin, Navigation, Pencil, Utensils, Landmark, Zap, ShoppingBag, Train, TrainFront, BusFront, Star, Hotel, Moon, Check, Trash2 } from 'lucide-react';
import { PlaneIcon } from '@/lib/icons';
import { useLike } from '@/hooks/useLike';
import { getMapsUrl } from './spotsHelpers';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { normalizeEmail } from '@/lib/utils';

const TYPE_CONFIG = {
  food:      { tk: 'spots.types.food',      Icon: Utensils,   color: 'bg-orange-100 text-primary' },
  sight:     { tk: 'spots.types.sight',     Icon: Landmark,   color: 'bg-blue-100 text-blue-700' },
  activity:  { tk: 'spots.types.activity',   Icon: Zap,        color: 'bg-green-100 text-green-700' },
  shopping:  { tk: 'spots.types.shopping',   Icon: ShoppingBag,color: 'bg-purple-100 text-purple-700' },
  transport: { tk: 'spots.types.transport',  Icon: Train,      color: 'bg-secondary text-foreground' },
  hotel:     { tk: 'spots.types.hotel',      Icon: Hotel,      color: 'bg-indigo-100 text-indigo-700' },
  nightlife: { tk: 'spots.types.nightlife',  Icon: Moon,       color: 'bg-indigo-100 text-indigo-700' },
  airport:   { tk: 'spots.types.airport',    Icon: PlaneIcon,  color: 'bg-sky-100 text-sky-700' },
  train:     { tk: 'spots.types.train',      Icon: TrainFront, color: 'bg-emerald-100 text-emerald-700' },
  bus:       { tk: 'spots.types.bus',        Icon: BusFront,   color: 'bg-amber-100 text-amber-700' },
  custom:    { tk: 'spots.types.custom',    Icon: Star,       color: 'bg-yellow-100 text-yellow-700' },
};

// José (14 sep 2026): función de comentarios/valoración de spots (thumbs
// up/down + texto + foto, entidad SpotComment) eliminada a propósito. La
// auditoría del 14 sep encontró que SpotComment nunca comprobaba si quien
// comenta tiene acceso real al Spot padre (solo exigía sesión), y no era
// arreglable con una regla de acceso simple porque el motor de rls de
// Base44 no puede comparar contra otra entidad. En vez de mover esto a una
// función backend, se decidió quitar la función entera — no estaba en uso
// real fuera de Explore.jsx (también eliminado en el mismo cambio) y las
// tarjetas de spot del propio viaje.
// Aquí vivían RatingPopup, CommentsPopup y VisitedRatingPopup (esta última
// ya era código muerto -- no se usaba desde ningún sitio antes de este
// cambio). El botón de "me gusta" (useLike, entidad Like) y el borrado de
// spot no se han tocado, son cosas distintas.

function DeleteConfirmPopup({ spot, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-card w-full max-w-md rounded-t-2xl p-5 pb-8" onClick={e => e.stopPropagation()}>
        <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />
        <p className="font-semibold text-foreground text-sm mb-1">{t('spots.delete.title')}</p>
        <p className="text-xs text-muted-foreground mb-5">{t('spots.delete.body1')} <strong>{spot.title}</strong> {t('spots.delete.body2')}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-full border border-border text-sm text-muted-foreground">{t('common.cancel')}</button>
          <button onClick={onConfirm} className="flex-1 py-3 rounded-full bg-primary text-white text-sm font-medium">{t('common.delete')}</button>
        </div>
      </div>
    </div>
  );
}

export default function SpotCard({ spot, days = [], currentUserEmail, cityId, tripId }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { isLiked, count: likeCount, toggle: toggleLike } = useLike({
    targetId: spot.id,
    targetType: 'spot',
    userId: user?.id,
    targetOwnerId: spot.created_by_user_id,
  });

  const tc = TYPE_CONFIG[spot.type] || TYPE_CONFIG.custom;
  const canDelete = normalizeEmail(spot.created_by) === normalizeEmail(currentUserEmail);

  const updateMutation = useMutation({
    mutationFn: data => base44.entities.Spot.update(spot.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spots', cityId] });
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
    },
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.Spot.delete(spot.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spots', cityId] });
      queryClient.invalidateQueries({ queryKey: ['spots', tripId] });
    },
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const handleMarkVisited = () => {
    updateMutation.mutate({ visited: !spot.visited });
  };

  return (
    <>
      <div className={"rounded-2xl border transition-all " + (spot.visited ? 'bg-green-50 dark:bg-green-950/20 border-green-200' : 'bg-card border-border')}>
        <div className="p-4">
          <div className="flex items-start gap-3">
            {spot.photo_url ? (
              <img src={spot.photo_url} alt="" className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
            ) : (
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tc.color}`}>{tc.Icon && <tc.Icon size={16} />}</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="font-semibold text-foreground text-sm leading-tight truncate">{spot.title}</p>
                  {spot.rating != null && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-foreground font-medium shrink-0">
                      <Star className="w-3 h-3 fill-current text-amber-400" />{Number(spot.rating).toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {spot.visited && <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium"><Check className="w-3 h-3" />{t('spots.card.visited')}</span>}
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground/40" />
                </div>
              </div>
              <span className={"inline-block text-xs px-2 py-0.5 rounded-full mt-1 " + tc.color}>{t(tc.tk)}</span>
              {spot.address && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />{spot.address}
                </p>
              )}
              {spot.notes && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{spot.notes}</p>}
              {spot.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {spot.tags.map(t => <span key={t} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">#{t}</span>)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-inherit px-4 py-3 flex items-center gap-5">
          <button onClick={toggleLike} className="flex items-center gap-1.5 transition-colors">
            {isLiked
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="hsl(var(--primary))" stroke="hsl(var(--primary))" strokeWidth="0"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            }
            <span className={`text-sm font-medium ${isLiked ? 'text-primary' : 'text-muted-foreground'}`}>
              {(likeCount || spot.visits) > 0 ? (likeCount || spot.visits) : ''}
            </span>
          </button>

          <div className="flex-1" />

          <a href={getMapsUrl(spot)} target="_blank" rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
            <Navigation className="w-3.5 h-3.5" />{t('spots.cardMaps')}
          </a>

          <button onClick={handleMarkVisited}
            className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
              spot.visited ? 'bg-green-100 text-green-700 border-green-200' : 'bg-secondary border-border text-muted-foreground hover:border-green-300'
            }`}>
            {spot.visited && <Check className="w-3 h-3" />}{spot.visited ? t('spots.card.done') : t('spots.card.markDone')}
          </button>

          {canDelete && (
            <button onClick={() => setShowDeleteConfirm(true)} aria-label={t('common.delete')}
              className="text-red-500 hover:text-red-700 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <DeleteConfirmPopup spot={spot}
          onConfirm={() => { deleteMutation.mutate(); setShowDeleteConfirm(false); }}
          onCancel={() => setShowDeleteConfirm(false)} />
      )}
    </>
  );
}
