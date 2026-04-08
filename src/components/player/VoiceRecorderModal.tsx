"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Play, Pause, Square, Volume2, Check, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { getSupportedAudioMimeType } from "@/lib/mediaRecorderUtils";

export type InsertMode = "queue" | "interrupt" | "scheduled";

interface VoiceRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when user clicks Inserir. blobUrl is a `direct:<blob>` file_path. */
  onInsert: (directFilePath: string, mode: InsertMode, title: string) => void;
  /** Called when preview starts — caller should pause main player */
  onPreviewStart: () => void;
  /** Called when preview ends — caller may resume if desired */
  onPreviewEnd: () => void;
}

const MAX_SECONDS = 30;
const CIRCUMFERENCE = 2 * Math.PI * 40; // radius = 40

const INSERT_MODES: { key: InsertMode; label: string; desc: string }[] = [
  { key: "queue",     label: "Na fila",   desc: "Após música atual" },
  { key: "interrupt", label: "Imediato",  desc: "Interrompe agora"  },
  { key: "scheduled", label: "Agendado",  desc: "No próx. intervalo" },
];

export default function VoiceRecorderModal({
  isOpen, onClose, onInsert, onPreviewStart, onPreviewEnd,
}: VoiceRecorderModalProps) {
  const [phase, setPhase] = useState<"idle" | "recording" | "preview">("idle");
  const [countdown, setCountdown]     = useState(MAX_SECONDS);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewVolume, setPreviewVolume]   = useState(0.9);
  const [insertMode, setInsertMode]         = useState<InsertMode>("queue");
  const [blobUrl, setBlobUrl]               = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef  = useRef<AudioContext | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const countdownRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef  = useRef<HTMLAudioElement | null>(null);

  /* ── cleanup helpers ── */
  const stopCountdown = () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  };

  const stopRecording = useCallback(() => {
    stopCountdown();
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    stopStream();
  }, []);

  /* ── start recording ── */
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      // Build Web Audio chain: source → compressor → destination
      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const source     = ctx.createMediaStreamSource(stream);
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-24, ctx.currentTime);
      compressor.knee.setValueAtTime(30, ctx.currentTime);
      compressor.ratio.setValueAtTime(12, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.25, ctx.currentTime);

      const dest = ctx.createMediaStreamDestination();
      source.connect(compressor);
      compressor.connect(dest);

      // Use compressed stream for recording
      const mimeType = getSupportedAudioMimeType();

      const recorder = new MediaRecorder(dest.stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url  = URL.createObjectURL(blob);
        setBlobUrl(url);
        setPhase("preview");
      };

      recorder.start(100); // collect every 100ms
      setPhase("recording");
      setCountdown(MAX_SECONDS);

      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { stopRecording(); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch {
      toast.error("Microfone sem permissão ou indisponível.");
    }
  };

  /* ── preview control ── */
  const handlePreviewPlayPause = () => {
    if (!previewAudioRef.current || !blobUrl) return;

    if (previewPlaying) {
      previewAudioRef.current.pause();
      setPreviewPlaying(false);
      onPreviewEnd();
    } else {
      onPreviewStart();
      previewAudioRef.current.src = blobUrl;
      previewAudioRef.current.volume = previewVolume;
      previewAudioRef.current.play().catch(() => {});
      setPreviewPlaying(true);
    }
  };

  useEffect(() => {
    if (previewAudioRef.current) previewAudioRef.current.volume = previewVolume;
  }, [previewVolume]);

  /* ── insert into player ── */
  const handleInsert = () => {
    if (!blobUrl) return;
    // Use the `direct:` prefix so the audio cascade returns the blob URL directly
    onInsert(`direct:${blobUrl}`, insertMode, `Gravação ${new Date().toLocaleTimeString("pt-BR")}`);
    // Don't revoke blobUrl yet — player needs it until the song finishes
    resetState();
    onClose();
    toast.success("Gravação inserida!");
  };

  const resetState = () => {
    stopCountdown();
    stopStream();
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      onPreviewEnd();
    }
    setPreviewPlaying(false);
    setPhase("idle");
    setCountdown(MAX_SECONDS);
    // Note: do NOT revoke blobUrl here if it was inserted into the queue
  };

  const handleClose = () => {
    stopCountdown();
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    stopStream();
    if (previewAudioRef.current) { previewAudioRef.current.pause(); onPreviewEnd(); }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setPreviewPlaying(false);
    setPhase("idle");
    setCountdown(MAX_SECONDS);
    onClose();
  };

  // Cleanup on unmount
  useEffect(() => () => {
    stopCountdown();
    stopStream();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isOpen) return null;

  const strokeOffset = CIRCUMFERENCE * (countdown / MAX_SECONDS);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative z-10 w-full max-w-md bg-card rounded-2xl p-6 space-y-5 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">Gravação de Voz</h3>
          </div>
          <button type="button" onClick={handleClose} aria-label="Fechar" title="Fechar" className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── IDLE / RECORDING ── */}
        {(phase === "idle" || phase === "recording") && (
          <div className="flex flex-col items-center gap-5">

            {/* Circular countdown */}
            <div className="relative w-32 h-32">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
                {/* Track */}
                <circle cx="48" cy="48" r="40" fill="none" strokeWidth="6"
                  className="stroke-secondary" />
                {/* Progress (drains as time passes) */}
                {phase === "recording" && (
                  <circle cx="48" cy="48" r="40" fill="none" strokeWidth="6"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE - strokeOffset}
                    strokeLinecap="round"
                    className="stroke-primary transition-all duration-1000" />
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {phase === "recording" ? (
                  <>
                    <span className="text-3xl font-bold tabular-nums">{countdown}</span>
                    <span className="text-[10px] text-muted-foreground">seg</span>
                  </>
                ) : (
                  <Mic className="h-10 w-10 text-primary" />
                )}
              </div>
            </div>

            {phase === "idle" ? (
              <Button onClick={startRecording} className="bg-primary text-primary-foreground px-8">
                <Mic className="h-4 w-4 mr-2" /> Iniciar Gravação
              </Button>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm text-muted-foreground">Gravando… player continua tocando</span>
                </div>
                <Button size="sm" variant="outline" onClick={stopRecording}>
                  <Square className="h-3.5 w-3.5 mr-1" /> Parar
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── PREVIEW ── */}
        {phase === "preview" && (
          <div className="space-y-4">
            <audio
              ref={previewAudioRef}
              onEnded={() => { setPreviewPlaying(false); onPreviewEnd(); }}
            />

            {/* Player row */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
              <button
                type="button"
                aria-label={previewPlaying ? "Pausar preview" : "Ouvir gravação"}
                onClick={handlePreviewPlayPause}
                className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform shrink-0"
              >
                {previewPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Sua Gravação</p>
                <p className="text-[11px] text-muted-foreground">
                  {previewPlaying ? "Ouvindo… player principal pausado" : "Clique para ouvir"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setBlobUrl(null); setPhase("idle"); setCountdown(MAX_SECONDS); }}
                title="Regravar"
                aria-label="Regravar"
                className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Preview volume */}
            <div className="flex items-center gap-3">
              <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <Slider
                value={[Math.round(previewVolume * 100)]}
                max={100} step={1}
                className="flex-1 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                onValueChange={([v]) => setPreviewVolume(v / 100)}
              />
              <span className="text-xs text-muted-foreground w-8 text-right">
                {Math.round(previewVolume * 100)}%
              </span>
            </div>

            {/* Insert mode */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Modo de inserção
              </p>
              <div className="grid grid-cols-3 gap-2">
                {INSERT_MODES.map(opt => (
                  <button
                    type="button"
                    key={opt.key}
                    onClick={() => setInsertMode(opt.key)}
                    className={`p-2.5 rounded-lg text-left transition-colors ${
                      insertMode === opt.key
                        ? "bg-primary/20 text-primary ring-1 ring-primary/30"
                        : "bg-secondary/40 text-muted-foreground hover:bg-secondary/60"
                    }`}
                  >
                    <p className="text-xs font-semibold leading-tight">{opt.label}</p>
                    <p className="text-[10px] mt-0.5 leading-tight">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={handleClose} className="flex-1 text-xs">
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={handleInsert}
                className="flex-1 text-xs bg-primary text-primary-foreground">
                <Check className="h-3.5 w-3.5 mr-1" /> Inserir no Player
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
