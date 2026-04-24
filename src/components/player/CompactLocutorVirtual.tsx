"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Radio, Play, Pause, Download, Loader2, Mic, Square, Music, SkipForward, Zap, CalendarClock, Clock, Pencil, RotateCcw, Lock } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { authedFetch } from "@/lib/authedFetch";
import { useSessionStore } from "@/stores/sessionStore";
import type { InsertMode } from "@/components/player/VoiceRecorderModal";

const VOICES = [
  { id: "masculina-jovem", label: "Zeraías" },
  { id: "feminina-jovem",  label: "Zeruia"  },
];
const MAX_CHARS = 260;
const STABILITY = 0.82;
const STYLE     = 0.08;

const TRACK_CATS = [
  { id: "campanha",    label: "Campanha"    },
  { id: "sofisticado", label: "Sofisticado" },
  { id: "animado",     label: "Animado"     },
] as const;

const MIX_CFG: Record<string, { intro: number; outro: number; vol: number; duckVol: number }> = {
  campanha:    { intro: 2.35, outro: 1.0,  vol: 1.1, duckVol: 0.23 },
  sofisticado: { intro: 1.5,  outro: 1.5,  vol: 1.1, duckVol: 0.25 },
  animado:     { intro: 1.0,  outro: 0.91, vol: 1.0, duckVol: 0.10 },
};

interface TrackSlot { name: string; url: string; }

function audioBufferToWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length * ch * 2;
  const ab = new ArrayBuffer(44 + len); const v = new DataView(ab);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0,"RIFF"); v.setUint32(4,36+len,true); ws(8,"WAVE"); ws(12,"fmt "); v.setUint32(16,16,true);
  v.setUint16(20,1,true); v.setUint16(22,ch,true); v.setUint32(24,sr,true); v.setUint32(28,sr*ch*2,true);
  v.setUint16(32,ch*2,true); v.setUint16(34,16,true); ws(36,"data"); v.setUint32(40,len,true);
  let off=44; for(let i=0;i<buf.length;i++){for(let c=0;c<ch;c++){const s=Math.max(-1,Math.min(1,buf.getChannelData(c)[i]));v.setInt16(off,s<0?s*0x8000:s*0x7FFF,true);off+=2;}}
  return new Blob([ab],{type:"audio/wav"});
}

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert?: (directFilePath: string, mode: InsertMode, title: string, scheduledTime?: string) => void;
  onPreviewStart?: () => void;
  isLocked?: boolean;
}

const CompactLocutorVirtual = ({ open, onClose, onInsert, onPreviewStart, isLocked = false }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const mixedAudioRef = useRef<HTMLAudioElement>(null);

  // Locked badge
  const [lockedBadge, setLockedBadge] = useState(false);
  const lockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLockedBadge = () => {
    setLockedBadge(true);
    if (lockedTimer.current) clearTimeout(lockedTimer.current);
    lockedTimer.current = setTimeout(() => setLockedBadge(false), 3000);
  };

  // Text & voice
  const [spotName, setSpotName]     = useState("");
  const [text, setText]             = useState("");
  const [voice, setVoice]           = useState("masculina-jovem");
  const [speed, setSpeed]           = useState([1.0]);
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl]     = useState<string | null>(null);
  const [playing, setPlaying]       = useState(false);

  // Recording
  const [recording, setRecording]   = useState(false);
  const [recSec, setRecSec]         = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const mrRef      = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobRef    = useRef<string | null>(null);

  // Tracks
  const [defaultTracks, setDefaultTracks] = useState<Record<string, TrackSlot>>({});
  const [customTracks, setCustomTracks]   = useState<Record<string, TrackSlot>>({});
  const [selTrack, setSelTrack]           = useState<string | null>(null);
  const [previewTrack, setPreviewTrack]   = useState<string | null>(null);
  const instrRef = useRef<HTMLAudioElement>(null);
  const trackClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mix
  const [mixing, setMixing]               = useState(false);
  const [mixedUrl, setMixedUrl]           = useState<string | null>(null);
  const [mixedPlaying, setMixedPlaying]   = useState(false);
  const [activeOut, setActiveOut]         = useState<"voice"|"spot">("voice");
  const mixedBlobRef = useRef<string | null>(null);

  // Schedule
  const [showSched, setShowSched]   = useState(false);
  const [schedDate, setSchedDate]   = useState("");
  const [schedTime, setSchedTime]   = useState("");
  const schedRef = useRef<HTMLDivElement>(null);

  // Load tracks
  useEffect(() => {
    if (!open) return;
    authedFetch("/api/instrumental-defaults").then(r => r.json()).then(({ tracks }) => { if (tracks) setDefaultTracks(tracks); }).catch(() => {});
    const token = useSessionStore.getState().token;
    if (token) {
      fetch("/api/client-instrumentals", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(({ tracks }) => {
          if (tracks) { const c: Record<string, TrackSlot> = {}; for (const [cat, d] of Object.entries(tracks) as [string, { url: string }][]) { c[cat] = { name: cat, url: d.url }; } setCustomTracks(c); }
        }).catch(() => {});
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Close sched popover on outside click
  useEffect(() => {
    if (!showSched) return;
    const handler = (e: MouseEvent) => { if (schedRef.current && !schedRef.current.contains(e.target as Node)) setShowSched(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSched]);

  const getTrack = (cat: string): TrackSlot | null => customTracks[cat] ?? defaultTracks[cat] ?? null;

  const stopRec = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (mrRef.current?.state === "recording") mrRef.current.stop();
    setRecording(false);
  }, []);

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      chunksRef.current = [];
      const mime = ["audio/webm;codecs=opus","audio/webm","audio/mp4"].find(t => MediaRecorder.isTypeSupported(t)) ?? "";
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mrRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        setTranscribing(true);
        try {
          const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
          const resp = await authedFetch("/api/tts-transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64: b64, mimeType: mr.mimeType }) });
          const data = await resp.json();
          if (data.transcript?.trim()) setText(data.transcript.slice(0, MAX_CHARS));
          else toast.error("Não foi possível transcrever.");
        } catch { toast.error("Erro ao transcrever."); }
        finally { setTranscribing(false); }
      };
      mr.start(500); setText(""); setRecording(true); setRecSec(0);
      timerRef.current = setInterval(() => setRecSec(s => { if (s >= 29) { stopRec(); return 30; } return s + 1; }), 1000);
    } catch { toast.error("Permissão de microfone negada."); }
  };

  const generate = async () => {
    if (isLocked) { showLockedBadge(); return; }
    if (!text.trim()) { toast.error("Digite o texto primeiro."); return; }
    setGenerating(true); setAudioUrl(null); setPlaying(false);
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    try {
      const res = await authedFetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.trim(), voice, speed: speed[0], stability: STABILITY, style: STYLE }) });
      if (!res.ok) { toast.error("Erro ao gerar."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobRef.current = url; setAudioUrl(url); setActiveOut("voice");
      if (audioRef.current) { audioRef.current.src = url; onPreviewStart?.(); audioRef.current.play().catch(() => {}); setPlaying(true); }
      // Persiste automaticamente
      const name = spotName.trim() || `Spot locutor ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
      persistSpot(url, name).then(id => { if (id) toast.success("Spot salvo!"); });
    } catch { toast.error("Falha na conexão."); }
    finally { setGenerating(false); }
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) { toast.info("Gere a narração primeiro."); return; }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { onPreviewStart?.(); audioRef.current.play().catch(() => {}); setPlaying(true); }
  };

  const toggleMixedPlay = () => {
    if (!mixedAudioRef.current || !mixedUrl) { toast.info("Crie o spot primeiro."); return; }
    if (mixedPlaying) { mixedAudioRef.current.pause(); setMixedPlaying(false); }
    else { onPreviewStart?.(); mixedAudioRef.current.play().catch(() => {}); setMixedPlaying(true); }
  };

  const download = () => {
    const url = activeOut === "spot" ? mixedUrl : audioUrl;
    if (!url) { toast.info("Gere o áudio primeiro."); return; }
    const a = document.createElement("a"); a.href = url; a.download = `locutor-${Date.now()}.${activeOut === "spot" ? "wav" : "mp3"}`; a.click();
  };

  // Persiste spot no banco (upload do blob + insert na tabela spots)
  const persistSpot = async (blobUrl: string, title: string): Promise<string | null> => {
    try {
      const realUrl = blobUrl.startsWith("direct:") ? blobUrl.slice(7) : blobUrl;
      const res = await fetch(realUrl);
      const blob = await res.blob();
      if (blob.size === 0) return null;
      const ext = blob.type.includes("wav") ? "wav" : "mp3";
      const file = new File([blob], `locutor-${Date.now()}.${ext}`, { type: blob.type || "audio/mpeg" });
      const form = new FormData();
      form.append("file", file);
      form.append("title", title || `Spot locutor ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
      const uploadRes = await authedFetch("/api/spots", { method: "POST", body: form });
      if (!uploadRes.ok) return null;
      const { spot } = await uploadRes.json();
      return spot?.id ?? null;
    } catch { return null; }
  };

  const insert = async (mode: InsertMode, scheduled?: string) => {
    const url = activeOut === "spot" ? mixedUrl : audioUrl;
    if (!url) { toast.info("Gere o áudio primeiro."); return; }
    if (!onInsert) return;
    const rawTitle = `Locutor: ${text.slice(0, 30)}${text.length > 30 ? "…" : ""}`;
    const spotTitle = spotName.trim() || rawTitle;
    onInsert(`direct:${url}`, mode, spotTitle, scheduled);

    const spotId = await persistSpot(url, spotTitle);

    if (scheduled && spotId) {
      await authedFetch("/api/spots/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spot_id: spotId, enabled: true, priority: 1, scheduleStart: scheduled, scheduleEnd: null }),
      }).catch(() => {});
    }

    if (scheduled) setShowSched(false);
  };

  const handleInstrPreview = (cat: string) => {
    if (!instrRef.current) return;
    if (previewTrack === cat) { instrRef.current.pause(); setPreviewTrack(null); }
    else { const t = getTrack(cat); if (!t?.url) return; instrRef.current.src = t.url; instrRef.current.play().catch(() => {}); setPreviewTrack(cat); }
  };

  const handleMix = async () => {
    if (!audioUrl || !selTrack) return;
    const track = getTrack(selTrack);
    if (!track?.url) { toast.error("Trilha indisponível."); return; }
    setMixing(true);
    try {
      const [vR, iR] = await Promise.all([fetch(audioUrl), fetch(track.url)]);
      const [vA, iA] = await Promise.all([vR.arrayBuffer(), iR.arrayBuffer()]);
      const ctx = new AudioContext();
      const [vB, iB] = await Promise.all([ctx.decodeAudioData(vA), ctx.decodeAudioData(iA)]);
      await ctx.close();
      const cfg = MIX_CFG[selTrack] ?? { intro: 1.5, outro: 1.5, vol: 1.0, duckVol: 0.10 };
      const sr = vB.sampleRate, nch = Math.max(vB.numberOfChannels, iB.numberOfChannels);
      const mixDur = cfg.intro + vB.duration + cfg.outro;
      const bodyStart = cfg.intro, bodyEnd = Math.max(bodyStart + 0.01, iB.duration - cfg.outro);
      const offline = new OfflineAudioContext(nch, Math.ceil(sr * mixDur), sr);
      const iGain = offline.createGain();
      const volN = 0.28 * cfg.vol, volD = cfg.duckVol * cfg.vol;
      iGain.gain.value = volN;
      iGain.gain.setValueAtTime(volN, 0);
      iGain.gain.linearRampToValueAtTime(volD, cfg.intro + 0.2);
      iGain.gain.setValueAtTime(volD, cfg.intro + vB.duration - 0.2);
      iGain.gain.linearRampToValueAtTime(volN, cfg.intro + vB.duration);
      iGain.connect(offline.destination);
      const introS = offline.createBufferSource(); introS.buffer = iB; introS.connect(iGain); introS.start(0, 0); introS.stop(cfg.intro);
      const bodyS = offline.createBufferSource(); bodyS.buffer = iB; bodyS.loop = true; bodyS.loopStart = bodyStart; bodyS.loopEnd = bodyEnd; bodyS.connect(iGain); bodyS.start(cfg.intro, bodyStart); bodyS.stop(cfg.intro + vB.duration);
      const outroS = offline.createBufferSource(); outroS.buffer = iB; outroS.connect(iGain); outroS.start(cfg.intro + vB.duration, bodyEnd);
      const vS = offline.createBufferSource(); vS.buffer = vB; const vG = offline.createGain(); vG.gain.value = 1.4; vS.connect(vG); vG.connect(offline.destination); vS.start(cfg.intro);
      const rendered = await offline.startRendering();
      const blob = audioBufferToWav(rendered);
      if (mixedBlobRef.current) URL.revokeObjectURL(mixedBlobRef.current);
      const url = URL.createObjectURL(blob);
      mixedBlobRef.current = url; setMixedUrl(url); setMixedPlaying(false); setActiveOut("spot");
      toast.success("Spot criado!");
    } catch { toast.error("Erro ao misturar."); }
    finally { setMixing(false); }
  };

  const handleTrackUpload = (cat: string) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = "audio/*";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const token = useSessionStore.getState().token;
        if (!token) { toast.error("Sessão expirada."); return; }
        const fd = new FormData(); fd.append("file", file); fd.append("category", cat); fd.append("accessToken", token);
        const res = await authedFetch("/api/client-instrumentals", { method: "POST", body: fd });
        if (!res.ok) { toast.error("Erro ao salvar."); return; }
        const { url } = await res.json();
        setCustomTracks(prev => ({ ...prev, [cat]: { name: cat, url } }));
        toast.success("Trilha salva!");
      } catch { toast.error("Falha ao enviar."); }
    };
    input.click();
  };

  if (!open) return null;

  return (
    <div ref={ref} className="absolute bottom-full right-0 mb-2 mr-1 z-50 w-[260px] rounded-lg border border-primary/30 bg-card shadow-xl">
      <audio ref={audioRef} onEnded={() => setPlaying(false)} className="hidden" />
      <audio ref={mixedAudioRef} src={mixedUrl ?? undefined} onEnded={() => setMixedPlaying(false)} className="hidden" />
      <audio ref={instrRef} onEnded={() => setPreviewTrack(null)} className="hidden" />

      <div className="p-2.5 space-y-2">
        {/* Header */}
        <div className="flex items-center gap-1">
          <Radio className="h-3 w-3 text-primary" />
          <span className="text-[10px] font-bold text-foreground">Locutor Virtual</span>
        </div>

        {/* Locked badge — absolute, no layout shift */}
        <div className={`absolute top-8 left-1/2 -translate-x-1/2 z-20 pointer-events-none transition-all duration-300 ${lockedBadge ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"}`}>
          <div className="flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-full px-3 py-1.5 shadow-md whitespace-nowrap">
            <Lock className="h-3 w-3 text-primary shrink-0" />
            <p className="text-[10px] font-medium">Atualize seu plano para usar esse recurso.</p>
          </div>
        </div>

        {/* Textarea */}
        <div className="relative">
          <textarea value={text} onChange={e => setText(e.target.value.slice(0, MAX_CHARS))} rows={3}
            placeholder="Digite ou grave..."
            className="w-full resize-none overflow-y-auto scrollbar-none bg-secondary/40 border border-border/40 rounded-md px-2 py-1.5 text-[10px] text-foreground outline-none focus:border-primary/50 placeholder:text-muted-foreground/50" />
          <div className="flex items-center justify-between px-1 -mt-0.5">
            {recording ? (
              <button type="button" onClick={stopRec} className="flex items-center gap-1 text-[9px] text-destructive font-semibold">
                <Square className="h-2.5 w-2.5 fill-current" /> {recSec}s
              </button>
            ) : transcribing ? (
              <span className="flex items-center gap-1 text-[9px] text-primary"><Loader2 className="h-2.5 w-2.5 animate-spin" />Transcrevendo</span>
            ) : (
              <button type="button" onClick={startRec} className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-primary">
                <Mic className="h-2.5 w-2.5" /> Gravar
              </button>
            )}
            <span className={`text-[9px] ${text.length >= MAX_CHARS ? "text-yellow-500" : "text-muted-foreground"}`}>{text.length}/{MAX_CHARS}</span>
          </div>
        </div>

        {/* Voice select */}
        <div className="grid grid-cols-2 gap-1">
          {VOICES.map(v => (
            <button key={v.id} type="button" onClick={() => setVoice(v.id)}
              className={`text-[9px] font-semibold py-1 rounded-md border transition-colors ${voice === v.id ? "border-primary bg-primary/15 text-primary" : "border-border/30 bg-secondary/20 text-muted-foreground hover:border-primary/40"}`}>
              {v.label}
            </button>
          ))}
        </div>

        {/* Speed */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground whitespace-nowrap">Vel: {speed[0].toFixed(1)}x</span>
          <div className="flex-1"><Slider value={speed} onValueChange={setSpeed} min={0.7} max={1.2} step={0.1} /></div>
        </div>

        {/* Nome do spot */}
        <input type="text" placeholder="Nome do spot…" value={spotName} onChange={e => setSpotName(e.target.value.slice(0, 50))}
          className="w-full bg-secondary/50 border border-border/40 rounded-md px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary/50 placeholder:text-muted-foreground/50" />

        {/* Generate */}
        <button type="button" onClick={generate} disabled={generating || !text.trim()}
          className="w-full flex items-center justify-center gap-1 bg-primary text-primary-foreground text-[10px] font-bold py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40 transition-colors">
          {generating ? <><Loader2 className="h-3 w-3 animate-spin" /> Gerando...</> : <><Radio className="h-3 w-3" /> Gerar Narração</>}
        </button>

        {/* Trilha Sonora */}
        <div className="border-t border-border/30 pt-1.5">
          <div className="flex items-center gap-1 mb-1">
            <Music className="h-2.5 w-2.5 text-primary" />
            <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Trilha Sonora</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {TRACK_CATS.map(cat => {
              const isSel = selTrack === cat.id;
              const isPrev = previewTrack === cat.id;
              const hasCust = !!customTracks[cat.id];
              return (
                <div key={cat.id}
                  onClick={() => {
                    if (trackClickRef.current) return;
                    trackClickRef.current = setTimeout(() => { trackClickRef.current = null; setSelTrack(cat.id); handleInstrPreview(cat.id); }, 250);
                  }}
                  onDoubleClick={() => { if (trackClickRef.current) { clearTimeout(trackClickRef.current); trackClickRef.current = null; } handleTrackUpload(cat.id); }}
                  className={`relative flex items-center gap-0.5 px-1.5 py-1 rounded-md cursor-pointer border text-[8px] font-semibold uppercase tracking-wider transition-colors select-none ${
                    isSel ? "border-primary bg-primary/10 text-primary" : "border-border/30 bg-secondary/20 text-muted-foreground hover:border-primary/40"
                  }`}>
                  {isPrev ? <Pause className="h-2.5 w-2.5 shrink-0" /> : <Play className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{cat.label.slice(0, 6)}</span>
                  <div className="ml-auto flex shrink-0 gap-px">
                    {hasCust && (
                      <button type="button" onClick={async e => { e.stopPropagation();
                        try { const token = useSessionStore.getState().token;
                          if (token) await authedFetch("/api/client-instrumentals", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: cat.id, accessToken: token }) });
                        } catch {} setCustomTracks(prev => { const n = { ...prev }; delete n[cat.id]; return n; });
                      }} className="opacity-40 hover:opacity-90" title="Voltar ao padrão"><RotateCcw className="h-2 w-2" /></button>
                    )}
                    <button type="button" onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); handleTrackUpload(cat.id); }}
                      className="opacity-30 hover:opacity-90" title="2x clique para importar"><Pencil className="h-2 w-2" /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => { if (!audioUrl) { toast.info("Gere a narração primeiro."); return; } if (!selTrack) { toast.info("Selecione uma trilha."); return; } handleMix(); }}
            disabled={mixing}
            className="w-full flex items-center justify-center gap-1 bg-primary text-primary-foreground text-[9px] font-bold py-1 rounded-md mt-1.5 hover:bg-primary/90 disabled:opacity-40 transition-colors">
            {mixing ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Misturando...</> : <><Music className="h-2.5 w-2.5" /> Criar Spot com Trilha</>}
          </button>
        </div>

        {/* Play / Download / Insert — always visible */}
        <div className="border-t border-border/30 pt-1.5 space-y-1.5">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" onClick={() => setActiveOut("voice")}
              className={`text-[8px] font-semibold py-0.5 rounded border transition-colors ${activeOut === "voice" ? "border-primary bg-primary/15 text-primary" : "border-border/30 text-muted-foreground"}`}>
              Narração
            </button>
            <button type="button" onClick={() => setActiveOut("spot")}
              className={`text-[8px] font-semibold py-0.5 rounded border transition-colors ${activeOut === "spot" ? "border-primary bg-primary/15 text-primary" : "border-border/30 text-muted-foreground"}`}>
              Spot
            </button>
          </div>

          <div className="flex gap-1">
            <button type="button" onClick={() => activeOut === "voice" ? togglePlay() : toggleMixedPlay()}
              className="flex-1 flex items-center justify-center gap-1 text-[9px] font-semibold border border-primary/50 text-primary rounded-md py-1 hover:bg-primary/10">
              {(activeOut === "voice" ? playing : mixedPlaying) ? <><Pause className="h-2.5 w-2.5" /> Pausar</> : <><Play className="h-2.5 w-2.5" /> Ouvir</>}
            </button>
            <button type="button" onClick={download}
              className="flex-1 flex items-center justify-center gap-1 text-[9px] font-semibold border border-primary/50 text-primary rounded-md py-1 hover:bg-primary/10">
              <Download className="h-2.5 w-2.5" /> MP3
            </button>
          </div>

          {onInsert && (
            <div className="grid grid-cols-3 gap-1">
              <button type="button" onClick={() => insert("queue")}
                className="flex flex-col items-center gap-0.5 text-[7px] font-semibold py-1 rounded-md bg-secondary/40 text-muted-foreground hover:bg-primary/15 hover:text-primary">
                <SkipForward className="h-2.5 w-2.5" /> A seguir
              </button>
              <button type="button" onClick={() => insert("interrupt")}
                className="flex flex-col items-center gap-0.5 text-[7px] font-semibold py-1 rounded-md bg-secondary/40 text-muted-foreground hover:bg-primary/15 hover:text-primary">
                <Zap className="h-2.5 w-2.5" /> Agora
              </button>
              <div className="relative">
                <button type="button" onClick={() => setShowSched(s => !s)}
                  className={`w-full flex flex-col items-center gap-0.5 text-[7px] font-semibold py-1 rounded-md transition-colors ${showSched ? "bg-primary/20 text-primary" : "bg-secondary/40 text-muted-foreground hover:bg-primary/15 hover:text-primary"}`}>
                  <CalendarClock className="h-2.5 w-2.5" /> Programar
                </button>
                {showSched && (
                  <div ref={schedRef} className="absolute bottom-full mb-1 right-0 w-44 z-50 rounded-lg border border-primary/30 bg-card shadow-xl p-1.5 space-y-1">
                    <div className="flex items-center gap-1">
                      <input type="date" title="Data" value={schedDate} onChange={e => setSchedDate(e.target.value)}
                        className="flex-1 min-w-0 bg-secondary/50 border border-border/40 rounded px-1 py-0.5 text-[9px] text-foreground outline-none" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                      <input type="time" title="Hora" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                        className="flex-1 bg-secondary/50 border border-border/40 rounded px-1 py-0.5 text-[9px] text-foreground outline-none font-mono" />
                    </div>
                    <button type="button" disabled={!schedDate || !schedTime}
                      onClick={() => insert("scheduled", `${schedDate}T${schedTime}`)}
                      className="w-full bg-primary text-primary-foreground text-[9px] font-bold py-1 rounded disabled:opacity-40 hover:bg-primary/90">
                      Confirmar
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompactLocutorVirtual;
