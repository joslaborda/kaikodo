import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { MapPin, X, Camera, Navigation, Pencil, Utensils, Landmark, Zap, ShoppingBag, Train, TrainFront, BusFront, Star, Hotel, Moon, ThumbsUp, ThumbsDown, Check, Trash2 } from 'lucide-react';
import { PlaneIcon } from '@/lib/icons';
import { useLike } from '@/hooks/useLike';
import { getMapsUrl } from './spotsHelpers';
import { useTranslation } from 'react-i18next';
import { checkUpload, convertHeicIfNeeded } from '@/lib/uploadLimits';
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

async function uploadPhoto(file) {
  const chk = checkUpload(file);
  if (!chk.ok) return { error: chk.reason, maxMb: chk.maxMb };
  try {
    const uploadFile = await convertHeicIfNeeded(file);
    const result = await base44.functions.invoke('uploadPublicFile', { file: uploadFile });
    const data = result?.data ?? result;
    if (data?.error) throw new Error(data.error);
    const { file_url } = data;
    return { url: file_url };
  } catch {
    return { error: 'failed' };
  }
}


function RatingPopup({ spot, userId, userProfile, onClose }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [thumb, setThumb] = useState(null);
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [showImageField, setShowImageField] = useState(false);

  const mutation = useMutation({
    mutationFn: () => base44.entities.SpotComment.create({
      spot_id: spot.id,
      user_id: userId,
      user_display_name: userProfile?.display_name || '',
      username: userProfile?.username || '',
      user_avatar: userProfile?.avatar_url || '',
      thumb,
      text: text.trim() || null,
      image_url: imageUrl.trim() || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spotComments', spot.id] });
      onClose();
    },
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-t-2xl p-5 pb-8" onClick={e => e.stopPropagation()}>
        <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-semibold text-foreground text-sm">{t('spots.rating.title')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{spot.title}</p>
          </div>
          <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button aria-label={t('spots.vote.up')} onClick={() => setThumb('up')}
            className={"flex items-center justify-center gap-2 py-3 rounded-xl border transition-all " +
              (thumb === 'up' ? 'bg-green-50 border-green-300' : 'bg-secondary border-border hover:border-green-200')}>
            <ThumbsUp className={"w-5 h-5 " + (thumb === 'up' ? 'text-green-600' : 'text-muted-foreground')} />
            <span className={"text-sm font-medium " + (thumb === 'up' ? 'text-green-700' : 'text-muted-foreground')}>{t('spots.rating.liked')}</span>
          </button>
          <button aria-label={t('spots.vote.down')} onClick={() => setThumb('down')}
            className={"flex items-center justify-center gap-2 py-3 rounded-xl border transition-all " +
              (thumb === 'down' ? 'bg-red-50 border-red-300' : 'bg-secondary border-border hover:border-red-200')}>
            <ThumbsDown className={"w-5 h-5 " + (thumb === 'down' ? 'text-red-600' : 'text-muted-foreground')} />
            <span className={"text-sm font-medium " + (thumb === 'down' ? 'text-red-700' : 'text-muted-foreground')}>{t('spots.rating.notSoMuch')}</span>
          </button>
        </div>

        <textarea value={text} onChange={e => setText(e.target.value)}
          placeholder={t('spots.rating.placeholder')}
          className="w-full text-sm border border-border rounded-xl px-3 py-2.5 h-20 resize-none outline-none focus:border-primary bg-secondary mb-3" />

        {showImageField ? (
          <label className="w-full cursor-pointer block mb-3">
            <input type="file" accept="image/*" capture="environment" className="hidden"
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const r = await uploadPhoto(file);
                if (r.url) setImageUrl(r.url);
                else toast({ title: r.error === 'size' ? t('upload.tooLarge') : r.error === 'type' ? t('upload.notImage') : t('upload.failed'),
                  description: r.error === 'size' ? t('upload.maxMb', { mb: r.maxMb }) : undefined, variant: 'destructive' });
              }} />
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-colors ${imageUrl ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
              <Camera className="w-4 h-4" />
              {imageUrl ? t('spots.rating.photoSelected') : t('spots.rating.uploadPhoto')}
            </div>
          </label>
        ) : (
          <button onClick={() => setShowImageField(true)}
            className="w-full flex items-center gap-2 px-3 py-2.5 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors mb-3">
            <Camera className="w-4 h-4" />{t('spots.rating.addPhoto')}
          </button>
        )}

        <button onClick={() => mutation.mutate()} disabled={!thumb || mutation.isPending}
          className="w-full py-3 rounded-full bg-green-600 text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700 transition-colors">
          {mutation.isPending ? t('spots.rating.saving') : t('spots.rating.save')}
        </button>
      </div>
    </div>
  );
}

function CommentsPopup({ spot, userId, userProfile, onClose }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [thumb, setThumb] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [showImageField, setShowImageField] = useState(false);

  const { data: comments = [] } = useQuery({
    queryKey: ['spotComments', spot.id],
    queryFn: () => base44.entities.SpotComment.filter({ spot_id: spot.id }),
    staleTime: 30000,
  });

  const mutation = useMutation({
    mutationFn: () => base44.entities.SpotComment.create({
      spot_id: spot.id, user_id: userId,
      user_display_name: userProfile?.display_name || '',
      username: userProfile?.username || '',
      user_avatar: userProfile?.avatar_url || '',
      thumb, text: text.trim() || null,
      image_url: imageUrl.trim() || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spotComments', spot.id] });
      setText(''); setThumb(null); setImageUrl(''); setShowImageField(false);
    },
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const ups = comments.filter(c => c.thumb === 'up').length;
  const downs = comments.filter(c => c.thumb === 'down').length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-t-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border flex-shrink-0">
          <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-foreground text-sm">{t('spots.comments.title')}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1"><ThumbsUp className="w-3 h-3" /> {ups}</span>
                <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full flex items-center gap-1"><ThumbsDown className="w-3 h-3" /> {downs}</span>
              </div>
            </div>
            <button aria-label={t('common.close')} onClick={onClose} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {comments.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">{t('spots.comments.empty')}</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="flex gap-3">
              {(c.user_avatar || c.avatar_url)
                ? <img src={c.user_avatar || c.avatar_url} alt={c.user_display_name || ''} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                : <div className="w-8 h-8 rounded-full bg-orange-100 text-primary flex items-center justify-center font-semibold text-xs flex-shrink-0">{(c.user_display_name||'?')[0].toUpperCase()}</div>
              }
              <div className="flex-1 min-w-0">
                <div className="bg-secondary rounded-2xl rounded-tl-none px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-foreground">@{c.username || c.user_display_name}</span>
                    <span className="text-xs text-muted-foreground">{c.thumb === 'up' ? '\u2191' : '\u2193'}</span>
                  </div>
                  {c.text && <p className="text-sm text-foreground">{c.text}</p>}
                  {c.image_url && <img src={c.image_url} alt="foto" className="w-full rounded-xl mt-2 object-cover max-h-40" onError={e => e.currentTarget.style.display='none'} />}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-border flex-shrink-0 space-y-2">
          <div className="flex gap-2">
            <button aria-label={t('spots.vote.up')} onClick={() => setThumb(thumb === 'up' ? null : 'up')}
              className={"px-3 py-1.5 rounded-lg text-sm border transition-colors " + (thumb === 'up' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-secondary border-border text-muted-foreground')}>
              <ThumbsUp className="w-4 h-4" />
            </button>
            <button aria-label={t('spots.vote.down')} onClick={() => setThumb(thumb === 'down' ? null : 'down')}
              className={"px-3 py-1.5 rounded-lg text-sm border transition-colors " + (thumb === 'down' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-secondary border-border text-muted-foreground')}>
              <ThumbsDown className="w-4 h-4" />
            </button>
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder={t('spots.comments.placeholder')}
              className="flex-1 text-sm border border-border rounded-xl px-3 py-1.5 resize-none outline-none focus:border-primary bg-secondary h-9" />
          </div>
          <div className="flex gap-2">
            {showImageField ? (
              <div className="flex gap-1.5 flex-1">
                <label className="cursor-pointer flex-1">
                  <input type="file" accept="image/*" className="hidden"
                    onChange={async e => { const file=e.target.files?.[0]; if(!file) return; const r=await uploadPhoto(file); if(r.url) setImageUrl(r.url); else toast({ title: r.error==='size'?t('upload.tooLarge'):r.error==='type'?t('upload.notImage'):t('upload.failed'), description: r.error==='size'?t('upload.maxMb',{mb:r.maxMb}):undefined, variant:'destructive' }); }} />
                  <div className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-xl border text-xs transition-colors ${imageUrl ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                    <Camera className="w-3.5 h-3.5" />{imageUrl ? t('spots.comments.ok') : t('spots.comments.gallery')}
                  </div>
                </label>
                <label className="cursor-pointer flex-1">
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={async e => { const file=e.target.files?.[0]; if(!file) return; const r=await uploadPhoto(file); if(r.url) setImageUrl(r.url); else toast({ title: r.error==='size'?t('upload.tooLarge'):r.error==='type'?t('upload.notImage'):t('upload.failed'), description: r.error==='size'?t('upload.maxMb',{mb:r.maxMb}):undefined, variant:'destructive' }); }} />
                  <div className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-xl border border-border text-xs text-muted-foreground hover:border-primary/40 transition-colors">
                    <Camera className="w-3.5 h-3.5" />{t('spots.comments.camera')}
                  </div>
                </label>
              </div>
            ) : (
              <button onClick={() => setShowImageField(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1.5 border border-dashed border-border rounded-xl flex-1 justify-center transition-colors">
                <Camera className="w-3.5 h-3.5" />{t('spots.comments.photo')}
              </button>
            )}
            <button onClick={() => mutation.mutate()} disabled={!thumb || mutation.isPending}
              className="px-4 py-1.5 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors">
              {mutation.isPending ? '...' : t('spots.comments.post')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

function VisitedRatingPopup({ spot, userId, userProfile, onClose }) {
  const { toast } = useToast();
  return <RatingPopup spot={spot} userId={userId} userProfile={userProfile} onClose={onClose} />;
}

export default function SpotCard({ spot, days = [], currentUserEmail, cityId, tripId }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showComments, setShowComments] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: userProfile } = useQuery({
    queryKey: ['myProfile', user?.id],
    queryFn: async () => { const r = await base44.entities.UserProfile.filter({ user_id: user.id }); return r[0] || null; },
    enabled: !!user?.id, staleTime: 60000,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['spotComments', spot.id],
    queryFn: () => base44.entities.SpotComment.filter({ spot_id: spot.id }),
    staleTime: 30000,
  });

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

          <button onClick={() => setShowComments(true)} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span className="text-sm">{comments.length > 0 ? comments.length : ''}</span>
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

      {showComments && (
        <CommentsPopup spot={spot} userId={user?.id} userProfile={userProfile} onClose={() => setShowComments(false)} />
      )}
      {showDeleteConfirm && (
        <DeleteConfirmPopup spot={spot}
          onConfirm={() => { deleteMutation.mutate(); setShowDeleteConfirm(false); }}
          onCancel={() => setShowDeleteConfirm(false)} />
      )}
    </>
  );
}
