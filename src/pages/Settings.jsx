import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import DarkModeToggle from '@/components/DarkModeToggle';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Loader2, Camera, ChevronRight } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeUsername, validateUsername, checkUsernameAvailability } from '@/lib/username';
import { syncTripMembers } from '@/lib/syncTripMembers';
import { leaveTrip } from '@/lib/tripMembers';
import { getCountryMeta, getCountryLabel, normalizeCountry, getOriginCountryOptions } from '@/lib/countryConfig';
import { useTranslation } from 'react-i18next';
import { setLanguage, getLanguage } from '@/i18n/index.js';
import FeedbackModal from '@/components/settings/FeedbackModal';
import { toast } from '@/components/ui/use-toast';
import { normalizeEmail } from '@/lib/utils';
import { checkUpload, convertHeicIfNeeded } from '@/lib/uploadLimits';

function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = getLanguage();

  const handleChange = (lang) => {
    setLanguage(lang);
  };

  return (
    <div className="flex items-center justify-between px-4 py-4">
      <div>
        <p className="text-sm font-medium text-foreground">{t('settings.language')}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t('settings.languageSub')}</p>
      </div>
      <div className="flex items-center gap-1 bg-secondary rounded-full p-1">
        <button
          onClick={() => handleChange('es')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
            current === 'es' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
          }`}
        >
          ES
        </button>
        <button
          onClick={() => handleChange('en')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
            current === 'en' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
          }`}
        >
          EN
        </button>
      </div>
    </div>
  );
}

const CURRENCIES = ['EUR','USD','MXN','COP','ARS','CLP','GBP','JPY','BRL','PEN','CHF','AUD','CAD'].map(name => {
  const meta = getCountryMeta(name);
  return { name, flag: meta.flag || '\ud83c\udf0d', currency: meta.currency || 'USD' };
}).sort((a, b) => a.name.localeCompare(b.name, 'es'));

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-primary' : 'bg-border'}`}
    >
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-background shadow transition-all ${value ? 'left-5' : 'left-1'}`} />
    </button>
  );
}

function SettingRow({ label, sublabel, right, onClick, isLast = false }) {
  const inner = (
    <div className={`flex items-center justify-between px-4 py-3.5 ${!isLast ? 'border-b border-border' : ''} ${onClick ? 'hover:bg-secondary/30 transition-colors cursor-pointer' : ''}`}
      onClick={onClick}>
      <div className="flex-1 min-w-0 mr-3">
        <p className="text-sm text-foreground">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>}
      </div>
      {right}
    </div>
  );
  return inner;
}

function PasswordSection({ user }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const handleSave = async () => {
    if (!current || !next || !repeat) { setMsg({ type:'error', text:t('settings.pwd.fillAll') }); return; }
    if (next !== repeat) { setMsg({ type:'error', text:t('settings.pwd.mismatch') }); return; }
    if (next.length < 8) { setMsg({ type:'error', text:t('settings.pwd.min8') }); return; }
    setSaving(true);
    try {
      await base44.auth.changePassword({ currentPassword: current, newPassword: next });
      setMsg({ type:'ok', text:t('settings.pwd.updated') });
      setCurrent(''); setNext(''); setRepeat('');
      setTimeout(() => { setOpen(false); setMsg(null); }, 1500);
    } catch {
      setMsg({ type:'error', text:t('settings.pwd.wrongCurrent') });
    } finally { setSaving(false); }
  };

  if (!open) return (
    <SettingRow label={t('settings.pwd.change')} isLast
      right={<ChevronRight className="w-3 h-3 text-muted-foreground" />}
      onClick={() => setOpen(true)} />
  );

  return (
    <div className="border-t border-border">
      <div className="px-4 py-3 space-y-3">
        {[t('settings.pwd.current'), t('settings.pwd.new'), t('settings.pwd.repeat')].map((label, i) => {
          const val = i === 0 ? current : i === 1 ? next : repeat;
          const setVal = i === 0 ? setCurrent : i === 1 ? setNext : setRepeat;
          return (
            <div key={label}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <input type="password" value={val} onChange={e => setVal(e.target.value)} aria-label={t('settings.pwd.new')} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary" />
            </div>
          );
        })}
        {msg && <p className={`text-xs ${msg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</p>}
        <div className="flex gap-2">
          <button onClick={() => setOpen(false)} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-muted-foreground">{t('common.cancel')}</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 bg-primary text-white rounded-full text-sm font-medium disabled:opacity-40">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteAccountRow({ user, profile }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  if (!confirm) return (
    <SettingRow label={<span className="text-muted-foreground text-sm">{t('settings.deleteAccount')}</span>} isLast onClick={() => setConfirm(true)} />
  );

  const handleDelete = async () => {
    if (!user?.email || !user?.id) return;
    setDeleting(true);
    setError('');
    try {
      const anonEmail = `deleted-${user.id}@kodo.invalid`;
      const myEmail = normalizeEmail(user.email);

      const trips = await base44.entities.Trip.filter({ members: { $elemMatch: { $eq: myEmail } } });

      await Promise.all(trips.map(async trip => {
        const tripId = trip.id;

        const expenses = await base44.entities.Expense.filter({ trip_id: tripId });
        await Promise.all(expenses.map(async e => {
          const touchesUser = normalizeEmail(e.paid_by) === myEmail
            || (e.split_with || []).some(em => normalizeEmail(em) === myEmail)
            || Object.keys(e.amounts_by_user || {}).some(em => normalizeEmail(em) === myEmail);
          if (!touchesUser) return;
          const patch = {};
          if (normalizeEmail(e.paid_by) === myEmail) patch.paid_by = anonEmail;
          if ((e.split_with || []).some(em => normalizeEmail(em) === myEmail)) {
            patch.split_with = e.split_with.map(em => normalizeEmail(em) === myEmail ? anonEmail : em);
          }
          const amtKey = Object.keys(e.amounts_by_user || {}).find(em => normalizeEmail(em) === myEmail);
          if (amtKey) {
            const { [amtKey]: myAmt, ...rest } = e.amounts_by_user;
            patch.amounts_by_user = { ...rest, [anonEmail]: myAmt };
          }
          await base44.entities.Expense.update(e.id, patch);
        }));

        const spots = await base44.entities.Spot.filter({ trip_id: tripId, created_by: myEmail });
        await Promise.all(spots.map(async s => {
          if (s.visibility === 'personal') {
            await base44.entities.Spot.delete(s.id);
          } else {
            await base44.entities.Spot.update(s.id, {
              created_by: anonEmail,
              created_by_user_id: null,
              creator_username: null,
              creator_avatar: null,
            });
          }
        }));

        const messages = await base44.entities.TripMessage.filter({ trip_id: tripId, user_id: user.id });
        await Promise.all(messages.map(m => base44.entities.TripMessage.update(m.id, {
          user_email: anonEmail,
          display_name: null,
          avatar_url: null,
        })));

        const tickets = await base44.entities.Ticket.filter({ trip_id: tripId, user_id: user.id });
        await Promise.all(tickets.map(async doc => {
          if ((doc.visibility || 'personal') === 'personal') {
            await base44.entities.Ticket.delete(doc.id);
          } else {
            await base44.entities.Ticket.update(doc.id, { user_id: null });
          }
        }));

        const packing = await base44.entities.PackingItem.filter({ trip_id: tripId, user_id: user.id });
        await Promise.all(packing.map(p => base44.entities.PackingItem.delete(p.id)));
      }));

      const [saved, notifications, likes, comments] = await Promise.all([
        base44.entities.SavedSpot.filter({ user_id: user.id }),
        base44.entities.Notification.filter({ user_id: user.id }),
        base44.entities.Like.filter({ user_id: user.id }),
        base44.entities.SpotComment.filter({ user_id: user.id }),
      ]);
      await Promise.all([
        ...saved.map(s => base44.entities.SavedSpot.delete(s.id)),
        ...notifications.map(n => base44.entities.Notification.delete(n.id)),
        ...likes.map(l => base44.entities.Like.delete(l.id)),
        ...comments.map(c => base44.entities.SpotComment.delete(c.id)),
      ]);

      await Promise.all(trips.map(async trip => {
        const updated = await leaveTrip(trip.id);
        await syncTripMembers(trip.id, updated?.members || []);
      }));

      if (profile?.id) {
        await base44.entities.UserProfile.delete(profile.id);
      }

      logout();
    } catch (e) {
      setDeleting(false);
      setError(e?.message || t('common.tryAgain'));
    }
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <p className="text-xs text-red-500">{t('settings.delete.confirm')}</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setConfirm(false)} disabled={deleting} className="flex-1 py-2 border border-border rounded-xl text-xs text-muted-foreground disabled:opacity-50">{t('common.cancel')}</button>
        <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2 bg-red-500 text-white rounded-xl text-xs font-medium disabled:opacity-50">
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : t('settings.delete.yes')}
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const COUNTRIES = useMemo(() => getOriginCountryOptions(i18n.language).map(o => {
    const m = getCountryMeta(o.value) || {};
    return { name: o.value, label: o.label, flag: m.flag || '\ud83c\udf0d', currency: m.currency || 'USD' };
  }), [i18n.language]);
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername]       = useState('');
  const [homeCountry, setHomeCountry] = useState('Espa\u00f1a');
  const [homeCurrency, setHomeCurrency] = useState('EUR');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [usernameAvailable, setUsernameAvailable] = useState(null);

  const [secondNationality, setSecondNationality] = useState('');
  const [secondNatQuery, setSecondNatQuery] = useState('');
  const [showSecondNatList, setShowSecondNatList] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [spotsPublic,   setSpotsPublic]   = useState(false);

  const avatarInputRef = useRef(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['myProfile', user?.id],
    queryFn: async () => {
      const r = await base44.entities.UserProfile.filter({ user_id: user.id });
      return r[0] || null;
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || '');
      setUsername(profile.username || '');
      setHomeCountry(profile.home_country || 'Espa\u00f1a');
      setSecondNationality(profile.second_nationality || '');
      setHomeCurrency(profile.home_currency || 'EUR');
      setNotifEnabled(profile.notif_enabled !== false);
      setSpotsPublic(profile.spots_public_default === true);
    }
  }, [profile]);

  useEffect(() => {
    if (!username || username === profile?.username) { setUsernameAvailable(null); return; }
    const err = validateUsername(username);
    if (err) { setUsernameAvailable(false); return; }
    const timer = setTimeout(async () => {
      const ok = await checkUsernameAvailability(username, user?.id);
      setUsernameAvailable(ok);
    }, 600);
    return () => clearTimeout(timer);
  }, [username, profile?.username, user?.id]);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const handleAvatarUpload = async (file) => {
    if (!file || !profile || uploadingAvatar) return;
    const chk = checkUpload(file);
    if (!chk.ok) {
      toast({
        title: chk.reason === 'size' ? t('upload.tooLarge') : t('upload.notImage'),
        description: chk.reason === 'size' ? t('upload.maxMb', { mb: chk.maxMb }) : undefined,
        variant: 'destructive',
      });
      return;
    }
    setUploadingAvatar(true);
    try {
      const uploadFile = await convertHeicIfNeeded(file);
      const result = await base44.functions.invoke('uploadPublicFile', { file: uploadFile });
      const data = result?.data ?? result;
      if (data?.error) throw new Error(data.error);
      const { file_url } = data;
      await base44.entities.UserProfile.update(profile.id, { avatar_url: file_url });
      queryClient.invalidateQueries({ queryKey: ['myProfile', user?.id] });
    } catch {
      toast({ title: t('common.error'), description: t('common.tryAgain'), variant: 'destructive' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    if (!displayName.trim()) { setSaveMsg({ type:'error', text:t('settings.errors.nameEmpty') }); return; }
    const usernameErr = validateUsername(username);
    if (usernameErr) { setSaveMsg({ type:'error', text: t(`common.usernameErrors.${usernameErr}`) }); return; }
    if (username !== profile?.username) {
      const stillAvailable = await checkUsernameAvailability(username, user?.id);
      if (!stillAvailable) {
        setUsernameAvailable(false);
        setSaveMsg({ type:'error', text:t('settings.errors.usernameTaken') });
        return;
      }
    }
    setSaving(true);
    try {
      await base44.entities.UserProfile.update(profile.id, {
        email: (user.email || '').toLowerCase(),
        display_name: displayName.trim(),
        username,
        username_normalized: username.toLowerCase(),
        home_country: homeCountry,
        second_nationality: secondNationality || null,
        home_currency: homeCurrency,
        notif_enabled: notifEnabled,
        spots_public_default: spotsPublic,
      });
      queryClient.invalidateQueries({ queryKey: ['myProfile', user?.id] });
      setSaveMsg({ type:'ok', text:t('settings.errors.saved') });
      setTimeout(() => setSaveMsg(null), 2000);
    } catch {
      setSaveMsg({ type:'error', text:t('settings.errors.saveError') });
    } finally { setSaving(false); }
  };

  useEffect(() => { window.scrollTo(0, 0); }, []);

  if (!user || !profile) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  const countryMeta = getCountryMeta(homeCountry);

  return (
    <div className="bg-background min-h-screen">

      <div className="bg-background sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-0">
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('Profile')}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
              {t('settings.backProfile')}
            </Link>
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-4">{t('settings.heading')}</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-5 pb-24 space-y-5">

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">{t('settings.sectionProfile')}</p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">

          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-full overflow-hidden border border-border flex items-center justify-center bg-primary text-white text-lg font-medium">
                {profile.avatar_url
                  ? <img src={profile.avatar_url} alt={displayName} className="w-full h-full object-cover"/>
                  : displayName[0]?.toUpperCase() || '?'
                }
              </div>
              <button onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar}
                className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-primary border-2 border-white flex items-center justify-center disabled:opacity-60">
                {uploadingAvatar
                  ? <Loader2 className="w-2.5 h-2.5 text-white animate-spin" />
                  : <Camera className="w-2.5 h-2.5 text-white" />}
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{displayName}</p>
              <button onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar}
                className="text-xs text-primary font-medium disabled:opacity-60">
                {uploadingAvatar ? t('common.loading') : t('settings.changePhoto')}
              </button>
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files?.[0] && handleAvatarUpload(e.target.files[0])} />
          </div>

          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-1.5">{t('settings.name')}</p>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} aria-label={t('settings.nameAria')} placeholder={t('settings.namePlaceholder')}
              className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary" />
          </div>

          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-1.5">{t('settings.username')}</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
              <input value={username} onChange={e => setUsername(normalizeUsername(e.target.value))} aria-label={t('settings.usernameAria')} placeholder={t('settings.usernamePlaceholder')}
                className="w-full h-10 border border-border rounded-xl pl-7 pr-9 text-sm outline-none focus:border-primary bg-secondary" />
              {username && username !== profile.username && usernameAvailable !== null && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
                  {usernameAvailable ? t('settings.available') : t('settings.unavailable')}
                </span>
              )}
            </div>
          </div>

        </div>

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">{t('settings.appearance')}</p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">{t('settings.darkMode')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('settings.darkModeSub')}</p>
            </div>
            <DarkModeToggle />
          </div>
          <LanguageSwitcher />
        </div>

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">{t('settings.preferences')}</p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-1.5">{t('settings.homeCountry')} <span className="text-muted-foreground/60">{t('settings.homeCountrySub')}</span></p>
            <select value={normalizeCountry(homeCountry)} onChange={e => {
              const c = COUNTRIES.find(x => x.name === e.target.value) || COUNTRIES[0];
              setHomeCountry(c.name); setHomeCurrency(c.currency);
            }} className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary appearance-none">
              {COUNTRIES.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
            </select>
          </div>
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-1.5">{t('settings.secondNat')} <span className="text-muted-foreground/60">{t('settings.secondNatSub')}</span></p>
            <div className="relative">
              <input
                type="text"
                placeholder={t('settings.searchCountry')}
                value={showSecondNatList ? secondNatQuery : secondNationality || ''}
                onChange={e => { setSecondNatQuery(e.target.value); setShowSecondNatList(true); }}
                onFocus={() => { setSecondNatQuery(''); setShowSecondNatList(true); }}
                onBlur={() => setTimeout(() => setShowSecondNatList(false), 150)}
                className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary"
              />
              {secondNationality && !showSecondNatList && (
                <button onClick={() => { setSecondNationality(''); setSecondNatQuery(''); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
              {showSecondNatList && (
                <div className="absolute top-full left-0 right-0 z-50 bg-card border border-border rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
                  <button className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
                    onMouseDown={() => { setSecondNationality(''); setSecondNatQuery(''); setShowSecondNatList(false); }}>
                    {t('settings.noSecondNat')}
                  </button>
                  {COUNTRIES.filter(c => {
                    if (!secondNatQuery) return true;
                    const q = secondNatQuery.toLowerCase();
                    return c.label.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
                  }).map(c => (
                    <button key={c.name}
                      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-secondary"
                      onMouseDown={() => { setSecondNationality(c.name); setSecondNatQuery(''); setShowSecondNatList(false); }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {secondNationality && (
              <p className="text-xs text-muted-foreground mt-1.5">{t('settings.secondNatHint', { country: getCountryLabel(normalizeCountry(secondNationality), i18n.language) })}</p>
            )}
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1.5">{t('settings.baseCurrency')} <span className="text-muted-foreground/60">{t('settings.baseCurrencySub')}</span></p>
            <select value={homeCurrency} onChange={e => setHomeCurrency(e.target.value)}
              className="w-full h-10 border border-border rounded-xl px-3 text-sm outline-none focus:border-primary bg-secondary appearance-none">
              {CURRENCIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">{t('settings.notifications')}</p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <SettingRow
            label={t('settings.notifEnabled')}
            sublabel={t('settings.notifEnabledSub')}
            right={<Toggle value={notifEnabled} onChange={setNotifEnabled} />}
            isLast
          />
        </div>

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">{t('settings.privacy')}</p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <SettingRow
            label={t('settings.spotsPublic')}
            sublabel={t('settings.spotsPublicSub')}
            right={<Toggle value={spotsPublic} onChange={setSpotsPublic} />}
            isLast
          />
        </div>

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">{t('settings.account')}</p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <SettingRow
            label={t('settings.email')}
            right={<span className="text-xs text-muted-foreground">{user.email}</span>}
          />
          <PasswordSection user={user} />
          <div className="border-t border-border">
            <button onClick={() => logout()}
              className="w-full text-left px-4 py-3.5 text-sm text-red-500 font-medium hover:bg-red-50 transition-colors border-b border-border">
              {t('settings.logout')}
            </button>
            <DeleteAccountRow user={user} profile={profile} />
          </div>
        </div>

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">{t('settings.help')}</p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <SettingRow
            label={t('settings.feedback')}
            sublabel={t('settings.feedbackSub')}
            onClick={() => setFeedbackOpen(true)}
            right={<ChevronRight className="w-3 h-3 text-muted-foreground" />}
          />
          <Link to={createPageUrl('Terms')} className="block">
            <SettingRow label={t('settings.terms')} right={<ChevronRight className="w-3 h-3 text-muted-foreground" />} />
          </Link>
          <Link to={createPageUrl('Privacy')} className="block">
            <SettingRow label={t('settings.privacyPolicy')} isLast right={<ChevronRight className="w-3 h-3 text-muted-foreground" />} />
          </Link>
        </div>

      </div>
      <div className="px-4 pt-2 pb-8">
        {saveMsg && (
          <p className={`text-xs text-center mb-2 ${saveMsg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{saveMsg.text}</p>
        )}
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 bg-primary text-white rounded-full text-sm font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('settings.saveChanges')}
        </button>
      </div>

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        userEmail={user?.email || ''}
        userName={displayName || profile?.display_name || ''}
      />
    </div>
  );
}
