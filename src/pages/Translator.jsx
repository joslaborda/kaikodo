import { createPageUrl } from '@/utils';
import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRightLeft, Copy, Check, Volume2, Loader2, AlertCircle, WifiOff } from 'lucide-react';
import { getCountryMeta, getLanguageLabel, getCountryLabel } from '@/lib/countryConfig';
import { useTripContext } from '@/hooks/useTripContext';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Link } from 'react-router-dom';
import OTabBar from '@/components/trip/OTabBar';
import { useTranslation } from 'react-i18next';

// ── Languages ─────────────────────────────────────────────────────────────────
const LANGUAGES = [
  { code:'es', bcp:'es-ES', label:'Español',    flag:'🇪🇸' },
  { code:'en', bcp:'en-US', label:'Inglés',     flag:'🇬🇧' },
  { code:'ja', bcp:'ja-JP', label:'Japonés',    flag:'🇯🇵' },
  { code:'fr', bcp:'fr-FR', label:'Francés',    flag:'🇫🇷' },
  { code:'pt', bcp:'pt-BR', label:'Portugués',  flag:'🇧🇷' },
  { code:'de', bcp:'de-DE', label:'Alemán',     flag:'🇩🇪' },
  { code:'it', bcp:'it-IT', label:'Italiano',   flag:'🇮🇹' },
  { code:'zh', bcp:'zh-CN', label:'Chino',      flag:'🇨🇳' },
  { code:'ko', bcp:'ko-KR', label:'Coreano',    flag:'🇰🇷' },
  { code:'ar', bcp:'ar-SA', label:'Árabe',      flag:'🇸🇦' },
  { code:'th', bcp:'th-TH', label:'Tailandés',  flag:'🇹🇭' },
  { code:'vi', bcp:'vi-VN', label:'Vietnamita', flag:'🇻🇳' },
  { code:'id', bcp:'id-ID', label:'Indonesio',  flag:'🇮🇩' },
  { code:'tr', bcp:'tr-TR', label:'Turco',      flag:'🇹🇷' },
  { code:'ru', bcp:'ru-RU', label:'Ruso',       flag:'🇷🇺' },
  { code:'nl', bcp:'nl-NL', label:'Neerlandés', flag:'🇳🇱' },
  { code:'pl', bcp:'pl-PL', label:'Polaco',     flag:'🇵🇱' },
  { code:'hi', bcp:'hi-IN', label:'Hindi',      flag:'🇮🇳' },
  { code:'el', bcp:'el-GR', label:'Griego',     flag:'🇬🇷' },
  { code:'he', bcp:'he-IL', label:'Hebreo',     flag:'🇮🇱' },
  { code:'ms', bcp:'ms-MY', label:'Malayo',     flag:'🇲🇾' },
  { code:'tl', bcp:'tl-PH', label:'Filipino',   flag:'🇵🇭' },
];

const TABS = [
  { key: 'voz',      tk: 'translator.tabs.voz' },
  { key: 'texto',    tk: 'translator.tabs.texto' },
  { key: 'historial', tk: 'translator.tabs.historial' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function translateText(text, fromCode, toCode) {
  if (fromCode === toCode) return text;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromCode}|${toCode}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('Network error');
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(data.responseDetails || 'Error');
  return data.responseData.translatedText;
}

function speakText(text, bcpLang) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = bcpLang;
  utt.rate = 0.85;
  window.speechSynthesis.speak(utt);
}

// ── Lang selector row ─────────────────────────────────────────────────────────
function LangRow({ fromLang, toLang, onFromChange, onToChange, onSwap }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-1">
      <select
        value={fromLang}
        onChange={e => onFromChange(e.target.value)}
        className="flex-1 h-10 border border-border rounded-xl px-3 text-sm bg-card outline-none focus:border-primary appearance-none"
      >
        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {getLanguageLabel(l.code, i18n.language)}</option>)}
      </select>
      <button aria-label={t('translator.swapAria')}
        onClick={onSwap}
        className="p-2 rounded-xl border border-border bg-card hover:bg-secondary hover:border-primary/30 transition-colors flex-shrink-0"
      >
        <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
      </button>
      <select
        value={toLang}
        onChange={e => onToChange(e.target.value)}
        className="flex-1 h-10 border border-border rounded-xl px-3 text-sm bg-card outline-none focus:border-primary appearance-none"
      >
        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {getLanguageLabel(l.code, i18n.language)}</option>)}
      </select>
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({ original, translated, fromLang, toLang, onClear, onSave }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const fromL = LANGUAGES.find(l => l.code === fromLang) || LANGUAGES[0];
  const toL   = LANGUAGES.find(l => l.code === toLang)   || LANGUAGES[1];

  const copy = () => {
    navigator.clipboard?.writeText(translated);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      {original && (
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs text-muted-foreground mb-1">{fromL.flag} {t('translator.original')}</p>
          <p className="text-sm text-foreground">{original}</p>
        </div>
      )}
      {translated && (
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground mb-1">{toL.flag} {t('translator.result')}</p>
          <p className="text-base font-medium text-foreground">{translated}</p>
          <div className="flex gap-2 mt-3 flex-wrap">
            <button
              onClick={() => speakText(translated, toL.bcp)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border bg-secondary transition-colors"
            >
              <Volume2 className="w-3.5 h-3.5" />{t('translator.read')}
            </button>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-full border border-border bg-secondary transition-colors"
            >
              {copied ? <><Check className="w-3.5 h-3.5 text-green-500" />{t('translator.copied')}</> : <><Copy className="w-3.5 h-3.5" />{t('translator.copy')}</>}
            </button>
            {onSave && (
              <button
                onClick={onSave}
                className="flex items-center gap-1.5 text-xs text-primary px-3 py-1.5 rounded-full border border-orange-200 dark:border-orange-900/40 bg-orange-50 dark:bg-orange-950/30 transition-colors ml-auto"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z"/></svg>
                {t('common.save')}
              </button>
            )}
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-full border border-border bg-secondary transition-colors"
            >
              {t('translator.clear')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Voice tab ─────────────────────────────────────────────────────────────────
function VozTab({ fromLang, toLang, onSaveToHistory }) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [interim, setInterim]     = useState('');
  const [error, setError]         = useState('');
  const [result, setResult]       = useState({ original: '', translated: '' });
  const recognitionRef            = useRef(null);
  const fromL = LANGUAGES.find(l => l.code === fromLang) || LANGUAGES[0];
  const toL   = LANGUAGES.find(l => l.code === toLang)   || LANGUAGES[1];

  const pendingTextRef = useRef('');
  const interimRef = useRef('');

  const doTranslate = async (text) => {
    if (!text.trim()) return;
    try {
      if (fromLang === toLang) {
        setResult({ original: text, translated: text });
      } else {
        const translation = await translateText(text, fromL.code, toL.code);
        setResult({ original: text, translated: translation });
        if (translation) speakText(translation, toL.bcp);
      }
    } catch {
      setError(t('translator.errors.translate'));
    }
  };

  const toggleRecording = () => {
    // STOP: save what we have and translate
    if (recording) {
      const textToTranslate = (pendingTextRef.current || interimRef.current || '').trim();
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (textToTranslate) {
        doTranslate(textToTranslate);
        pendingTextRef.current = '';
      } else {
        setError(t('translator.errors.noText'));
      }
      return;
    }

    // START
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError(t('translator.errors.noMic'));
      return;
    }
    setError('');
    setResult({ original: '', translated: '' });
    setInterim('');
    pendingTextRef.current = '';

    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.lang = fromL.bcp;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => setRecording(true);

    recognition.onend = () => {
      recognitionRef.current = null;
      setRecording(false);
    };

    recognition.onerror = e => {
      recognitionRef.current = null;
      setRecording(false);
      if (e.error === 'not-allowed') setError(t('translator.errors.micDenied'));
      else if (e.error === 'no-speech') setError(t('translator.errors.noSpeech'));
      else if (e.error === 'aborted') return;
      else setError(t('translator.errors.recordError'));
    };

    recognition.onresult = e => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += seg;
        else interim += seg;
      }
      // accumulate finals
      if (final) pendingTextRef.current += ' ' + final;
      // show live what is being said
      const liveText = pendingTextRef.current + interim;
      interimRef.current = liveText;
      setInterim(liveText);
    };

    try { recognition.start(); }
    catch {
      recognitionRef.current = null;
      setRecording(false);
      setError(t('translator.errors.micStart'));
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Mic button */}
      <div
        onClick={toggleRecording}
        className={`rounded-2xl border-2 p-6 flex flex-col items-center gap-3 cursor-pointer select-none transition-all ${
          recording
            ? 'bg-primary border-primary'
            : 'bg-card border-border hover:border-primary/40'
        }`}
      >
        {recording ? (
          <>
            {/* Waveform */}
            <div className="flex items-end gap-1 h-6">
              {[5,9,14,9,5,12,8].map((h, i) => (
                <div
                  key={i}
                  className="w-1.5 bg-background rounded-full"
                  style={{ height: h, animation: `wave 0.7s ease-in-out ${i * 0.08}s infinite alternate` }}
                />
              ))}
            </div>
            {/* Stop icon */}
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
              <div className="w-6 h-6 bg-background rounded-md" />
            </div>
            <p className="text-sm font-medium text-white">{t('translator.voz.recording')}</p>
            {interim && (
              <p className="text-xs text-white/80 text-center max-w-xs leading-relaxed">{interim}</p>
            )}
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-full bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="2">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">{t('translator.voz.tapMic')}</p>
            <p className="text-xs text-muted-foreground">{fromL.flag} → {toL.flag} · {t('translator.voz.readsAloud')}</p>
          </>
        )}
        <style>{`@keyframes wave{from{opacity:.3}to{opacity:1}}`}</style>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-2xl px-4 py-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {(result.original || result.translated) && (
        <ResultCard
          original={result.original}
          translated={result.translated}
          fromLang={fromLang}
          toLang={toLang}
          onClear={() => setResult({ original: '', translated: '' })}
          onSave={() => onSaveToHistory({ original: result.original, translated: result.translated, fromLang, toLang })}
        />
      )}
    </div>
  );
}

// ── Texto tab ─────────────────────────────────────────────────────────────────
function TextoTab({ fromLang, toLang, onSaveToHistory }) {
  const { t, i18n } = useTranslation();
  const [input, setInput]       = useState('');
  const [result, setResult]     = useState({ original: '', translated: '' });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const fromL = LANGUAGES.find(l => l.code === fromLang) || LANGUAGES[0];
  const toL   = LANGUAGES.find(l => l.code === toLang)   || LANGUAGES[1];

  const translate = async () => {
    if (!input.trim()) return;
    setLoading(true); setError(''); setResult({ original: '', translated: '' });
    try {
      const tr = fromLang === toLang ? input : await translateText(input, fromLang, toLang);
      setResult({ original: input, translated: tr });
    } catch {
      setError(t('translator.errors.translate'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-4 pt-3 pb-1">
          <p className="text-xs text-muted-foreground mb-1.5">{fromL.flag} {getLanguageLabel(fromL.code, i18n.language)}</p>
          <textarea
            placeholder={t('translator.texto.placeholder', { lang: getLanguageLabel(fromL.code, i18n.language) })}
            value={input}
            onChange={e => { setInput(e.target.value); setResult({ original: '', translated: '' }); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); translate(); } }}
            rows={4}
            className="w-full text-sm resize-none outline-none text-foreground bg-transparent"
          />
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-secondary/30">
          {input
            ? <button onClick={() => { setInput(''); setResult({ original: '', translated: '' }); }} className="text-xs text-muted-foreground hover:text-foreground">{t('translator.texto.clearInput')}</button>
            : <span />
          }
          <div className="flex items-center gap-2">
            <button
              onClick={() => speakText(input, fromL.bcp)}
              disabled={!input.trim()}
              className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={translate}
              disabled={!input.trim() || loading}
              className="h-8 px-4 rounded-full bg-primary text-white text-xs font-medium disabled:opacity-40 hover:bg-primary/90 flex items-center gap-1.5 transition-colors"
            >
              {loading && <Loader2 className="w-3 h-3 animate-spin" />}
              {t('translator.translate')}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-2xl px-4 py-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {(result.original || result.translated) && (
        <ResultCard
          original={result.original}
          translated={result.translated}
          fromLang={fromLang}
          toLang={toLang}
          onClear={() => setResult({ original: '', translated: '' })}
          onSave={() => onSaveToHistory({ original: result.original, translated: result.translated, fromLang, toLang })}
        />
      )}
    </div>
  );
}

// ── Historial tab ─────────────────────────────────────────────────────────────
// Antes esta clave era fija para todo el navegador: si dos personas usaban
// Kōdo en el mismo dispositivo (móvil compartido, tablet familiar), el
// historial de traducción de una se mezclaba con el de la otra. Se sufija con
// el user.id para que cada persona tenga su propio historial local.
const HIST_KEY_BASE = 'kodo_translator_history';
function histKey(userId) { return userId ? `${HIST_KEY_BASE}_${userId}` : HIST_KEY_BASE; }

function loadHistory(userId) {
  try { return JSON.parse(localStorage.getItem(histKey(userId)) || '[]'); } catch { return []; }
}
function saveHistory(userId, h) {
  try { localStorage.setItem(histKey(userId), JSON.stringify(h.slice(0, 50))); } catch {}
}

function HistorialTab({ userId }) {
  const { t } = useTranslation();
  const [history, setHistory] = useState(() => loadHistory(userId));

  useEffect(() => { setHistory(loadHistory(userId)); }, [userId]);

  const toggle = (id) => {
    const next = history.map(h => h.id === id ? { ...h, saved: !h.saved } : h);
    setHistory(next); saveHistory(userId, next);
  };

  const clearAll = () => { setHistory([]); saveHistory(userId, []); };

  const saved   = history.filter(h => h.saved);
  const recent  = history.filter(h => !h.saved);

  const BookmarkIcon = ({ filled }) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'hsl(var(--primary))' : 'none'} stroke={filled ? 'hsl(var(--primary))' : '#d4cfc8'} strokeWidth="2">
      <path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z"/>
    </svg>
  );

  const HistItem = ({ item }) => {
    const fromL = LANGUAGES.find(l => l.code === item.fromLang) || LANGUAGES[0];
    const toL   = LANGUAGES.find(l => l.code === item.toLang)   || LANGUAGES[1];
    return (
      <div className="flex gap-3 items-start py-3 border-b border-border last:border-0">
        <button onClick={() => toggle(item.id)} className="flex-shrink-0 mt-0.5">
          <BookmarkIcon filled={item.saved} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground leading-snug mb-1">{item.original}</p>
          <p className="text-sm font-medium leading-snug" style={{ color: 'hsl(var(--primary))' }}>{item.translated}</p>
          <p className="text-xs text-muted-foreground mt-1.5">{fromL.flag} → {toL.flag} · {item.timeLabel}</p>
        </div>
        <button
          onClick={() => speakText(item.translated, toL.bcp)}
          className="flex-shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
        >
          <Volume2 className="w-4 h-4" />
        </button>
      </div>
    );
  };

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/50">
            <path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 20V4z"/>
          </svg>
        </div>
        <p className="text-sm font-medium text-foreground mb-1">{t('translator.hist.emptyTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('translator.hist.emptySubtitle')}</p>
      </div>
    );
  }

  return (
    <div>
      {saved.length > 0 && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden mb-4">
          <div className="flex items-end justify-between px-4 pt-4 pb-2 border-b border-border">
            <div>
              <div style={{ height: 3, width: 48, background: 'hsl(var(--primary))', borderRadius: 2, marginBottom: 4 }} />
              <p className="text-sm font-medium text-foreground">{t('translator.hist.saved')}</p>
            </div>
          </div>
          <div className="px-4">
            {saved.map(item => <HistItem key={item.id} item={item} />)}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex items-end justify-between px-4 pt-4 pb-2 border-b border-border">
            <div>
              <div style={{ height: 3, width: 30, background: 'hsl(var(--primary))', borderRadius: 2, marginBottom: 4 }} />
              <p className="text-sm font-medium text-foreground">{t('translator.hist.recent')}</p>
            </div>
            <button onClick={clearAll} className="text-xs" style={{ color: 'hsl(var(--primary))' }}>{t('translator.hist.clearAll')}</button>
          </div>
          <div className="px-4">
            {recent.map(item => <HistItem key={item.id} item={item} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────
function TranslatorContent({ tripId, inPage = false }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { trip, activeCity } = useTripContext(tripId);
  const countryRaw = activeCity?.country || trip?.country || '';
  const meta = getCountryMeta(countryRaw);
  const tripLangCode = meta.languageCode?.split('-')[0] || 'en';
  const tripLang = LANGUAGES.find(l => l.code === tripLangCode) ? tripLangCode : 'en';

  const { data: myProfile } = useQuery({
    queryKey: ['myProfile', user?.id],
    queryFn: async () => { const r = await base44.entities.UserProfile.filter({ user_id: user.id }); return r[0] || null; },
    enabled: !!user?.id, staleTime: 60000,
  });

  const homeCountry = myProfile?.home_country || 'España';
  const homeMeta = getCountryMeta(homeCountry);
  const homeLangCode = homeMeta.languageCode?.split('-')[0] || 'es';
  // Idioma de origen por defecto: el idioma de la app (elección explícita del
  // usuario). Si por lo que sea no está en la lista, se usa el país de origen.
  const uiLangCode = (i18n.language || 'es').split('-')[0];
  const userLang = LANGUAGES.find(l => l.code === uiLangCode)
    ? uiLangCode
    : (LANGUAGES.find(l => l.code === homeLangCode) ? homeLangCode : 'es');

  const [tab, setTab]         = useState('voz');
  const [fromLang, setFromLang] = useState(userLang);
  const [toLang, setToLang]   = useState(tripLang);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { setToLang(tripLang); }, [tripLang]);
  useEffect(() => { setFromLang(userLang); }, [userLang]);

  const isSameLang = homeLangCode === tripLangCode;

  const handleSwap = () => { setFromLang(toLang); setToLang(fromLang); };

  const handleSaveToHistory = useCallback(({ original, translated, fromLang: fl, toLang: tl }) => {
    const fromL = LANGUAGES.find(l => l.code === fl) || LANGUAGES[0];
    const toL   = LANGUAGES.find(l => l.code === tl) || LANGUAGES[1];
    const history = loadHistory(user?.id);
    const entry = {
      id: Date.now().toString(),
      original, translated,
      fromLang: fl, toLang: tl,
      saved: false,
      timeLabel: t('translator.now'),
    };
    const next = [entry, ...history];
    saveHistory(user?.id, next);
  }, [user?.id]);

  return (
    <>
      {isSameLang && !dismissed && (
        <div className={`${inPage ? 'mt-4' : 'mt-5'} bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/40 rounded-2xl p-4`}>
          <div className="flex items-start gap-3">

            <div className="flex-1">
              <p className="text-sm font-medium text-green-900 dark:text-green-300">{t('translator.sameLang.title')}</p>
              <p className="text-sm text-green-700 dark:text-green-400 mt-1 leading-relaxed">
                {t('translator.sameLang.body', { flag: meta.flag, country: getCountryLabel(countryRaw, i18n.language), language: getLanguageLabel(meta.languageCode, i18n.language) })}
              </p>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0 hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className={isSameLang && !dismissed ? 'mt-4' : inPage ? '' : 'mt-5'}>
        <OTabBar tabs={TABS.map(tb => ({ key: tb.key, label: t(tb.tk) }))} activeKey={tab} onChange={setTab} />
      </div>

      <div className="py-5 space-y-4">
        {/* Lang row for Voz and Texto tabs */}
        {(tab === 'voz' || tab === 'texto') && (
          <LangRow
            fromLang={fromLang}
            toLang={toLang}
            onFromChange={setFromLang}
            onToChange={setToLang}
            onSwap={handleSwap}
          />
        )}

        {tab === 'voz' && (
          <VozTab
            fromLang={fromLang}
            toLang={toLang}
            onSaveToHistory={handleSaveToHistory}
          />
        )}

        {tab === 'texto' && (
          <TextoTab
            fromLang={fromLang}
            toLang={toLang}
            onSaveToHistory={handleSaveToHistory}
          />
        )}

        {tab === 'historial' && <HistorialTab userId={user?.id} />}
      </div>
    </>
  );
}



// Export for Utilities embed
export function TranslatorPanel({ tripId }) {
  return <TranslatorContent tripId={tripId} />;
}

// Standalone page
export default function Translator() {
  const { t } = useTranslation();
  const urlParams = new URLSearchParams(window.location.search);
  const tripId = urlParams.get('trip_id');
  const { trip, activeCity } = useTripContext(tripId);
  const countryRaw = activeCity?.country || trip?.country || '';
  const meta = getCountryMeta(countryRaw);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="bg-background min-h-screen">
      {/* Header — unchanged */}
      <div className="bg-background sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-0">
          <div className="flex items-center justify-between mb-4">
            <Link to={createPageUrl('Home') + '?trip_id=' + tripId}>
              <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 5l-7 7 7 7"/>
                </svg>
                {t('translator.backHome')}
              </button>
            </Link>
            {countryRaw && (
              <span className="text-sm text-muted-foreground">{meta.flag} {countryRaw}</span>
            )}
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-4">{t('utilities.translator')}</h1>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-5 pb-24">
        {/* Offline banner */}
        {!navigator.onLine && (
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-2xl px-4 py-3 mb-4">
            <WifiOff className="w-4 h-4 text-amber-800 dark:text-amber-400 flex-shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-400 font-medium">{t('translator.offline')}</p>
          </div>
        )}
        <TranslatorContent tripId={tripId} inPage={true} />
      </div>
    </div>
  );
}