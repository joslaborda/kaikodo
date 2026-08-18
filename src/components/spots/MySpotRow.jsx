import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Pencil, Navigation, Star } from 'lucide-react';
import { TYPE_CONFIG, getMapsUrl } from './spotsHelpers';
import useLikeSimple from './useLikeSimple';
import InlineCommentsPopup from './InlineCommentsPopup';
import { useTranslation } from 'react-i18next';

export default
function MySpotRow({ spot, onTap, userId }) {
  const { t } = useTranslation();
  const tc = TYPE_CONFIG[spot.type] || TYPE_CONFIG.custom;
  const { isLiked, count: likeCount, toggle: toggleLike } = useLikeSimple(spot.id, userId);
  const [showComments, setShowComments] = useState(false);

  const { data: comments = [] } = useQuery({
    queryKey: ['spotComments', spot.id],
    queryFn: () => base44.entities.SpotComment.filter({ spot_id: spot.id }),
    staleTime: 60000,
  });

  const hasDate = !!spot.assigned_date;

  return (
    <div className="bg-card border-b border-border last:border-0">
      {/* Main row — clickable to open sheet */}
      <button onClick={() => onTap(spot)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/20 transition-colors">
        {spot.photo_url ? (
          <img src={spot.photo_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tc.color}`}>{tc.Icon && <tc.Icon size={16} />}</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <p className={`text-sm font-medium truncate ${spot.visited ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
              {spot.title}
            </p>
            {spot.rating != null && (
              <span className="inline-flex items-center gap-0.5 text-xs text-foreground font-medium shrink-0">
                <Star className="w-3 h-3 fill-current text-amber-400" />{Number(spot.rating).toFixed(1)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t(tc.tk)}
            {spot.city_name ? ' · ' + spot.city_name : ''}
          </p>
          {hasDate && (
            <p className="text-xs text-primary mt-0.5 flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {spot.assigned_date}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {spot.visited ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{t('spots.card.visited')}</span>
          ) : hasDate ? (
            <span className="text-xs bg-orange-100 text-primary px-2 py-0.5 rounded-full font-medium">{t('spots.assigned')}</span>
          ) : (
            <span className="text-xs text-muted-foreground/60">{t('spots.noDay')}</span>
          )}
          <Pencil className="w-3.5 h-3.5 text-muted-foreground/40" />
        </div>
      </button>

      {/* Like + comment row */}
      <div className="flex items-center gap-4 px-4 pb-3">
        <button onClick={e => { e.stopPropagation(); toggleLike(); }} className="flex items-center gap-1.5 text-xs transition-colors p-1 -m-1 rounded-lg">
          {isLiked
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="hsl(var(--primary))" stroke="hsl(var(--primary))" strokeWidth="0"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          }
          <span className={isLiked ? 'text-primary' : 'text-muted-foreground'}>{likeCount > 0 ? likeCount : t('spots.sheet.like')}</span>
        </button>
        <button onClick={e => { e.stopPropagation(); setShowComments(true); }} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-lg">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          {comments.length > 0 ? comments.length : t('spots.sheet.comment')}
        </button>
        {(spot.address || (spot.lat && spot.lng)) && (
          <a href={getMapsUrl(spot)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors p-1 -m-1 rounded-lg ml-auto">
            <Navigation className="w-3.5 h-3.5" />{t('spots.sheet.directions')}
          </a>
        )}
      </div>

      {showComments && <InlineCommentsPopup spot={spot} userId={userId} onClose={() => setShowComments(false)} />}
    </div>
  );
}