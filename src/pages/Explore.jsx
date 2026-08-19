import { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { searchUserProfiles } from '@/lib/userProfiles';
import { Link } from 'react-router-dom';
import { Search, MapPin, Heart, Bookmark, Users, Compass, Globe, UserPlus, UserCheck, X, Star, Utensils, Landmark, Zap, ShoppingBag, Train, Sparkles, Map } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import TemplateCard from '@/components/explore/TemplateCard';
import CommunitySearch from '@/components/social/CommunitySearch';
import { createPageUrl } from '@/utils';
import { useTranslation } from 'react-i18next';
import { useLike } from '@/hooks/useLike';
import { useToast } from '@/components/ui/use-toast';
import Avatar from '@/components/trip/Avatar';

const SPOT_TYPE_ICON = { food: Utensils, sight: Landmark, activity: Zap, shopping: ShoppingBag, transport: Train, custom: MapPin };
const TYPE_COLORS = {
  food:'bg-orange-50 text-primary', sight:'bg-blue-100 text-blue-700',
  activity:'bg-green-100 text-green-700', shopping:'bg-purple-100 text-purple-700',
  transport:'bg-secondary text-foreground', custom:'bg-yellow-100 text-yellow-700',
};

function LikeButton({ targetId, targetType, userId, targetOwnerId }) {
  const { isLiked, count, toggle } = useLike({ targetId, targetType, userId, targetOwnerId });
  if (!userId) return null;
  return (
    <button onClick={toggle} className={"flex items-center gap-1 transition-colors " + (isLiked ? 'text-red-500' : 'text-muted-foreground hover:text-red-400')}>
      <Heart className={"w-3.5 h-3.5 " + (isLiked ? 'fill-current' : '')}/>
      {count > 0 && <span className="text-xs">{count}</span>}
    </button>
  );
}

function FeedSpotCard({ spot, profile, currentUser, onSave, saving }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const TypeIcon = SPOT_TYPE_ICON[spot.type] || MapPin;
  const color = TYPE_COLORS[spot.type] || TYPE_COLORS.custom;
  const isOwn = currentUser?.id === spot.created_by_user_id;
  const attribution = spot.source_username || spot.source_display_name;
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
      {spot.image_url && <div className="h-36 overflow-hidden"><img src={spot.image_url} alt={spot.title} className="w-full h-full object-cover"/></div>}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Avatar profile={profile} size={32}/>
          <div className="flex-1 min-w-0">
            <Link to={createPageUrl('Profile') + '?user_id=' + spot.created_by_user_id}
              className="text-xs font-semibold text-foreground hover:text-primary truncate block">
              {profile?.display_name || t('explore.traveler')}{profile?.username && <span className="text-muted-foreground font-normal ml-1">@{profile.username}</span>}
            </Link>
            {(spot.city_name || spot.country) && (
              <p className="text-xs text-muted-foreground flex items-center gap-0.5">
                <MapPin className="w-3 h-3"/>{[spot.city_name, spot.country].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
          <span className={"inline-flex items-center px-2 py-1 rounded-full flex-shrink-0 " + color}><TypeIcon className="w-3 h-3" /></span>
        </div>
        {attribution && (
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Heart className="w-3 h-3 text-primary/60"/>Descubierto por @{attribution}
          </p>
        )}
        <div className="flex items-center gap-2 mb-1">
          <p className="font-semibold text-foreground text-sm">{spot.title}</p>
          {spot.avg_rating && (
            <span className="flex items-center gap-0.5 text-xs text-amber-500 flex-shrink-0">
              <Star className="w-3 h-3 fill-amber-400"/>
              {spot.avg_rating}
            </span>
          )}
        </div>
        {spot.notes && <p className="text-xs text-muted-foreground line-clamp-2">{spot.notes}</p>}
        {spot.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {spot.tags.slice(0,4).map(t => <span key={t} className="text-xs bg-secondary text-primary px-1.5 py-0.5 rounded-full">#{t}</span>)}
          </div>
        )}
        <div className="flex items-center gap-3 mt-3">
          <LikeButton targetId={spot.id} targetType="spot" userId={currentUser?.id} targetOwnerId={spot.created_by_user_id}/>
          {!isOwn && currentUser && (
            <button onClick={() => onSave(spot)} disabled={saving} className="flex items-center gap-1.5 text-xs text-primary font-medium hover:text-accent-foreground">
              <Bookmark className="w-3.5 h-3.5"/>{saving ? t('explore.saving') : t('common.save')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function UserCard({ profile, currentUser, myFollows, onFollow }) {
  const { t } = useTranslation();
  const [toggling, setToggling] = useState(false);
  const isOwn = currentUser?.id === profile.user_id;
  const followRecord = myFollows.find(f => f.followed_user_id === profile.user_id);
  const isFollowing = !!followRecord;
  const handleFollowClick = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      await onFollow(profile, followRecord);
    } finally {
      setToggling(false);
    }
  };
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
      <Avatar profile={profile} size={40}/>
      <div className="flex-1 min-w-0">
        <Link to={createPageUrl('Profile') + '?user_id=' + profile.user_id} className="font-semibold text-sm text-foreground hover:text-primary block truncate">
          {profile.display_name || t('explore.traveler')}
        </Link>
        {profile.username && <p className="text-xs text-muted-foreground font-mono">@{profile.username}</p>}
        {profile.home_country && <p className="text-xs text-muted-foreground">{profile.home_country}</p>}
      </div>
      {!isOwn && currentUser && (
        <Button size="sm" onClick={handleFollowClick} disabled={toggling}
          className={isFollowing ? 'border border-primary/30 text-primary bg-card hover:bg-secondary' : 'bg-primary hover:bg-primary/90 text-white'}>
          {isFollowing ? <><UserCheck className="w-3.5 h-3.5 mr-1"/>{t('explore.following')}</> : <><UserPlus className="w-3.5 h-3.5 mr-1"/>{t('explore.follow')}</>}
        </Button>
      )}
    </div>
  );
}


function TopSpotsTab({ publicSpots, profileMap, currentUser, onSave, savingSpotId }) {
  const { t } = useTranslation();
  const [cityFilter, setCityFilter] = useState('');
  const queryClient = useQueryClient();

  // Get all unique cities from public spots
  const cities = [...new Set(publicSpots.map(s => s.city_name).filter(Boolean))].sort();

  // For each spot get comment counts to rank
  const { data: allComments = [] } = useQuery({
    queryKey: ['allSpotComments'],
    queryFn: async () => {
      const results = await Promise.allSettled(
        publicSpots.slice(0, 30).map(s => base44.entities.SpotComment.filter({ spot_id: s.id }))
      );
      return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    },
    enabled: publicSpots.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const filteredSpots = useMemo(() => {
    let spots = cityFilter
      ? publicSpots.filter(s => s.city_name?.toLowerCase().includes(cityFilter.toLowerCase()) || s.country?.toLowerCase().includes(cityFilter.toLowerCase()))
      : publicSpots;

    // Score: ups from comments
    return [...spots].sort((a, b) => {
      const aComments = allComments.filter(c => c.spot_id === a.id);
      const bComments = allComments.filter(c => c.spot_id === b.id);
      const aScore = aComments.filter(c => c.thumb === 'up').length * 2 + aComments.length;
      const bScore = bComments.filter(c => c.thumb === 'up').length * 2 + bComments.length;
      return bScore - aScore;
    }).slice(0, 20);
  }, [publicSpots, allComments, cityFilter]);


  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
        <Input value={cityFilter} onChange={e => setCityFilter(e.target.value)}
          placeholder={t('explore.filterByCity')} className="pl-9 bg-card"/>
      </div>
      {filteredSpots.length === 0 ? (
        <EmptyFeed Icon={Star} title={t('explore.empty.topSpotsTitle')} subtitle={t('explore.empty.topSpotsSub')}/>
      ) : (
        <div className="space-y-3">
          {filteredSpots.map((spot, idx) => {
            const comments = allComments.filter(c => c.spot_id === spot.id);
            const ups = comments.filter(c => c.thumb === 'up').length;
            const profile = profileMap[spot.created_by_user_id];
            const isOwn = currentUser?.id === spot.created_by_user_id;
            return (
              <div key={spot.id} className="bg-card border border-border rounded-2xl p-4 flex items-start gap-3 hover:shadow-sm transition-shadow">
                <div className={"w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 " +
                  (idx === 0 ? 'bg-amber-100 text-amber-700' : idx === 1 ? 'bg-secondary text-muted-foreground' : idx === 2 ? 'bg-orange-50 text-primary' : 'bg-secondary text-muted-foreground')}>
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm text-foreground">{spot.title}</p>
                    {(() => { const I = SPOT_TYPE_ICON[spot.type] || MapPin; return <I className="w-4 h-4 text-muted-foreground flex-shrink-0" />; })()}
                  </div>
                  {(spot.city_name || spot.country) && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3"/>{[spot.city_name, spot.country].filter(Boolean).join(', ')}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {ups > 0 && <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">👍 {ups}</span>}
                    {comments.length > 0 && <span className="text-xs text-muted-foreground">💬 {comments.length}</span>}
                    {profile && <span className="text-xs text-muted-foreground ml-auto">@{profile.username || profile.display_name}</span>}
                  </div>
                  {!isOwn && currentUser && (
                    <button onClick={() => onSave(spot)} disabled={savingSpotId === spot.id}
                      className="mt-2 text-xs text-primary font-medium hover:underline flex items-center gap-1">
                      <Bookmark className="w-3 h-3"/>{savingSpotId === spot.id ? t('explore.saving') : t('common.save')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyFeed({ Icon = MapPin, title, subtitle }) {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <Icon className="w-12 h-12 mx-auto mb-3 text-border" strokeWidth={1.5} />
      <p className="font-semibold text-foreground">{title}</p>
      <p className="text-sm mt-1 max-w-xs mx-auto">{subtitle}</p>
    </div>
  );
}

export default function Explore() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [spotSearch, setSpotSearch] = useState('');
  const [spotCity, setSpotCity] = useState('');
  const [spotTag, setSpotTag] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [savingSpotId, setSavingSpotId] = useState(null);

  const { data: publicSpots = [], isLoading: loadingSpots } = useQuery({
    queryKey: ['spotsPublic'],
    queryFn: () => base44.entities.Spot.filter({ visibility: 'public' }),
    staleTime: 3 * 60 * 1000,
  });

  const { data: publicTemplates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ['templatesPublic'],
    queryFn: () => base44.entities.ItineraryTemplate.filter({ visibility: 'public' }, '-created_date'),
    staleTime: 10 * 60 * 1000,
  });

  // UserProfile.read se cerró en el rls (exponía email/nationality de todo
  // el mundo) — este es el caso real de "descubrimiento abierto" (explorar
  // comunidad), así que se lee vía función backend sin email ni nationality
  // — solo los campos que esta pantalla ya pintaba (username, display_name,
  // avatar, home_country) — ver src/lib/userProfiles.js.
  const { data: allProfiles = [] } = useQuery({
    queryKey: ['allProfiles'],
    queryFn: () => searchUserProfiles({}),
    staleTime: 10 * 60 * 1000,
  });

  const { data: myFollows = [] } = useQuery({
    queryKey: ['myFollows', currentUser?.id],
    queryFn: () => base44.entities.Follow.filter({ follower_user_id: currentUser.id }),
    enabled: !!currentUser?.id, staleTime: 60000,
  });

  const { data: myTrips = [] } = useQuery({
    queryKey: ['myTrips', currentUser?.id],
    queryFn: () => base44.entities.Trip.filter({ created_by: currentUser.email }),
    enabled: !!currentUser?.email, staleTime: 60000,
  });

  const followedUserIds = myFollows.map(f => f.followed_user_id);
  const myDestinations = [...new Set(myTrips.flatMap(t => [t.country, t.destination]).filter(Boolean))];

  const profileMap = useMemo(() => {
    const m = {};
    allProfiles.forEach(p => { m[p.user_id] = p; });
    return m;
  }, [allProfiles]);

  // Algoritmo de ranking de spots:
  // 1. De seguidos
  // 2. Mismo destino que mis viajes
  // 3. Por popularidad (saves_count)
  const rankedSpots = useMemo(() => {
    return [...publicSpots].sort((a, b) => {
      const aFollowed = followedUserIds.includes(a.created_by_user_id) ? 3 : 0;
      const bFollowed = followedUserIds.includes(b.created_by_user_id) ? 3 : 0;
      const aDestination = myDestinations.some(d => d && (a.country?.toLowerCase().includes(d.toLowerCase()) || a.city_name?.toLowerCase().includes(d.toLowerCase()))) ? 2 : 0;
      const bDestination = myDestinations.some(d => d && (b.country?.toLowerCase().includes(d.toLowerCase()) || b.city_name?.toLowerCase().includes(d.toLowerCase()))) ? 2 : 0;
      const aScore = aFollowed + aDestination + Math.min(a.saves_count || 0, 5);
      const bScore = bFollowed + bDestination + Math.min(b.saves_count || 0, 5);
      return bScore - aScore;
    });
  }, [publicSpots, followedUserIds, myDestinations]);

  // Filtrado de spots
  const filteredSpots = useMemo(() => {
    const q = spotSearch.toLowerCase().trim();
    const c = spotCity.toLowerCase().trim();
    const t = spotTag.toLowerCase().trim();
    return rankedSpots.filter(s => {
      const matchQ = !q || s.title?.toLowerCase().includes(q) || s.notes?.toLowerCase().includes(q);
      const matchC = !c || s.city_name?.toLowerCase().includes(c) || s.country?.toLowerCase().includes(c);
      const matchT = !t || s.tags?.some(tag => tag.toLowerCase().includes(t));
      return matchQ && matchC && matchT;
    });
  }, [rankedSpots, spotSearch, spotCity, spotTag]);

  const siguiendoSpots = useMemo(() =>
    publicSpots.filter(s => followedUserIds.includes(s.created_by_user_id)),
    [publicSpots, followedUserIds]
  );
  const siguiendoTemplates = useMemo(() =>
    publicTemplates.filter(t => followedUserIds.includes(t.created_by_user_id)),
    [publicTemplates, followedUserIds]
  );

  const filteredProfiles = useMemo(() => {
    const q = peopleQuery.toLowerCase().trim();
    return allProfiles.filter(p =>
      p.user_id !== currentUser?.id && (!q ||
        p.display_name?.toLowerCase().includes(q) ||
        p.username?.toLowerCase().includes(q) ||
        p.home_country?.toLowerCase().includes(q))
    ).sort((a, b) => {
      const aF = followedUserIds.includes(a.user_id) ? 0 : 1;
      const bF = followedUserIds.includes(b.user_id) ? 0 : 1;
      return aF - bF;
    });
  }, [allProfiles, peopleQuery, currentUser?.id, followedUserIds]);

  const followMutation = useMutation({
    mutationFn: async ({ profile, followRecord }) => {
      if (followRecord) await base44.entities.Follow.delete(followRecord.id);
      else await base44.entities.Follow.create({ follower_user_id: currentUser.id, followed_user_id: profile.user_id });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myFollows', currentUser?.id] }),
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const saveSpotMutation = useMutation({
    mutationFn: spot => base44.entities.SavedSpot.create({
      user_id: currentUser.id, folder: 'General',
      title: spot.title, type: spot.type,
      address: spot.address||'', city_name: spot.city_name||'', country: spot.country||'',
      lat: spot.lat, lng: spot.lng, notes: spot.notes||'', image_url: spot.image_url||'',
      source_spot_id: spot.id, source_user_id: spot.created_by_user_id,
      source_username: profileMap[spot.created_by_user_id]?.username || '',
      source_display_name: profileMap[spot.created_by_user_id]?.display_name || '',
      tags: spot.tags || [],
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['savedSpots', currentUser?.id] }); },
  
    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const handleSaveSpot = async spot => { setSavingSpotId(spot.id); try { await saveSpotMutation.mutateAsync(spot); } finally { setSavingSpotId(null); } };
  // mutateAsync (no mutate): UserCard espera esta promesa para mantener su
  // botón deshabilitado mientras la mutación está en curso — con mutate()
  // (fire-and-forget) el guard local se liberaba antes de que terminase la
  // llamada real, dejando la ventana de doble-tap abierta igual.
  const handleFollow = (profile, followRecord) => followMutation.mutateAsync({ profile, followRecord });

  const activeFilters = [spotSearch, spotCity, spotTag].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="bg-background pt-12 pb-6 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-foreground text-4xl font-bold mb-1">{t('explore.title')}</h1>
          <p className="text-muted-foreground text-sm mb-4">{t('explore.subtitle')}</p>
          <button onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-3 bg-secondary hover:bg-secondary/70 transition-colors rounded-xl px-4 py-3 text-muted-foreground text-sm border border-border">
            <Search className="w-4 h-4 flex-shrink-0"/>
            <span>{t('explore.searchCta')}</span>
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        <Tabs defaultValue="explorar">
          <TabsList className="w-full mb-5 bg-card border border-border">
            <TabsTrigger value="explorar" className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-white">
              <Globe className="w-4 h-4 mr-1"/>{t('explore.tabs.explore')}
            </TabsTrigger>
            {/* Pestañas "Siguiendo" y "Personas" ocultadas a petición de José:
                la funcionalidad de Follow está conectada y funciona (probado con
                una cuenta real), pero no hay ningún sitio de la app que muestre
                seguidores/seguidos ni haga nada visible con esa relación todavía
                — sin "Personas" (de donde salía el único botón de Seguir),
                "Siguiendo" quedaría siempre vacía, así que se oculta también.
                Hasta que se lance "Kodo Social" distrae más que aporta.
                Reversible: basta con descomentar este TabsTrigger, el de
                "personas" y sus TabsContent de más abajo. */}
            <TabsTrigger value="top" className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-white">
              <Star className="w-4 h-4 mr-1"/>{t('explore.tabs.top')}
            </TabsTrigger>
          </TabsList>

          {/* ── EXPLORAR ──────────────────────────────────────────────────── */}
          <TabsContent value="explorar">
            {/* Filtros de spots */}
            <div className="bg-card rounded-2xl border border-border p-4 mb-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('explore.filterSpots')}</p>
                {activeFilters > 0 && (
                  <button onClick={() => { setSpotSearch(''); setSpotCity(''); setSpotTag(''); }}
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    <X className="w-3 h-3"/>{t('explore.clear')}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t('common.search')}</label>
                  <Input value={spotSearch} onChange={e => setSpotSearch(e.target.value)}
                    placeholder={t('explore.ph.search')} className="h-8 text-xs"/>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t('explore.cityCountry')}</label>
                  <Input value={spotCity} onChange={e => setSpotCity(e.target.value)}
                    placeholder={t('explore.ph.city')} className="h-8 text-xs"/>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t('explore.tag')}</label>
                  <Input value={spotTag} onChange={e => setSpotTag(e.target.value)}
                    placeholder={t('explore.ph.tag')} className="h-8 text-xs"/>
                </div>
              </div>
            </div>

            {/* Spots */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Compass className="w-4 h-4 text-primary"/>
                <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide">{t('spots.title')}</h2>
                <Badge variant="secondary" className="ml-auto">{filteredSpots.length}</Badge>
              </div>
              {loadingSpots ? (
                <div className="grid grid-cols-2 gap-3">{[1,2,3,4].map(i => <div key={i} className="h-40 bg-card rounded-2xl border border-border animate-pulse"/>)}</div>
              ) : filteredSpots.length === 0 ? (
                <EmptyFeed Icon={MapPin} title={t('explore.empty.noSpots')} subtitle={activeFilters > 0 ? t('explore.empty.changeFilters') : t('explore.empty.firstSpot')}/>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredSpots.slice(0,12).map(spot => (
                    <FeedSpotCard key={spot.id} spot={spot} profile={profileMap[spot.created_by_user_id]}
                      currentUser={currentUser} onSave={handleSaveSpot} saving={savingSpotId===spot.id}/>
                  ))}
                </div>
              )}
            </div>

            {/* Itinerarios */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Globe className="w-4 h-4 text-primary"/>
                <h2 className="font-semibold text-foreground text-sm uppercase tracking-wide">{t('explore.search.itineraries')}</h2>
                <Badge variant="secondary" className="ml-auto">{publicTemplates.length}</Badge>
              </div>
              {loadingTemplates ? (
                <div className="grid grid-cols-2 gap-3">{[1,2].map(i => <div key={i} className="h-48 bg-card rounded-2xl border border-border animate-pulse"/>)}</div>
              ) : publicTemplates.length === 0 ? (
                <EmptyFeed Icon={Map} title={t('explore.empty.noItinerariesTitle')} subtitle={t('explore.empty.noItinerariesSub')}/>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {publicTemplates.slice(0,6).map(t => <TemplateCard key={t.id} template={t} currentUser={currentUser}/>)}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── SIGUIENDO ─────────────────────────────────────────────────── */}
          <TabsContent value="siguiendo">
            {followedUserIds.length === 0 ? (
              <EmptyFeed Icon={Users} title={t('explore.empty.noFollowsTitle')} subtitle={t('explore.empty.noFollowsSub')}/>
            ) : (siguiendoSpots.length + siguiendoTemplates.length) === 0 ? (
              <EmptyFeed Icon={Sparkles} title={t('explore.empty.noContentTitle')} subtitle={t('explore.empty.noContentSub')}/>
            ) : (
              <div className="space-y-8">
                {siguiendoSpots.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <Compass className="w-4 h-4 text-primary"/>
                      <h2 className="font-semibold text-sm uppercase tracking-wide text-foreground">{t('spots.title')}</h2>
                      <Badge variant="secondary" className="ml-auto">{siguiendoSpots.length}</Badge>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {siguiendoSpots.map(spot => (
                        <FeedSpotCard key={spot.id} spot={spot} profile={profileMap[spot.created_by_user_id]}
                          currentUser={currentUser} onSave={handleSaveSpot} saving={savingSpotId===spot.id}/>
                      ))}
                    </div>
                  </div>
                )}
                {siguiendoTemplates.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <Globe className="w-4 h-4 text-primary"/>
                      <h2 className="font-semibold text-sm uppercase tracking-wide text-foreground">{t('explore.search.itineraries')}</h2>
                      <Badge variant="secondary" className="ml-auto">{siguiendoTemplates.length}</Badge>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {siguiendoTemplates.map(t => <TemplateCard key={t.id} template={t} currentUser={currentUser}/>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── PERSONAS (oculta, ver comentario junto al TabsTrigger de arriba) ──
          <TabsContent value="personas">
            <div className="relative mb-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
              <Input placeholder={t('explore.ph.people')} value={peopleQuery}
                onChange={e => setPeopleQuery(e.target.value)} className="pl-9 bg-card"/>
            </div>
            {filteredProfiles.length === 0 ? (
              <EmptyFeed Icon={Search} title={peopleQuery ? t('common.noResults') : t('explore.empty.noTravelersTitle')}
                subtitle={peopleQuery ? t('explore.empty.tryOtherName') : t('explore.empty.beFirst')}/>
            ) : (
              <div className="space-y-3">
                {filteredProfiles.map(profile => (
                  <UserCard key={profile.user_id} profile={profile} currentUser={currentUser}
                    myFollows={myFollows} onFollow={handleFollow}/>
                ))}
              </div>
            )}
          </TabsContent>
          */}

          <TabsContent value="top">
            <TopSpotsTab publicSpots={publicSpots} profileMap={profileMap} currentUser={currentUser} onSave={handleSaveSpot} savingSpotId={savingSpotId}/>
          </TabsContent>
        </Tabs>
      </div>
      <CommunitySearch open={searchOpen} onOpenChange={setSearchOpen}/>
    </div>
  );
}