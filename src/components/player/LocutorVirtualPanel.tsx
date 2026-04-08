"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, Play, Pause, Download, Volume2, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import type { InsertMode } from "@/components/player/VoiceRecorderModal";
import { getSupportedAudioMimeType, getVoices, isIOS } from "@/lib/mediaRecorderUtils";

const VOICE_OPTIONS = [
  { id: "feminina-jovem",  label: "Feminina Jovem"   },
  { id: "feminina-madura", label: "Feminina Madura"  },
  { id: "masculina-jovem", label: "Masculina Jovem"  },
  { id: "masculina-madura",label: "Masculina Madura" },
];

const INSERT_MODES: { key: InsertMode; label: string; desc: string }[] = [
  { key: "queue",     label: "Na fila",  desc: "Após música atual"   },
  { key: "interrupt", label: "Imediato", desc: "Interrompe agora"    },
  { key: "scheduled", label: "Agendado", desc: "No próx. intervalo" },
];

interface LocutorVirtualPanelProps {
  /** When provided, the Inserir button appears and calls this with the blob path */
  onInsert?: (directFilePath: string, mode: InsertMode, title: string) => void;
  /** Pause the main player before preview playback */
  onPreviewStart?: () => void;
}

const LocutorVirtualPanel = ({ onInsert, onPreviewStart }: LocutorVirtualPanelProps) => {
  const [text, setText]                 = useState("");
  const [selectedVoice, setSelectedVoice] = useState("feminina-jovem");
  const [speed, setSpeed]               = useState([1.0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl]         = useState<string | null>(null);
  const [isPlaying, setIsPlaying]       = useState(false);
  const [insertMode, setInsertMode]     = useState<InsertMode>("queue");
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleGenerate = async () => {
    if (!text.trim()) {
      toast.error("Digite o texto para o locutor narrar.");
      return;
    }

    setIsGenerating(true);
    setAudioUrl(null);
    setIsPlaying(false);

    try {
      const utterance   = new SpeechSynthesisUtterance(text);
      utterance.lang    = "pt-BR";
      utterance.rate    = speed[0];

      // iOS Safari loads voices asynchronously — use getVoices() helper
      const allVoices  = await getVoices();
      const isFemale   = selectedVoice.startsWith("feminina");
      const ptVoices   = allVoices.filter((v) => v.lang.startsWith("pt"));

      if (ptVoices.length > 0) {
        const filtered = ptVoices.filter((v) => {
          const n = v.name.toLowerCase();
          return isFemale
            ? n.includes("female") || n.includes("femin") || !n.includes("male")
            : n.includes("male")  || n.includes("masc");
        });
        utterance.voice = filtered[0] || ptVoices[0];
      }

      // iOS Safari: SpeechSynthesis output goes to speaker directly (not capturable).
      // Show a clear warning so the user knows the audio may be silent on iOS.
      if (isIOS()) {
        toast.warning("No iPhone/iPad, o áudio narrado é reproduzido direto no alto-falante e pode não ser capturado. Use o microfone para gravar a narração.", { duration: 7000 });
      }

      // Record via MediaRecorder + AudioContext destination
      const audioContext  = new AudioContext();
      const destination   = audioContext.createMediaStreamDestination();
      const mimeType      = getSupportedAudioMimeType(); // Safari: audio/mp4, Chrome: audio/webm
      const mediaRecorder = new MediaRecorder(destination.stream, { mimeType });
      const chunks: Blob[]= [];

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const recordingPromise = new Promise<Blob>((resolve) => {
        mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      mediaRecorder.start();
      speechSynthesis.speak(utterance);

      utterance.onend = () => {
        setTimeout(() => { mediaRecorder.stop(); audioContext.close(); }, 300);
      };
      utterance.onerror = () => {
        mediaRecorder.stop();
        audioContext.close();
        toast.error("Erro ao gerar áudio. Tente novamente.");
        setIsGenerating(false);
      };

      const blob = await recordingPromise;
      const url  = URL.createObjectURL(blob);
      setAudioUrl(url);
      toast.success("Áudio gerado!");
    } catch {
      toast.error("Erro ao gerar o áudio.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlayPause = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      onPreviewStart?.();
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href     = audioUrl;
    a.download = `locutor-${Date.now()}.webm`;
    a.click();
  };

  const handleInsert = () => {
    if (!audioUrl || !onInsert) return;
    onInsert(`direct:${audioUrl}`, insertMode, `Locutor: ${text.slice(0, 40)}${text.length > 40 ? "…" : ""}`);
    toast.success("Narração inserida no player!");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-card rounded-xl p-4 sm:p-6">
        <div className="bg-card pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6 pt-1 rounded-t-xl">
          <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            Locutor Virtual
          </h3>
          <p className="text-sm text-muted-foreground">
            Digite o texto e escolha a voz para gerar a narração automaticamente.
          </p>
        </div>

        <div className="space-y-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex: Atenção clientes, aproveite a promoção de hoje com 30% de desconto em toda a loja..."
            className="bg-secondary/50 min-h-[120px]"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Voz</label>
              <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_OPTIONS.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Velocidade: {speed[0].toFixed(1)}x
              </label>
              <Slider
                value={speed}
                onValueChange={setSpeed}
                min={0.5} max={2.0} step={0.1}
                className="mt-3"
              />
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !text.trim()}
            className="w-full font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isGenerating
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando áudio…</>
              : <><Radio className="h-4 w-4 mr-2" /> Gerar Narração</>
            }
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {audioUrl && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="bg-card rounded-xl p-4 sm:p-6 space-y-4"
          >
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-primary" />
              Áudio Gerado
            </h4>

            <audio ref={audioRef} src={audioUrl} onEnded={() => setIsPlaying(false)} />

            {/* Playback + download */}
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" onClick={handlePlayPause}
                className="border-primary text-primary active:scale-95 transition-transform">
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownload}
                className="border-primary text-primary active:scale-95 transition-transform">
                <Download className="h-4 w-4 mr-1" /> Baixar
              </Button>
              <span className="text-xs text-muted-foreground">WebM</span>
            </div>

            {/* Insert mode — only shown when onInsert is provided */}
            {onInsert && (
              <>
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

                <Button
                  onClick={handleInsert}
                  className="w-full bg-primary text-primary-foreground font-semibold"
                >
                  <Check className="h-4 w-4 mr-2" /> Inserir no Player
                </Button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LocutorVirtualPanel;
