import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { BarChart2, Camera, Download, FileText, Image, MessageCircle, Send, X, WifiOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { parseServerDate } from '@/lib/parseServerDate';
import { MAX_FILE_BYTES, convertHeicIfNeeded } from '@/lib/uploadLimits';
import { notify, resolveUserIds } from '@/lib/notifications';
import { normalizeEmail } from '@/lib/utils';

export default
function ChatTab({ tripId, currentUserEmail, currentUserId, myProfile, tripMembers }) {
  const { t, i18n } = useTranslation();
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const fileInputRef = useRef(null);
  const fileInputType = useRef('all');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const queryClient = useQueryClient();
  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isFirstLoad = useRef(true);
  const lastMsgCount = useRef(0);

  const { data: messages = [] } = useQuery({
    queryKey: ['tripMessages', tripId],
    queryFn: () => base44.entities.TripMessage.filter({ trip_id: tripId }, 'created_date', 100),
    enabled: !!tripId,
    staleTime: 0,
    refetchInterval: 8000,
  });

  useEffect(() => {
    if (!messages.length) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const lastMsg = messages[messages.length - 1];
    const isMine = lastMsg && (lastMsg.user_id === currentUserId || lastMsg.user_email === currentUserEmail);
    if (isFirstLoad.current || (isMine && messages.length > lastMsgCount.current)) {
      const scrollToBottom = () => { container.scrollTop = container.scrollHeight; };
      scrollToBottom();
      requestAnimationFrame(scrollToBottom);
      const timeoutId = setTimeout(scrollToBottom, 150);
      isFirstLoad.current = false;
      lastMsgCount.current = messages.length;
      return () => clearTimeout(timeoutId);
    }
    lastMsgCount.current = messages.length;
  }, [messages]);

  const sendPoll = async () => {
    const opts = pollOptions.filter(o => o.trim());
    if (!pollQuestion.trim() || opts.length < 2) return;
    const pollData = { question: pollQuestion.trim(), options: opts.map(o => ({ text: o.trim(), votes: [] })) };
    await sendMutation.mutateAsync({ content: pollQuestion.trim(), file_type: 'poll', file_name: JSON.stringify(pollData) });
    setPollOpen(false); setPollQuestion(''); setPollOptions(['', '']);
  };

  const votePoll = async (msg, optionIdx) => {
    try {
      const result = await base44.functions.invoke('votePoll', { messageId: msg.id, optionIdx });
      const data = result?.data ?? result;
      if (data?.error) throw new Error(data.error);
      queryClient.invalidateQueries({ queryKey: ['tripMessages', tripId] });
    } catch {
      toast({ title: t('common.error'), description: t('common.tryAgain'), variant: 'destructive' });
    }
  };

  const sendMutation = useMutation({
    mutationFn: (payload) => {
      if (!tripMembers?.length) throw new Error(t('cities.tripNotLoadedRetry'));
      return base44.entities.TripMessage.create({
        trip_id: tripId,
        user_id: currentUserId,
        user_email: currentUserEmail,
        display_name: myProfile?.display_name || currentUserEmail,
        avatar_url: myProfile?.avatar_url || null,
        trip_members: tripMembers,
        ...payload,
      });
    },
    onSuccess: (_data, payload) => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['tripMessages', tripId] });
              const targets = (tripMembers || []).filter(e => normalizeEmail(e) !== normalizeEmail(currentUserEmail));
              if (targets.length) {
                          const preview = payload.content?.trim() || t('notifications.chatAttachmentFallback');
                          resolveUserIds(targets).then(resolved => {
                                        resolved.forEach(({ userId }) => notify({
                                                        userId,
                                                        type: 'chat_message',
                                                        tripId,
                                                        refTitle: preview,
                                        }));
                          });
              }
    },

    onError: (e) => toast({ title: t('common.saveError'), description: e?.message || t('common.tryAgain'), variant: 'destructive' }),
  });

  const handleUpload = async (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast({ title: t('chat.fileTooLarge'), description: t('chat.max20mb'), variant: 'destructive' }); return; }
    const isImage = file.type.startsWith('image/');
    const isAudio = file.type.startsWith('audio/');
    setUploading(true);
    setAttachOpen(false);
    try {
      const uploadFile = isImage ? await convertHeicIfNeeded(file) : file;
      const result = await base44.functions.invoke('uploadPublicFile', { file: uploadFile });
      const data = result?.data ?? result;
      if (data?.error) throw new Error(data.error);
      const { file_url } = data;
      sendMutation.mutate({
        content: isImage || isAudio ? '' : file.name,
        file_url,
        file_type: isImage ? 'image' : isAudio ? 'audio' : 'file',
        file_name: file.name,
      });
    } catch (err) { toast({ title: t('chat.uploadError'), description: err.message, variant: 'destructive' }); }
    finally { setUploading(false); }
  };

  const openPicker = (type) => {
    setAttachOpen(false);
    if (type === 'camera') {
      const camInput = document.getElementById('chat-camera-input');
      if (camInput) camInput.click();
    } else {
      fileInputRef.current.accept = type === 'photo'
        ? 'image/*'
        : type === 'doc'
        ? '.pdf,.doc,.docx,.txt,.xls,.xlsx'
        : 'image/*,application/pdf,.doc,.docx,.txt';
      fileInputRef.current.removeAttribute('capture');
      fileInputRef.current.click();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        const mimeType = mr.mimeType || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const file = new File([blob], `audio_${Date.now()}.${ext}`, { type: mimeType });
        stream.getTracks().forEach(track => track.stop());
        await handleUpload(file);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      setTimeout(() => { if (mr.state === 'recording') stopRecording(); }, 60000);
    } catch { toast({ title: t('chat.micUnavailable'), description: t('chat.micHint'), variant: 'destructive' }); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const sendMessage = () => {
    if (!message.trim()) return;
    sendMutation.mutate({ content: message.trim() });
  };

  const isMe = (msg) => msg.user_id === currentUserId || msg.user_email === currentUserEmail;
  const isImage = (msg) => (msg.file_type === 'image' || msg.file_type?.startsWith?.('image/')) && msg.file_url;
  const isAudio = (msg) => msg.file_url && (msg.file_type === 'audio' || (msg.file_type && msg.file_type.startsWith('audio/')));
  const isFile  = (msg) => msg.file_url && !isImage(msg) && !isAudio(msg);

  return (
    <>
      {attachOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setAttachOpen(false)}>
          <div className="absolute bottom-36 left-4 bg-card border border-border rounded-2xl shadow-xl p-3 flex gap-3"
            onClick={e => e.stopPropagation()}>
            {[
              { label: t('common.photo'), icon: <Image className="w-5 h-5" />, action: () => openPicker('photo') },
              { label: t('chat.camera'), icon: <Camera className="w-5 h-5" />, action: () => openPicker('camera') },
              { label: t('chat.file'), icon: <FileText className="w-5 h-5" />, action: () => openPicker('doc') },
              { label: t('chat.poll'), icon: <BarChart2 className="w-5 h-5" />, action: () => { setAttachOpen(false); setPollOpen(true); } },
            ].map(btn => (
              <button key={btn.label} onClick={btn.action}
                className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl hover:bg-secondary transition-colors">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  {btn.icon}
                </div>
                <span className="text-label font-medium text-foreground">{btn.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card rounded-2xl border border-border overflow-hidden flex flex-col mb-4" style={{minHeight:'360px',maxHeight:'500px'}}>
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                <MessageCircle className="w-6 h-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">{t('chat.emptyTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('chat.emptyHint')}</p>
            </div>
          )}
          {messages.map((msg, idx) => {
            const msgDate = msg.created_date ? parseServerDate(msg.created_date) : null;
            const prevDate = idx > 0 && messages[idx-1].created_date ? parseServerDate(messages[idx-1].created_date) : null;
            const showDate = msgDate && (!prevDate || msgDate.toDateString() !== prevDate.toDateString());
            const me = isMe(msg);
            return (
              <div key={msg.id}>
                {showDate && msgDate && (
                  <div className="flex items-center gap-2 my-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-label text-muted-foreground font-medium px-2">
                      {msgDate.getDate()} {msgDate.toLocaleString(i18n.language, {month:'short'})}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <div className={`flex items-end gap-1.5 ${me ? 'flex-row-reverse' : ''}`}>
                  <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center text-label font-bold text-primary flex-shrink-0">
                    {msg.avatar_url
                      ? <img src={msg.avatar_url} className="w-6 h-6 rounded-full object-cover" alt="" />
                      : (msg.display_name||'?')[0].toUpperCase()}
                  </div>
                  <div className={`max-w-[70%] flex flex-col gap-0.5 ${me ? 'items-end' : 'items-start'}`}>
                    <span className="text-micro text-muted-foreground px-1">{me ? t('common.you') : (msg.display_name||msg.user_email)}</span>
                    {isImage(msg) && (
                      <div className="rounded-2xl overflow-hidden cursor-pointer" style={{maxWidth:180}}
                        onClick={() => setLightbox(msg.file_url)}>
                        <img src={msg.file_url} className="w-full object-cover" style={{maxHeight:160}} />
                      </div>
                    )}
                    {isAudio(msg) && (() => {
                      const audioId = `audio-${msg.id}`;
                      return (
                        <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-full ${me ? 'bg-primary' : 'bg-secondary'}`} style={{minWidth:200,maxWidth:240}}>
                          <button
                            onClick={() => {
                              const el = document.getElementById(audioId);
                              if (!el) return;
                              el.paused ? el.play() : el.pause();
                            }}
                            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${me ? 'bg-white/20' : 'bg-border'}`}>
                            <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
                              <path d="M1 1.5L11 7L1 12.5V1.5Z" fill={me ? 'white' : 'var(--foreground)'} />
                            </svg>
                          </button>
                          <div className="flex-1 flex flex-col gap-1">
                            <div className={`h-1 rounded-full ${me ? 'bg-white/30' : 'bg-border'}`}>
                              <div className={`h-1 rounded-full w-0 ${me ? 'bg-white' : 'bg-primary'}`} id={`prog-${msg.id}`} />
                            </div>
                            <span className={`text-label ${me ? 'text-white/70' : 'text-muted-foreground'}`} id={`dur-${msg.id}`}>0:00</span>
                          </div>
                          <audio id={audioId} src={msg.file_url} preload="metadata"
                            onTimeUpdate={e => {
                              const el = e.target;
                              const pct = el.duration ? (el.currentTime / el.duration * 100) : 0;
                              const prog = document.getElementById(`prog-${msg.id}`);
                              const dur = document.getElementById(`dur-${msg.id}`);
                              if (prog) prog.style.width = pct + '%';
                              if (dur) {
                                const t = Math.floor(el.currentTime);
                                dur.textContent = `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
                              }
                            }}
                            onLoadedMetadata={e => {
                              const dur = document.getElementById(`dur-${msg.id}`);
                              if (dur && e.target.duration) {
                                const t = Math.floor(e.target.duration);
                                dur.textContent = `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
                              }
                            }}
                            style={{display:'none'}} />
                        </div>
                      );
                    })()}
                    {isFile(msg) && (
                      <a href={msg.file_url} download={msg.file_name} target="_blank" rel="noopener noreferrer"
                        className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-sm ${me ? 'bg-primary text-white' : 'bg-secondary text-foreground'}`}>
                        <FileText className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate max-w-[110px] text-xs">{msg.file_name||t('chat.file')}</span>
                        <Download className="w-3 h-3" />
                      </a>
                    )}
                    {msg.file_type === 'poll' && (() => {
                        let pd = {};
                        try { pd = JSON.parse(msg.file_name || '{}'); } catch {}
                        const total = (pd.options||[]).reduce((a,o) => a + (o.votes||[]).length, 0);
                        return (
                          <div className="rounded-2xl border border-border bg-card overflow-hidden" style={{minWidth:200}}>
                            <div className="px-3 pt-2.5 pb-2 border-b border-border">
                              <div className="flex items-center gap-1.5 mb-1">
                                <BarChart2 className="w-3.5 h-3.5 text-primary" />
                                <span className="text-xs font-medium text-primary">{t('chat.poll')}</span>
                              </div>
                              <p className="text-sm font-medium text-foreground leading-snug">{pd.question}</p>
                            </div>
                            <div className="p-2 space-y-1.5">
                              {(pd.options||[]).map((opt, i) => {
                                const votes = opt.votes?.length || 0;
                                const pct = total ? Math.round(votes / total * 100) : 0;
                                const voted = opt.votes?.includes(currentUserEmail);
                                return (
                                  <button key={i} onClick={() => votePoll(msg, i)}
                                    className={`w-full text-left px-3 py-2 rounded-xl border text-xs transition-all relative overflow-hidden ${voted ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-border text-foreground hover:border-primary/30'}`}>
                                    <div className="absolute inset-y-0 left-0 bg-primary/10 rounded-xl transition-all" style={{width: pct + '%'}} />
                                    <span className="relative flex items-center justify-between gap-3">
                                      <span className="truncate">{opt.text}</span>
                                      <span className="text-muted-foreground font-normal flex-shrink-0">{pct}%</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-label text-muted-foreground text-center pb-2">{t('chat.votes', { count: total })}</p>
                          </div>
                        );
                      })()}
                    {!isImage(msg) && !isAudio(msg) && !isFile(msg) && msg.file_type !== 'poll' && (
                      <div className={`px-3 py-2 rounded-2xl text-sm leading-snug ${me ? 'bg-primary text-white rounded-br-sm' : 'bg-secondary text-foreground rounded-bl-sm'}`}>
                        {msg.content || (msg.file_url ? t('chat.attachedFile') : '')}
                      </div>
                    )}
                    <span className="text-micro text-muted-foreground px-1">
                      {msgDate ? `${msgDate.getHours()}:${String(msgDate.getMinutes()).padStart(2,'0')}` : ''}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {!navigator.onLine && (
          <div className="flex items-center gap-2 mx-3 mb-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-2xl px-3 py-2.5">
            <WifiOff className="w-3.5 h-3.5 text-amber-800 flex-shrink-0" />
            <p className="text-xs text-amber-800 font-medium">{t('translator.offline')}</p>
          </div>
        )}
        <div className="border-t border-border p-2.5 flex gap-2 items-center">
          <input ref={fileInputRef} type="file" className="hidden"
            onChange={e => { handleUpload(e.target.files?.[0]); e.target.value=''; }} />
          <input
            ref={el => { if (el) el._isCameraInput = true; }}
            id="chat-camera-input"
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => { handleUpload(e.target.files?.[0]); e.target.value=''; }}
          />

          <button onClick={() => setAttachOpen(o => !o)}
            disabled={uploading || recording}
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors font-bold text-lg ${attachOpen ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
            {uploading
              ? <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              : '+'}
          </button>

          <Input value={message} onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}}
            placeholder={t('home.typeMessage')}
            className="flex-1 text-sm bg-background border-border rounded-full px-4"
            disabled={sendMutation.isPending || recording} />

          {!message.trim() && (
            <button
              onClick={recording ? stopRecording : startRecording}
              disabled={uploading || sendMutation.isPending}
              className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${recording ? 'bg-red-500 text-white' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}>
              {recording
                ? <div className="w-3 h-3 rounded-sm bg-white" />
                : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm7 10a1 1 0 0 1 2 0c0 5-3.6 9.3-8.5 9.9V23h-1v-2.1C6.6 20.3 3 16 3 11a1 1 0 0 1 2 0c0 4.4 3.6 8 7 8s7-3.6 7-8z"/></svg>
              }
            </button>
          )}

          {message.trim() && (
            <Button onClick={sendMessage} disabled={sendMutation.isPending}
              className="h-9 w-9 p-0 bg-primary hover:bg-primary/90 text-white shrink-0 rounded-full">
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {pollOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50"
          onClick={() => setPollOpen(false)}>
          <div className="bg-card w-full max-w-lg rounded-t-3xl p-5 pb-8 space-y-3"
            onClick={e => e.stopPropagation()}>
            <div className="w-9 h-1 bg-border rounded-full mx-auto" />
            <div className="flex items-center gap-2 pb-1">
              <BarChart2 className="w-4 h-4 text-primary" />
              <p className="text-sm font-medium text-foreground">{t('chat.newPoll')}</p>
            </div>
            <input
              placeholder={t('chat.pollQuestion')}
              value={pollQuestion}
              onChange={e => setPollQuestion(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-border bg-secondary text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
            />
            <div className="space-y-2">
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    placeholder={t('chat.pollOption', { n: i + 1 })}
                    value={opt}
                    onChange={e => { const o=[...pollOptions]; o[i]=e.target.value; setPollOptions(o); }}
                    className="flex-1 px-4 py-3 rounded-2xl border border-border bg-secondary text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                  />
                  {pollOptions.length > 2 && (
                    <button onClick={() => setPollOptions(pollOptions.filter((_,j)=>j!==i))}
                      className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0">
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {pollOptions.length < 5 && (
              <button onClick={() => setPollOptions([...pollOptions, ''])}
                className="w-full py-2.5 rounded-2xl border border-dashed border-border text-xs text-primary">
                {t('chat.addOption')}
              </button>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setPollOpen(false)}
                className="flex-1 py-3 rounded-full border border-border text-sm text-muted-foreground">
                {t('common.cancel')}
              </button>
              <button onClick={sendPoll}
                disabled={!pollQuestion.trim() || pollOptions.filter(o=>o.trim()).length < 2 || sendMutation.isPending}
                className="flex-[2] py-3 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-40">
                {t('chat.sendPoll')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
