"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Radio, Play, Pause, Download, Volume2, Loader2, Lock, BarChart2, CalendarClock, SkipForward, Zap, Headphones, Mic, Square, CheckCircle2, Music, Pencil, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { InsertMode } from "@/components/player/VoiceRecorderModal";
import { authedFetch } from "@/lib/authedFetch";
import { useSessionStore } from "@/stores/sessionStore";
const VOICE_OPTIONS = [
  { id: "masculina-jovem", label: "Zeraías", desc: "Masculina" },
  { id: "feminina-jovem",  label: "Zeruia",  desc: "Feminina"  },
];

const VOICE_STABILITY = 0.82;
const VOICE_STYLE     = 0.08;


const MAX_CHARS       = 260;
const MAX_GENERATIONS = 20;

const TYPEWRITER_TEXT = "Digite ou grave, que a gente comunica pra você";
const ELEVENLABS_QUOTA = 30000;

interface TrackSlot {
  name: string;
  url: string;
}

const TRACK_CATEGORIES = [
  { id: "campanha",    label: "Campanha"    },
  { id: "sofisticado", label: "Sofisticado" },
  { id: "animado",     label: "Animado"     },
] as const;

// Configuração de intro/outro por trilha — a voz SEMPRE toca em velocidade normal (sem distorção)
// O body da trilha loopa para preencher exatamente o tempo que a voz precisar
const MIX_CONFIG: Record<string, { intro: number; outro: number; vol: number; duckVol: number }> = {
  campanha:    { intro: 2.35, outro: 1.0,  vol: 1.1, duckVol: 0.23 },
  sofisticado: { intro: 1.5,  outro: 1.5,  vol: 1.1, duckVol: 0.25 },
  animado:     { intro: 1.0,  outro: 0.91, vol: 1.0, duckVol: 0.10 },
};

function audioBufferToWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, sr = buf.sampleRate;
  const len = buf.length * ch * 2;
  const ab = new ArrayBuffer(44 + len);
  const v = new DataView(ab);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + len, true);
  ws(8, "WAVE"); ws(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, len, true);
  let off = 44;
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

interface LocutorVirtualPanelProps {
  onInsert?: (directFilePath: string, mode: InsertMode, title: string, scheduledTime?: string) => void;
  onPreviewStart?: () => void;
  isLocked?: boolean;
  isAdmin?: boolean;
}

const LocutorVirtualPanel = ({ onInsert, onPreviewStart, isLocked = false, isAdmin = false }: LocutorVirtualPanelProps) => {
  const [lockedBadge, setLockedBadge]     = useState(false);
  const lockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showBadge = () => {
    setLockedBadge(true);
    if (lockedTimer.current) clearTimeout(lockedTimer.current);
    lockedTimer.current = setTimeout(() => setLockedBadge(false), 3000);
  };

  /* typewriter */
  const [twIndex, setTwIndex]             = useState(0);
  const [twActive, setTwActive]           = useState(true);
  const twRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTypewriter = () => {
    if (twRef.current) { clearInterval(twRef.current); twRef.current = null; }
    setTwActive(false);
  };

  useEffect(() => {
    twRef.current = setInterval(() => {
      setTwIndex(i => {
        const next = i + 1;
        if (next >= TYPEWRITER_TEXT.length) {
          clearInterval(twRef.current!);
          twRef.current = null;
        }
        return next;
      });
    }, 65);
    return () => { if (twRef.current) clearInterval(twRef.current); };
  }, []);

  /* text */
  const [text, setText]                   = useState("");
  const [geminiCorrected, setGeminiCorrected] = useState(false);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  /* audio */
  const [selectedVoice, setSelectedVoice] = useState("masculina-jovem");
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  const [speed, setSpeed]                 = useState([1.0]);
  const [isCorrectingBlur, setIsCorrectingBlur] = useState(false);
  const [isGenerating, setIsGenerating]   = useState(false);
  const [isPriming, setIsPriming]         = useState(false);

  /* recording / transcription */
  const [isRecording, setIsRecording]     = useState(false);
  const [recSeconds, setRecSeconds]       = useState(0);
  const [recAudioUrl, setRecAudioUrl]     = useState<string | null>(null);
  const [isPlayingRec, setIsPlayingRec]   = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef    = useRef<any>(null);
  const recAudioRef       = useRef<HTMLAudioElement>(null);
  const recTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const recChunksRef      = useRef<Blob[]>([]);
  const [audioUrl, setAudioUrl]           = useState<string | null>(null);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [insertMode, setInsertMode]       = useState<InsertMode>("queue");
  const [showSchedule, setShowSchedule]   = useState(false);
  const [schedDate, setSchedDate]         = useState("");
  const [schedTime, setSchedTime]         = useState("");
  const [schedEndDate, setSchedEndDate]   = useState("");
  const [schedEndTime, setSchedEndTime]   = useState("");
  // legacy — kept for compat
  const [schedHour, setSchedHour]         = useState("");
  const [schedMin, setSchedMin]           = useState("");
  const audioRef    = useRef<HTMLAudioElement>(null);
  const prevBlobUrl = useRef<string | null>(null);

  /* mood test */
  const [moodTestText, setMoodTestText]               = useState("");
  const [isMoodTesting, setIsMoodTesting]             = useState(false);
  const [isTestPlaying, setIsTestPlaying]             = useState(false);
  const moodTestAudioRef = useRef<HTMLAudioElement>(null);
  const moodTestBlobUrl  = useRef<string | null>(null);

  /* voice preview */
  const [previewingVoice, setPreviewingVoice]         = useState<string | null>(null);
  const [previewCache, setPreviewCache]               = useState<Record<string, string>>({});
  const [previewTexts, setPreviewTexts]               = useState<Record<string, string>>({});
  const previewAudioRef = useRef<HTMLAudioElement>(null);

  /* user */
  const [userId, setUserId]               = useState<string | null>(null);

  /* usage */
  const [gensUsed, setGensUsed]           = useState(0);
  const [charsUsed, setCharsUsed]         = useState(0);

  /* instrumentals */
  const trackClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [defaultTracks, setDefaultTracks]             = useState<Record<string, TrackSlot>>({});
  const [customTracks, setCustomTracks]               = useState<Record<string, TrackSlot>>({});
  const [selectedInstrumental, setSelectedInstrumental] = useState<string | null>(null);
  const [trackDuckVol, setTrackDuckVol]               = useState<Record<string, number>>({ campanha: 0.23, sofisticado: 0.25, animado: 0.10 });
  const [isMixing, setIsMixing]                       = useState(false);
  const [mixedAudioUrl, setMixedAudioUrl]             = useState<string | null>(null);
  const [isMixedPlaying, setIsMixedPlaying]           = useState(false);
  const [activeOutput, setActiveOutput]               = useState<"voice" | "spot">("voice");
  const [spotName, setSpotName]                       = useState("");
  const [userName, setUserName]                       = useState("");
  const schedulePopoverRef                            = useRef<HTMLDivElement>(null);
  const [previewingInstrumental, setPreviewingInstrumental] = useState<string | null>(null);
  const [isUploadingDefault, setIsUploadingDefault]   = useState<string | null>(null);
  const mixedBlobRef    = useRef<string | null>(null);
  const mixedAudioRef   = useRef<HTMLAudioElement>(null);
  const instrPreviewRef = useRef<HTMLAudioElement>(null);


  /* Load user */
  useEffect(() => {
    const storeUser = useSessionStore.getState().user;
    if (!storeUser?.id) return;
    setUserId(storeUser.id);

    import("@/lib/supabase/client").then(async ({ supabase }) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, username")
        .eq("user_id", storeUser.id)
        .single();

      const name = profile?.display_name || profile?.username || "usuário";
      setUserName(name);

      const now      = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const { data: usage } = await supabase
        .from("locutor_usage")
        .select("chars_used, generations_used")
        .eq("user_id", storeUser.id)
        .eq("month_key", monthKey)
        .single();

      if (usage) {
        setCharsUsed(usage.chars_used ?? 0);
        setGensUsed(usage.generations_used ?? 0);
      }
    });
  }, []);




  /* Fecha popover de programação ao clicar fora */
  useEffect(() => {
    if (!showSchedule) return;
    const handler = (e: MouseEvent) => {
      if (schedulePopoverRef.current && !schedulePopoverRef.current.contains(e.target as Node)) {
        setShowSchedule(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSchedule]);

  /* Carrega textos de preview salvos pelo admin via rota server (bypassa RLS) */
  useEffect(() => {
    const keys = VOICE_OPTIONS.map(v => `locutor_preview_${v.id}`).join(",");
    authedFetch(`/api/admin/save-setting?keys=${encodeURIComponent(keys)}`)
      .then(r => r.json())
      .then(({ settings }: { settings: Record<string, string> }) => {
        if (!settings || !Object.keys(settings).length) return;
        const texts: Record<string, string> = {};
        for (const [k, v] of Object.entries(settings)) {
          texts[k.replace("locutor_preview_", "")] = v;
        }
        setPreviewTexts(texts);
        // Limpa cache das vozes com texto salvo para regenerar com texto correto
        setPreviewCache(prev => {
          const next = { ...prev };
          Object.keys(texts).forEach(id => { delete next[id]; preloadingRef.current.delete(id); });
          return next;
        });
      })
      .catch(() => {});
  }, []);


  /* Load trilhas padrão do sistema */
  useEffect(() => {
    authedFetch("/api/instrumental-defaults")
      .then(r => r.json())
      .then(({ tracks }) => { if (tracks) setDefaultTracks(tracks); })
      .catch(() => {});
  }, []);

  /* Load trilhas customizadas do cliente (do banco de dados) */
  useEffect(() => {
    if (isAdmin) return; // admin não tem trilhas customizadas
    const token = useSessionStore.getState().token;
    if (!token) return;
    fetch("/api/client-instrumentals", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(({ tracks }) => {
        if (tracks) {
          const custom: Record<string, TrackSlot> = {};
          for (const [cat, data] of Object.entries(tracks) as [string, { url: string }][]) {
            const label = TRACK_CATEGORIES.find(c => c.id === cat)?.label ?? cat;
            custom[cat] = { name: label.toLowerCase(), url: data.url };
          }
          setCustomTracks(custom);
        }
      })
      .catch(() => {});
  }, [isAdmin]);

  /* Silent pre-play to warm up browser audio decoder */
  const primeAudio = (url: string): Promise<void> =>
    new Promise((resolve) => {
      const primer = new Audio(url);
      primer.volume = 0;
      primer.playbackRate = 16;
      const done = () => { primer.src = ""; resolve(); };
      primer.onended = done;
      primer.onerror = done;
      setTimeout(done, 6000); // safety timeout
      primer.play().catch(done);
    });

  /* Generate */
  const handleGenerate = async () => {
    if (!text.trim()) { toast.error("Digite o texto para narrar."); return; }
    if (!isAdmin && gensUsed >= MAX_GENERATIONS) { toast.error(`Limite de ${MAX_GENERATIONS} gerações atingido.`); return; }

    setIsGenerating(true);
    setAudioUrl(null);
    setIsPlaying(false);
    if (prevBlobUrl.current) { URL.revokeObjectURL(prevBlobUrl.current); prevBlobUrl.current = null; }

    try {
      // Gera o áudio — texto vai direto sem expansão para não corromper
      const res = await authedFetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voice: selectedVoice, speed: speed[0], userId, stability: VOICE_STABILITY, style: VOICE_STYLE }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error ?? "Erro ao gerar narração.");
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      prevBlobUrl.current = url;
      setAudioUrl(url);
      setCharsUsed(c => c + text.length);
      setGensUsed(g => g + 1);

      // Warm up: silent play at 16x before user hears it
      setIsPriming(true);
      await primeAudio(url);
      setIsPriming(false);

      // Auto-play after priming
      if (audioRef.current) {
        audioRef.current.src = url;
        onPreviewStart?.();
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
      setActiveOutput("voice");
      toast.success("Narração pronta!");
    } catch { toast.error("Falha na conexão."); }
    finally   { setIsGenerating(false); }
  };

  const handlePlayPause = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else { onPreviewStart?.(); audioRef.current.play().catch(() => {}); setIsPlaying(true); }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl; a.download = `locutor-${Date.now()}.mp3`; a.click();
  };

  const handleBlurCorrect = () => {};


  const recAudioCtxRef = useRef<AudioContext | null>(null);

  const stopRecording = () => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch { /* ignore */ } recognitionRef.current = null; }
    setIsRecording(false);
  };

  const handleDeleteRecording = () => {
    if (recAudioRef.current) { recAudioRef.current.pause(); recAudioRef.current.src = ""; }
    setRecAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setIsPlayingRec(false);
    setText("");
    setTwActive(true);
    setTwIndex(0);
  };

  const startRecording = async () => {
    try {
      // Isolated stream — não interfere com o player principal
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // Sem processamento de áudio — stream direto do microfone
      const audioCtx = new AudioContext();
      recAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);

      recChunksRef.current = [];
      // Detecta formato suportado: iOS/Safari usa mp4, demais usam webm
      const preferredMime = ["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg"]
        .find(t => MediaRecorder.isTypeSupported(t)) ?? "";
      const mr = preferredMime ? new MediaRecorder(dest.stream, { mimeType: preferredMime }) : new MediaRecorder(dest.stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const recordedMime = mr.mimeType || preferredMime || "audio/webm";
        const blob = new Blob(recChunksRef.current, { type: recordedMime });
        const blobUrl = URL.createObjectURL(blob);
        setRecAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return blobUrl; });
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close();

        // Gemini transcreve o áudio — base64 via FileReader (suporta buffers grandes)
        setIsTranscribing(true);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const mimeType = recordedMime;
          const res = await authedFetch("/api/tts-transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64, mimeType }),
          });
          const data = await res.json();
          if (data.transcript?.trim()) {
            stopTypewriter();
            setText(data.transcript.slice(0, MAX_CHARS));
            setIsPlayingRec(false);
          } else {
            toast.error("Não foi possível transcrever. Tente novamente.");
          }
        } catch {
          toast.error("Erro ao transcrever áudio.");
        } finally {
          setIsTranscribing(false);
        }
      };

      mr.start(500);
      stopTypewriter();
      setText("");
      setRecAudioUrl(null);
      setIsRecording(true);
      setRecSeconds(0);

      recTimerRef.current = setInterval(() => {
        setRecSeconds(s => {
          if (s >= 29) { stopRecording(); return 30; }
          return s + 1;
        });
      }, 1000);
    } catch {
      toast.error("Permissão de microfone negada.");
    }
  };

  const handleToggleRecording = () => {
    if (isRecording) { stopRecording(); return; }
    startRecording();
  };

  const handleValidateRecording = () => {
    setRecAudioUrl(null);
    setIsPlayingRec(false);
    toast.success("Texto validado! Clique em Gerar Narração.");
  };

  const handlePlayRecording = () => {
    if (!recAudioRef.current || !recAudioUrl) return;
    if (isPlayingRec) { recAudioRef.current.pause(); setIsPlayingRec(false); }
    else { recAudioRef.current.src = recAudioUrl; recAudioRef.current.play().catch(() => {}); setIsPlayingRec(true); }
  };

  const handleSaveVoice = async () => {
    if (!moodTestText.trim()) { toast.error("Digite o texto antes de salvar."); return; }
    setIsSavingVoice(true);
    try {
      const token = useSessionStore.getState().token;
      if (!token) { toast.error("Sessão expirada."); return; }

      // Salva o texto de preview específico para esta voz
      const r = await authedFetch("/api/admin/save-setting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `locutor_preview_${selectedVoice}`,
          value: moodTestText.trim(),
          accessToken: token,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "erro ao salvar");

      // Atualiza previewTexts + invalida cache para o play usar o novo texto imediatamente
      const newText = moodTestText.trim();
      const oldKey  = `${selectedVoice}::${previewTexts[selectedVoice] ?? "default"}`;
      setPreviewTexts(prev => ({ ...prev, [selectedVoice]: newText }));
      setPreviewCache(prev => {
        const n = { ...prev };
        delete n[oldKey];
        delete n[`${selectedVoice}::${newText}`];
        preloadingRef.current.delete(selectedVoice);
        return n;
      });
      setMoodTestText("");

      const voiceName = VOICE_OPTIONS.find(v => v.id === selectedVoice)?.label ?? "locutor";
      toast.success(`Fala do ${voiceName} salva no banco!`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(msg ? `Erro: ${msg}` : "Erro ao salvar configuração.");
    } finally {
      setIsSavingVoice(false);
    }
  };

  const handleMoodTest = async () => {
    if (!moodTestText.trim()) return;
    if (isTestPlaying && moodTestAudioRef.current) {
      moodTestAudioRef.current.pause();
      setIsTestPlaying(false);
      return;
    }
    setIsMoodTesting(true);
    try {
      const res = await authedFetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: moodTestText.trim(),
          voice: selectedVoice,
          stability: VOICE_STABILITY,
          style: VOICE_STYLE,
        }),
      });
      if (!res.ok) { toast.error("Erro ao testar voz."); return; }
      const blob = await res.blob();
      if (moodTestBlobUrl.current) URL.revokeObjectURL(moodTestBlobUrl.current);
      const url = URL.createObjectURL(blob);
      moodTestBlobUrl.current = url;
      if (moodTestAudioRef.current) {
        moodTestAudioRef.current.src = url;
        await moodTestAudioRef.current.play().catch(() => {});
        setIsTestPlaying(true);
      }
    } catch { toast.error("Falha na conexão."); }
    finally { setIsMoodTesting(false); }
  };

  const preloadingRef = useRef<Set<string>>(new Set());

  const fetchPreviewUrl = useCallback(async (voiceId: string, voiceName: string, customText?: string): Promise<string | null> => {
    const sampleText = customText?.trim() || `Eu sou o ${voiceName}, digita aí que eu comunico pra você.`;
    try {
      const res = await authedFetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sampleText, voice: voiceId, stability: VOICE_STABILITY, style: VOICE_STYLE }),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch { return null; }
  }, []);

  /* Sem preload automático — áudio gerado só ao clicar, garantindo texto correto */

  const handleVoicePreview = useCallback(async (voiceId: string, voiceName: string) => {
    if (previewingVoice === voiceId) {
      previewAudioRef.current?.pause();
      setPreviewingVoice(null);
      return;
    }
    setPreviewingVoice(voiceId);
    try {
      // Cache só é válido se foi gerado com o texto atual salvo
      const savedText = previewTexts[voiceId] ?? null;
      const cacheKey  = `${voiceId}::${savedText ?? "default"}`;
      let url = previewCache[cacheKey];
      if (!url) {
        url = (await fetchPreviewUrl(voiceId, voiceName, savedText ?? undefined)) ?? "";
        if (!url) { setPreviewingVoice(null); return; }
        setPreviewCache(prev => ({ ...prev, [cacheKey]: url }));
      }
      if (previewAudioRef.current) {
        previewAudioRef.current.src = url;
        previewAudioRef.current.play().catch(() => {});
        previewAudioRef.current.onended = () => setPreviewingVoice(null);
      }
    } catch {
      setPreviewingVoice(null);
    }
  }, [previewingVoice, previewCache, fetchPreviewUrl, previewTexts]);

  const handleInsert = (mode?: InsertMode, scheduledAt?: string) => {
    if (!audioUrl || !onInsert) return;
    const title = `Locutor: ${text.slice(0, 40)}${text.length > 40 ? "…" : ""}`;
    const m = mode ?? insertMode;
    onInsert(`direct:${audioUrl}`, m, title, scheduledAt);
    toast.success(scheduledAt ? `Narração agendada para ${scheduledAt}!` : "Narração inserida no player!");
    setShowSchedule(false);
    setSchedDate("");
    setSchedHour("");
    setSchedMin("");
  };

  /* Instrumental helpers */
  const getTrack = (category: string): TrackSlot | null =>
    customTracks[category] ?? defaultTracks[category] ?? null;

  const handleInstrumentalPreview = (category: string) => {
    if (!instrPreviewRef.current) return;
    if (previewingInstrumental === category) {
      instrPreviewRef.current.pause();
      setPreviewingInstrumental(null);
    } else {
      const track = getTrack(category);
      if (!track?.url) return;
      instrPreviewRef.current.src = track.url;
      instrPreviewRef.current.play().catch(() => {});
      setPreviewingInstrumental(category);
    }
  };

  const handleTrackDoubleClick = (category: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/mp3,audio/mpeg,audio/wav,audio/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const name = file.name.replace(/\.[^.]+$/, "");

      // Valida duração máxima de 3 minutos
      const tempUrl = URL.createObjectURL(file);
      const tempAudio = new Audio(tempUrl);
      const audioDuration = await new Promise<number>(resolve => {
        tempAudio.onloadedmetadata = () => resolve(tempAudio.duration);
        tempAudio.onerror = () => resolve(0);
        setTimeout(() => resolve(0), 5000);
      });
      URL.revokeObjectURL(tempUrl);
      if (audioDuration > 300) {
        toast.error("Trilha muito longa. Máximo 5 minutos (300s).");
        return;
      }
      if (isAdmin) {
        setIsUploadingDefault(category);
        const blobUrl = URL.createObjectURL(file);
        try {
          const token = useSessionStore.getState().token;
          if (!token) { toast.error("Sessão expirada. Faça login novamente."); return; }
          const fd = new FormData();
          fd.append("file", file);
          fd.append("category", category);
          fd.append("accessToken", token);
          const res = await authedFetch("/api/instrumental-defaults", { method: "POST", body: fd });
          if (!res.ok) { toast.error("Erro ao salvar trilha."); URL.revokeObjectURL(blobUrl); return; }
          const { url: signedUrl, name: savedName } = await res.json();
          URL.revokeObjectURL(blobUrl);
          setDefaultTracks(prev => ({ ...prev, [category]: { name: savedName, url: signedUrl } }));
          setCustomTracks(prev => { const n = { ...prev }; delete n[category]; return n; });
          const label = TRACK_CATEGORIES.find(c => c.id === category)?.label ?? category;
          toast.success(`Padrão de "${label}" atualizado para todos!`);
        } catch { toast.error("Falha ao enviar trilha."); URL.revokeObjectURL(blobUrl); }
        finally { setIsUploadingDefault(null); }
      } else {
        // Cliente: salva no banco de dados via API
        try {
          const token = useSessionStore.getState().token;
          if (!token) { toast.error("Sessão expirada. Faça login novamente."); return; }

          setIsUploadingDefault(category);
          const fd = new FormData();
          fd.append("file", file);
          fd.append("category", category);
          fd.append("accessToken", token);
          const res = await authedFetch("/api/client-instrumentals", { method: "POST", body: fd });
          if (!res.ok) { toast.error("Erro ao salvar trilha."); return; }
          const { url: signedUrl } = await res.json();
          const label = TRACK_CATEGORIES.find(c => c.id === category)?.label ?? category;
          setCustomTracks(prev => ({ ...prev, [category]: { name: label.toLowerCase(), url: signedUrl } }));
          toast.success("Trilha personalizada salva!");
        } catch { toast.error("Falha ao enviar trilha."); }
        finally { setIsUploadingDefault(null); }
      }
    };
    input.click();
  };

  const handleMix = async () => {
    if (!audioUrl || !selectedInstrumental) return;
    const track = getTrack(selectedInstrumental);
    if (!track?.url) { toast.error("URL da trilha indisponível."); return; }
    setIsMixing(true);
    try {
      const [vRes, iRes] = await Promise.all([fetch(audioUrl), fetch(track.url)]);
      const [vAb, iAb]   = await Promise.all([vRes.arrayBuffer(), iRes.arrayBuffer()]);
      const ctx = new AudioContext();
      const [vBuf, iBuf] = await Promise.all([ctx.decodeAudioData(vAb), ctx.decodeAudioData(iAb)]);
      await ctx.close();

      const cfg = MIX_CONFIG[selectedInstrumental] ?? { intro: 1.5, outro: 1.5, vol: 1.0, duckVol: 0.10 };
      const INTRO_DUR = cfg.intro;
      const OUTRO_DUR = cfg.outro;
      const sr   = vBuf.sampleRate;
      const nch  = Math.max(vBuf.numberOfChannels, iBuf.numberOfChannels);
      const vDur = vBuf.duration;
      const iDur = iBuf.duration;

      // A voz toca sempre em velocidade 1.0 (sem distorção de pitch)
      // O body da trilha loopa para preencher o tempo da voz
      const mixDur    = INTRO_DUR + vDur + OUTRO_DUR;
      const bodyStart = INTRO_DUR;
      const bodyEnd   = Math.max(bodyStart + 0.01, iDur - OUTRO_DUR);

      const offline = new OfflineAudioContext(nch, Math.ceil(sr * mixDur), sr);
      const iGain = offline.createGain();
      const volNormal = 0.28 * cfg.vol;
      const volDuck   = (trackDuckVol[selectedInstrumental] ?? cfg.duckVol) * cfg.vol;
      iGain.gain.value = volNormal;
      // Duck durante a voz, intro e outro ficam no volume normal
      iGain.gain.setValueAtTime(volNormal, 0);
      iGain.gain.linearRampToValueAtTime(volDuck, INTRO_DUR + 0.2);
      iGain.gain.setValueAtTime(volDuck, INTRO_DUR + vDur - 0.2);
      iGain.gain.linearRampToValueAtTime(volNormal, INTRO_DUR + vDur);
      iGain.connect(offline.destination);

      // 1. INTRO
      const introSrc = offline.createBufferSource();
      introSrc.buffer = iBuf;
      introSrc.connect(iGain);
      introSrc.start(0, 0);
      introSrc.stop(INTRO_DUR);

      // 2. BODY — loopa sob a voz pelo tempo exato que ela precisar
      const bodySrc = offline.createBufferSource();
      bodySrc.buffer = iBuf;
      bodySrc.loop = true;
      bodySrc.loopStart = bodyStart;
      bodySrc.loopEnd   = bodyEnd;
      bodySrc.connect(iGain);
      bodySrc.start(INTRO_DUR, bodyStart);
      bodySrc.stop(INTRO_DUR + vDur);

      // 3. OUTRO
      const outroSrc = offline.createBufferSource();
      outroSrc.buffer = iBuf;
      outroSrc.connect(iGain);
      outroSrc.start(INTRO_DUR + vDur, bodyEnd);

      // 4. VOICE — sem alteração de playbackRate, velocidade já foi aplicada pelo ElevenLabs
      const vSrc  = offline.createBufferSource(); vSrc.buffer = vBuf;
      const vGain = offline.createGain(); vGain.gain.value = 1.4;
      vSrc.connect(vGain); vGain.connect(offline.destination);
      vSrc.start(INTRO_DUR);

      const rendered = await offline.startRendering();
      const blob = audioBufferToWav(rendered);
      if (mixedBlobRef.current) URL.revokeObjectURL(mixedBlobRef.current);
      const url = URL.createObjectURL(blob);
      mixedBlobRef.current = url;
      setMixedAudioUrl(url);
      setIsMixedPlaying(false);
      setActiveOutput("spot");
      toast.success("Spot com trilha criado!");
    } catch (e) { console.error("[handleMix]", e); toast.error("Erro ao misturar áudio."); }
    finally { setIsMixing(false); }
  };

  const handleMixedPlayPause = () => {
    if (!mixedAudioRef.current || !mixedAudioUrl) return;
    if (isMixedPlaying) { mixedAudioRef.current.pause(); setIsMixedPlaying(false); }
    else { onPreviewStart?.(); mixedAudioRef.current.play().catch(() => {}); setIsMixedPlaying(true); }
  };

  const handleMixedDownload = () => {
    if (!mixedAudioUrl) return;
    const a = document.createElement("a");
    a.href = mixedAudioUrl; a.download = `spot-trilha-${Date.now()}.wav`; a.click();
  };

  const handleInsertMixed = (mode?: InsertMode, scheduledAt?: string) => {
    if (!mixedAudioUrl || !onInsert) return;
    const track = selectedInstrumental ? getTrack(selectedInstrumental) : null;
    const name  = spotName.trim() || text.slice(0, 28) + (text.length > 28 ? "…" : "");
    const title = `Spot: ${name} + ${track?.name ?? "trilha"}`;
    onInsert(`direct:${mixedAudioUrl}`, mode ?? "queue", title, scheduledAt);
    const who = userName ? ` · ${userName}` : "";
    toast.success(scheduledAt ? `Spot agendado${who}!` : `Spot inserido no player${who}!`);
  };

  const gensLeft  = isAdmin ? Infinity : Math.max(0, MAX_GENERATIONS - gensUsed);
  const usagePct  = Math.min(100, (gensUsed / MAX_GENERATIONS) * 100);
  const charCount = text.length;

  return (
    <div className="max-w-2xl mx-auto relative">
      {/* Locked badge */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none transition-all duration-300 ${lockedBadge ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"}`}>
        <div className="flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-full px-3 py-1.5 shadow-md whitespace-nowrap">
          <Lock className="h-3 w-3 text-primary shrink-0" />
          <p className="text-xs font-medium">Atualize seu plano para usar esse recurso.</p>
        </div>
      </div>

      {/* Hidden preview audio element */}
      <audio ref={previewAudioRef} className="hidden" />

      {/* Single card — fixed height, no resize */}
      <div className="bg-card rounded-xl p-4 sm:p-5 flex flex-col gap-3 overflow-hidden">

        {/* Gemini correction badge — espaço fixo, sem layout shift */}
        <div className="h-5 flex items-center justify-center">
          <div className={`transition-opacity duration-300 ${geminiCorrected || isCorrectingBlur ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <Badge variant="outline" className="text-[10px] border-primary text-primary flex items-center gap-1">
              {isCorrectingBlur
                ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Corrigindo…</>
                : <>✏️ EDU corrigiu</>
              }
            </Badge>
          </div>
        </div>

        {/* Textarea */}
        <div className="relative rounded-lg border bg-secondary/40 shrink-0">
          <textarea
            ref={textareaRef}
            value={twActive ? TYPEWRITER_TEXT.slice(0, twIndex) : text}
            onChange={(e) => {
              if (twActive) {
                stopTypewriter();
                setText(e.target.value.replace(TYPEWRITER_TEXT.slice(0, twIndex), "").slice(0, MAX_CHARS));
              } else {
                setText(e.target.value.slice(0, MAX_CHARS));
              }
            }}
            onKeyDown={(e) => {
              if (twActive && e.key.length === 1) {
                stopTypewriter();
                setText("");
              }
            }}
            rows={5}
            title="Texto para narração"
            placeholder=""
            spellCheck={true}
            lang="pt-BR"
            onBlur={handleBlurCorrect}
            className={[
              "w-full resize-none bg-transparent border-0 outline-none px-3 pt-3 pb-7 text-sm focus:ring-0",
              twActive ? "text-muted-foreground/50 italic" : "text-foreground",
              text.length >= MAX_CHARS ? "text-destructive" : "",
            ].join(" ")}
          />
          <div className="absolute bottom-0 left-0 right-0 px-3 py-1.5 flex items-center justify-between">
            {isRecording ? (
              <button type="button" onClick={handleToggleRecording}
                className="flex items-center gap-1.5 text-[10px] font-semibold text-destructive">
                <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                {recSeconds}s / 30s — parar
              </button>
            ) : isTranscribing ? (
              <div className="flex items-center gap-1.5 text-[10px] text-primary animate-in fade-in duration-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                Transcrevendo…
              </div>
            ) : recAudioUrl ? (
              <div className="flex items-center gap-2.5 animate-in fade-in duration-300">
                <button type="button" onClick={handlePlayRecording}
                  className="flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors">
                  {isPlayingRec ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  Ouvir
                </button>
                <button type="button" onClick={() => {
                    if (recAudioRef.current) { recAudioRef.current.pause(); recAudioRef.current.src = ""; }
                    setRecAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
                    setIsPlayingRec(false);
                    setText("");
                    setTwActive(true);
                    setTwIndex(0);
                  }}
                  className="flex items-center gap-1 text-[10px] font-medium text-orange-400 hover:text-orange-300 transition-colors">
                  <Mic className="h-3 w-3" />
                  Regravar
                </button>
              </div>
            ) : (
              <button type="button" onClick={handleToggleRecording}
                className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-primary transition-colors">
                Grave <Mic className="h-3 w-3" /> que transcreveremos
              </button>
            )}
            <span className={`text-[10px] ${charCount >= MAX_CHARS * 0.9 ? "text-yellow-500 font-semibold" : "text-muted-foreground"}`}>
              {charCount}/{MAX_CHARS}
            </span>
          </div>
        </div>
        <audio ref={recAudioRef} onEnded={() => setIsPlayingRec(false)} className="hidden" />


        {/* Voice cards */}
        <div className="shrink-0">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Selecione o locutor</label>
          <div className="grid grid-cols-2 gap-1.5">
            {VOICE_OPTIONS.map((v) => {
              const isSelected = selectedVoice === v.id;
              const isPreviewing = previewingVoice === v.id;
              const cacheKey = `${v.id}::${previewTexts[v.id] ?? "default"}`;
              const isCached = Boolean(previewCache[cacheKey]);
              return (
                <div
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedVoice(v.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedVoice(v.id); }}
                  className={`relative flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 border transition-all cursor-pointer select-none ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/40 bg-secondary/30 text-muted-foreground hover:border-primary/40 hover:bg-secondary/60"
                  }`}
                >
                  <span className="text-[11px] font-bold leading-tight">{v.label}</span>
                  {/* Preview play button — div not button to avoid nesting */}
                  <div
                    role="button"
                    tabIndex={0}
                    title={`Ouvir ${v.label}`}
                    onClick={(e) => { e.stopPropagation(); handleVoicePreview(v.id, v.label); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); handleVoicePreview(v.id, v.label); }}}
                    className={`mt-1 flex items-center justify-center rounded-full w-5 h-5 transition-colors cursor-pointer ${
                      isPreviewing
                        ? "bg-primary text-primary-foreground"
                        : isCached
                          ? "bg-primary/20 text-primary hover:bg-primary/40"
                          : "bg-secondary/60 text-muted-foreground hover:bg-primary/20 hover:text-primary"
                    }`}
                  >
                    {isPreviewing
                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      : <Play className="h-2.5 w-2.5" />
                    }
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Admin voice test + save */}
        {isAdmin && (
          <div className="shrink-0 rounded-lg border border-primary/20 bg-secondary/20 px-3 py-2.5 space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Headphones className="h-3 w-3 text-primary" />
              Testar e definir locutor padrão
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Digite o texto de apresentação do locutor…"
                value={moodTestText}
                onChange={e => setMoodTestText(e.target.value.slice(0, 200))}
                onKeyDown={e => { if (e.key === "Enter") handleMoodTest(); }}
                className="flex-1 min-w-0 bg-secondary/50 border border-border/40 rounded-md px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/60 placeholder:text-muted-foreground/50"
              />
              <button
                type="button"
                title="Testar"
                onClick={handleMoodTest}
                disabled={isMoodTesting || !moodTestText.trim()}
                className={`flex items-center justify-center w-8 h-8 rounded-md border transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                  isTestPlaying
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                }`}
              >
                {isMoodTesting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : isTestPlaying
                    ? <Pause className="h-3.5 w-3.5" />
                    : <Play className="h-3.5 w-3.5" />
                }
              </button>
            </div>
            <audio ref={moodTestAudioRef} onEnded={() => setIsTestPlaying(false)} className="hidden" />
            <button
              type="button"
              onClick={handleSaveVoice}
              disabled={isSavingVoice}
              className="w-full flex items-center justify-center gap-1.5 bg-primary text-primary-foreground text-[11px] font-bold py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {isSavingVoice
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Salvando…</>
                : <>Salvar novo texto como a nova fala</>
              }
            </button>
          </div>
        )}

        {/* Speed */}
        <div className="shrink-0 flex flex-col items-center">
          <label className="text-xs font-medium text-muted-foreground mb-1">
            Velocidade: {speed[0].toFixed(1)}x
          </label>
          <div className="w-48">
            <Slider value={speed} onValueChange={setSpeed} min={0.7} max={1.2} step={0.1} />
          </div>
        </div>

        {/* Generate button */}
        <Button
          onClick={isLocked ? showBadge : handleGenerate}
          disabled={!isLocked && (isGenerating || isPriming || !text.trim() || charCount > MAX_CHARS || (!isAdmin && gensLeft === 0))}
          className="w-full font-semibold bg-primary text-primary-foreground hover:bg-primary/90 h-10 shrink-0"
        >
          {isGenerating
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando narração…</>
            : isPriming
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Preparando áudio…</>
              : <><Radio className="h-4 w-4 mr-2" /> Gerar Narração</>
          }
        </Button>

        {!isAdmin && gensLeft === 0 && (
          <p className="text-xs text-destructive text-center -mt-1 shrink-0">Limite mensal atingido. Renova no próximo mês.</p>
        )}

        {/* Admin: ElevenLabs quota monitor */}
        {isAdmin && (
          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-secondary/30 px-3 py-2 shrink-0">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-medium text-muted-foreground">Créditos ElevenLabs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-semibold tabular-nums ${charsUsed / ELEVENLABS_QUOTA >= 0.8 ? "text-destructive" : charsUsed / ELEVENLABS_QUOTA >= 0.5 ? "text-yellow-500" : "text-primary"}`}>
                {charsUsed.toLocaleString("pt-BR")}
              </span>
              <span className="text-xs text-muted-foreground">/ {ELEVENLABS_QUOTA.toLocaleString("pt-BR")} chars</span>
            </div>
          </div>
        )}

        {/* Audio elements ocultos */}
        <audio ref={audioRef} src={audioUrl ?? undefined} onEnded={() => setIsPlaying(false)} className="hidden" />

        <div className="border-t border-border/40 pt-3 space-y-3 shrink-0">
            {/* Trilha sonora — cards fixos, sempre visíveis */}
            <div className="border-t border-border/40 pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Music className="h-3.5 w-3.5 text-primary" /> Trilha sonora
                  </h4>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">Use nossas trilhas ou importe as suas</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  {TRACK_CATEGORIES.map(cat => {
                    const isSelected  = selectedInstrumental === cat.id;
                    const isPreviewing = previewingInstrumental === cat.id;
                    const hasCustom   = !!customTracks[cat.id];
                    const isUploading = isUploadingDefault === cat.id;
                    return (
                      <div
                        key={cat.id}
                        onClick={() => {
                          if (trackClickTimerRef.current) return;
                          trackClickTimerRef.current = setTimeout(() => {
                            trackClickTimerRef.current = null;
                            setSelectedInstrumental(cat.id);
                            handleInstrumentalPreview(cat.id);
                          }, 250);
                        }}
                        onDoubleClick={() => {
                          if (trackClickTimerRef.current) {
                            clearTimeout(trackClickTimerRef.current);
                            trackClickTimerRef.current = null;
                          }
                          handleTrackDoubleClick(cat.id);
                        }}
                        className={`relative flex items-center gap-1.5 p-2 rounded-lg cursor-pointer border transition-all select-none
                          ${isSelected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/30 bg-secondary/20 text-muted-foreground hover:border-primary/40 hover:bg-secondary/30"
                          }`}
                      >
                        {isPreviewing
                          ? <Pause className="h-3.5 w-3.5 shrink-0" />
                          : <Play className="h-3.5 w-3.5 shrink-0" />
                        }

                        <span className="text-[10px] font-semibold uppercase tracking-wider leading-none truncate">{cat.label}</span>

                        <div className="ml-auto flex items-center gap-0.5 shrink-0">
                          {hasCustom && (
                            <button
                              type="button"
                              onClick={async e => {
                                e.stopPropagation();
                                // Deleta do banco de dados
                                try {
                                  const token = useSessionStore.getState().token;
                                  if (token) {
                                    await authedFetch("/api/client-instrumentals", {
                                      method: "DELETE",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ category: cat.id, accessToken: token }),
                                    });
                                  }
                                } catch { /* silently fall back */ }
                                setCustomTracks(prev => { const n = { ...prev }; delete n[cat.id]; return n; });
                                toast.success(`"${cat.label}" voltou ao padrão do sistema`);
                              }}
                              className="opacity-40 hover:opacity-90 transition-opacity"
                              title="Voltar ao padrão do sistema"
                            >
                              <RotateCcw className="h-2.5 w-2.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); }}
                            onDoubleClick={e => { e.stopPropagation(); handleTrackDoubleClick(cat.id); }}
                            className="opacity-30 hover:opacity-90 transition-opacity"
                            title="Clique duas vezes para importar sua própria trilha"
                          >
                            {isUploading
                              ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              : <Pencil className="h-2.5 w-2.5" />
                            }
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Button
                  size="sm"
                  onClick={() => {
                    if (!audioUrl) { toast.info("Primeiro gere a narração clicando em 'Gerar Narração'."); return; }
                    if (!selectedInstrumental) { toast.info("Selecione uma trilha acima para criar o spot."); return; }
                    handleMix();
                  }}
                  disabled={isMixing}
                  className="w-full h-8 text-xs font-semibold"
                >
                  {isMixing
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Misturando…</>
                    : <><Music className="h-3.5 w-3.5 mr-1.5" /> Criar Spot com Trilha</>
                  }
                </Button>

                {/* Campo nome do spot — aparece após criar */}
                {mixedAudioUrl && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Nome do spot (opcional)…"
                      value={spotName}
                      onChange={e => setSpotName(e.target.value.slice(0, 50))}
                      className="flex-1 bg-secondary/50 border border-border/40 rounded-md px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/60 placeholder:text-muted-foreground/50"
                    />
                  </div>
                )}

                <audio ref={mixedAudioRef} src={mixedAudioUrl ?? undefined} onEnded={() => setIsMixedPlaying(false)} className="hidden" />
                <audio ref={instrPreviewRef} onEnded={() => setPreviewingInstrumental(null)} className="hidden" />
              </div>
            </div>

            {/* Botões unificados — play, baixar e inserir no player */}
            <div className="border-t border-border/40 pt-3 space-y-2">
              {/* Play + Download */}
              <div className="flex gap-2">
                <Button size="sm" variant="outline"
                  onClick={() => { activeOutput === "voice" ? handlePlayPause() : handleMixedPlayPause(); }}
                  className="border-primary text-primary active:scale-95 transition-transform h-8 flex-1">
                  {(activeOutput === "voice" ? isPlaying : isMixedPlaying)
                    ? <><Pause className="h-3.5 w-3.5 mr-1" /> Pausar</>
                    : <><Play className="h-3.5 w-3.5 mr-1" /> Ouvir</>
                  }
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => { activeOutput === "voice" ? handleDownload() : handleMixedDownload(); }}
                  className="border-primary text-primary active:scale-95 transition-transform h-8 flex-1">
                  <Download className="h-3.5 w-3.5 mr-1" /> Baixar MP3
                </Button>
              </div>

              {onInsert && (
              <div className="space-y-2">
                {/* Ações */}
                <div className="grid grid-cols-3 gap-2">
                  <button type="button"
                    onClick={() => {
                      if (activeOutput === "voice") {
                        if (!audioUrl) { toast.info("Gere a narração primeiro."); return; }
                        handleInsert("queue");
                      } else {
                        if (!mixedAudioUrl) { toast.info("Crie o spot primeiro."); return; }
                        handleInsertMixed("queue");
                      }
                    }}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg bg-secondary/40 hover:bg-primary/20 hover:text-primary text-muted-foreground transition-colors active:scale-95">
                    <SkipForward className="h-4 w-4" />
                    <span className="text-[10px] font-semibold leading-tight text-center">Tocar a seguir</span>
                  </button>
                  <button type="button"
                    onClick={() => {
                      if (activeOutput === "voice") {
                        if (!audioUrl) { toast.info("Gere a narração primeiro."); return; }
                        handleInsert("interrupt");
                      } else {
                        if (!mixedAudioUrl) { toast.info("Crie o spot primeiro."); return; }
                        handleInsertMixed("interrupt");
                      }
                    }}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg bg-secondary/40 hover:bg-primary/20 hover:text-primary text-muted-foreground transition-colors active:scale-95">
                    <Zap className="h-4 w-4" />
                    <span className="text-[10px] font-semibold leading-tight text-center">Tocar imediatamente</span>
                  </button>
                  <div className="relative">
                    <button type="button"
                      onClick={() => setShowSchedule(s => !s)}
                      className={`w-full flex flex-col items-center gap-1 p-2 rounded-lg transition-colors active:scale-95 ${showSchedule ? "bg-primary/20 text-primary ring-1 ring-primary/30" : "bg-secondary/40 text-muted-foreground hover:bg-primary/20 hover:text-primary"}`}>
                      <CalendarClock className="h-4 w-4" />
                      <span className="text-[10px] font-semibold leading-tight text-center">Programar</span>
                    </button>

                    {/* Popover que abre pra cima */}
                    {showSchedule && (
                      <div ref={schedulePopoverRef}
                        className="absolute bottom-full mb-2 right-0 w-52 z-50 rounded-lg border border-primary/30 bg-card shadow-xl p-2 space-y-1.5">
                        {/* Início */}
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold uppercase text-muted-foreground/60 w-7 shrink-0">Ini</span>
                          <input type="date" title="Data início" value={schedDate}
                            onChange={e => setSchedDate(e.target.value)}
                            className="flex-1 min-w-0 bg-secondary/50 border border-border/40 rounded px-1 py-0.5 text-[10px] text-foreground outline-none focus:border-primary/60" />
                          <div className="relative shrink-0">
                            <Clock className="absolute left-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground pointer-events-none" />
                            <input type="time" title="Hora início" value={schedTime}
                              onChange={e => setSchedTime(e.target.value)}
                              className="pl-5 pr-0.5 py-0.5 w-16 bg-secondary/50 border border-border/40 rounded text-[10px] text-foreground outline-none focus:border-primary/60 font-mono" />
                          </div>
                        </div>
                        {/* Fim */}
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold uppercase text-muted-foreground/60 w-7 shrink-0">Fim</span>
                          <input type="date" title="Data fim" value={schedEndDate}
                            onChange={e => setSchedEndDate(e.target.value)}
                            className="flex-1 min-w-0 bg-secondary/50 border border-border/40 rounded px-1 py-0.5 text-[10px] text-foreground outline-none focus:border-primary/60" />
                          <div className="relative shrink-0">
                            <Clock className="absolute left-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground pointer-events-none" />
                            <input type="time" title="Hora fim" value={schedEndTime}
                              onChange={e => setSchedEndTime(e.target.value)}
                              className="pl-5 pr-0.5 py-0.5 w-16 bg-secondary/50 border border-border/40 rounded text-[10px] text-foreground outline-none focus:border-primary/60 font-mono" />
                          </div>
                        </div>
                        <button type="button"
                          disabled={!schedDate || !schedTime}
                          onClick={() => {
                            const start = `${schedDate}T${schedTime}`;
                            if (activeOutput === "voice") handleInsert("scheduled", start);
                            else handleInsertMixed("scheduled", start);
                            setShowSchedule(false);
                          }}
                          className="w-full bg-primary text-primary-foreground text-[11px] font-bold py-1.5 rounded disabled:opacity-40 hover:bg-primary/90 transition-colors">
                          Confirmar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}
            </div>
          </div>
      </div>
    </div>
  );
};

export default LocutorVirtualPanel;
