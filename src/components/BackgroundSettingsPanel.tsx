"use client";

import { ZoomIn, ZoomOut, Move, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useBackground } from "@/contexts/BackgroundContext";
const studioBg = "/studio-bg.jpg";

const BackgroundSettingsPanel = () => {
  const { settings, setSettings, resetSettings } = useBackground();

  const updateZoom = (val: number) =>
    setSettings({ ...settings, zoom: Math.max(100, Math.min(400, val)) });

  const updatePosX = (val: number) =>
    setSettings({ ...settings, posX: val });

  const updatePosY = (val: number) =>
    setSettings({ ...settings, posY: val });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-card rounded-xl p-6">
        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
          <Move className="h-5 w-5 text-primary" />
          Imagem de Fundo da Tela de Login
        </h3>
        <p className="text-sm text-muted-foreground mb-6">
          Ajuste o zoom e a posição da imagem de fundo das telas de login e cadastro.
        </p>

        {/* Preview */}
        <div
          className="w-full h-48 rounded-lg border border-border overflow-hidden mb-6 relative"
          style={{
            backgroundImage: `url(${studioBg})`,
            backgroundSize: `${settings.zoom}%`,
            backgroundPosition: `${settings.posX}% ${settings.posY}%`,
            backgroundRepeat: "no-repeat",
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at center, transparent 30%, rgba(13, 27, 62, 0.55) 70%, rgba(5, 10, 30, 0.85) 100%)`,
            }}
          />
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-white/70 bg-black/40 px-3 py-1 rounded-full">
              Pré-visualização
            </span>
          </div>
        </div>

        {/* Zoom */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground flex items-center gap-2 mb-2">
              <ZoomIn className="h-4 w-4 text-primary" />
              Zoom: {settings.zoom}%
            </label>
            <div className="flex items-center gap-3">
              <button onClick={() => updateZoom(settings.zoom - 10)} className="p-1.5 rounded hover:bg-secondary">
                <ZoomOut className="h-4 w-4" />
              </button>
              <Slider
                value={[settings.zoom]}
                onValueChange={([v]) => updateZoom(v)}
                min={100}
                max={400}
                step={5}
                className="flex-1"
              />
              <button onClick={() => updateZoom(settings.zoom + 10)} className="p-1.5 rounded hover:bg-secondary">
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Position X */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Posição Horizontal: {settings.posX}%
            </label>
            <Slider
              value={[settings.posX]}
              onValueChange={([v]) => updatePosX(v)}
              min={0}
              max={100}
              step={1}
            />
          </div>

          {/* Position Y */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Posição Vertical: {settings.posY}%
            </label>
            <Slider
              value={[settings.posY]}
              onValueChange={([v]) => updatePosY(v)}
              min={0}
              max={100}
              step={1}
            />
          </div>
        </div>

        <div className="mt-6">
          <Button variant="outline" size="sm" onClick={resetSettings} className="text-xs">
            <RotateCcw className="h-3 w-3 mr-1" /> Restaurar Padrão
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BackgroundSettingsPanel;