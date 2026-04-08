"use client";

import { useRef } from "react";
import { ZoomIn, ZoomOut, Move, RotateCcw, Palette, Image, Upload, Trash2 } from "lucide-react";
import PlanManagement from "@/components/PlanManagement";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useBackground } from "@/contexts/BackgroundContext";
import { useTheme, ThemeColors } from "@/contexts/ThemeContext";
const studioBg = "/studio-bg.jpg";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const themeColorFields: { key: keyof ThemeColors; label: string }[] = [
  { key: "primary", label: "Cor Principal" },
  { key: "primaryForeground", label: "Texto Principal" },
  { key: "background", label: "Fundo Geral" },
  { key: "foreground", label: "Texto Geral" },
  { key: "card", label: "Cards" },
  { key: "cardForeground", label: "Texto dos Cards" },
  { key: "secondary", label: "Secundária" },
  { key: "muted", label: "Elementos Suaves" },
  { key: "mutedForeground", label: "Texto Suave" },
  { key: "accent", label: "Destaque" },
  { key: "border", label: "Bordas" },
  { key: "sidebarBackground", label: "Fundo da Sidebar" },
];

const presetVignetteColors = [
  { color: "#0d1b3e", label: "Azul Escuro" },
  { color: "#000000", label: "Preto" },
  { color: "#1a0a2e", label: "Roxo" },
  { color: "#0a1f0a", label: "Verde" },
  { color: "#2e1a0a", label: "Marrom" },
  { color: "#f59e0b", label: "Amarelo" },
  { color: "#dc2626", label: "Vermelho" },
  { color: "#1e3a5f", label: "Azul" },
];

const SettingsPanel = () => {
  const { settings, setSettings, resetSettings } = useBackground();
  const { colors, setColors, resetTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateBg = (partial: Partial<typeof settings>) =>
    setSettings({ ...settings, ...partial });

  const handleThemeChange = (key: keyof ThemeColors, value: string) => {
    setColors({ ...colors, [key]: value });
  };

  const bgImage = settings.customImage || studioBg;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      updateBg({ customImage: ev.target?.result as string });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* ===== SEÇÃO 1: Imagem de Fundo ===== */}
      <div className="bg-card rounded-xl p-6">
        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
          <Image className="h-5 w-5 text-primary" />
          Imagem de Fundo (Login / Cadastro)
        </h3>

        {/* Upload */}
        <div className="flex items-center gap-3 mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <Button size="sm" onClick={() => fileInputRef.current?.click()} className="text-xs bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary transition-all">
            <Upload className="h-3 w-3 mr-1" /> Enviar Imagem
          </Button>
          {settings.customImage && (
            <Button variant="outline" size="sm" onClick={() => updateBg({ customImage: null })} className="text-xs text-destructive">
              <Trash2 className="h-3 w-3 mr-1" /> Usar Imagem Original
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {settings.customImage ? "Imagem personalizada" : "Imagem padrão"}
          </span>
        </div>

        {/* Preview */}
        <div
          className="w-full h-48 rounded-lg border border-border overflow-hidden mb-6 relative"
          style={{
            backgroundImage: `url(${bgImage})`,
            backgroundSize: `${settings.zoom}%`,
            backgroundPosition: `${settings.posX}% ${settings.posY}%`,
            backgroundRepeat: "no-repeat",
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at center, transparent 20%, ${hexToRgba(settings.vignetteColor, settings.vignetteOpacity / 100)} 70%, ${hexToRgba(settings.vignetteColor, Math.min(1, settings.vignetteOpacity / 100 + 0.3))} 100%)`,
            }}
          />
          <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${settings.overlayOpacity / 100})` }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-white/70 bg-black/40 px-3 py-1 rounded-full">Pré-visualização</span>
          </div>
        </div>

        {/* Zoom */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground flex items-center gap-2 mb-2">
              <ZoomIn className="h-4 w-4 text-primary" /> Zoom: {settings.zoom}%
            </label>
            <div className="flex items-center gap-3">
              <button onClick={() => updateBg({ zoom: Math.max(100, settings.zoom - 10) })} className="p-1.5 rounded hover:bg-secondary">
                <ZoomOut className="h-4 w-4" />
              </button>
              <Slider value={[settings.zoom]} onValueChange={([v]) => updateBg({ zoom: v })} min={100} max={400} step={5} className="flex-1" />
              <button onClick={() => updateBg({ zoom: Math.min(400, settings.zoom + 10) })} className="p-1.5 rounded hover:bg-secondary">
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              <Move className="h-4 w-4 inline mr-1 text-primary" /> Posição Horizontal: {settings.posX}%
            </label>
            <Slider value={[settings.posX]} onValueChange={([v]) => updateBg({ posX: v })} min={0} max={100} step={1} />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              <Move className="h-4 w-4 inline mr-1 text-primary" /> Posição Vertical: {settings.posY}%
            </label>
            <Slider value={[settings.posY]} onValueChange={([v]) => updateBg({ posY: v })} min={0} max={100} step={1} />
          </div>
        </div>

        {/* Vinheta */}
        <div className="mt-6 pt-4">
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" /> Filtro de Cor (Vinheta nas Bordas)
          </h4>

          <div className="flex flex-wrap gap-2 mb-4">
            {presetVignetteColors.map((p) => (
              <button
                key={p.color}
                onClick={() => updateBg({ vignetteColor: p.color })}
                className={`w-8 h-8 rounded-lg border-2 transition-all hover:scale-110 ${
                  settings.vignetteColor === p.color ? "border-primary ring-2 ring-primary/30" : "border-border"
                }`}
                style={{ backgroundColor: p.color }}
                title={p.label}
              />
            ))}
            <div className="relative">
              <input
                type="color"
                value={settings.vignetteColor}
                onChange={(e) => updateBg({ vignetteColor: e.target.value })}
                className="w-8 h-8 rounded-lg border-2 border-border cursor-pointer bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded"
                title="Cor personalizada"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Intensidade da Vinheta: {settings.vignetteOpacity}%</label>
              <Slider value={[settings.vignetteOpacity]} onValueChange={([v]) => updateBg({ vignetteOpacity: v })} min={0} max={100} step={5} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Escurecimento geral: {settings.overlayOpacity}%</label>
              <Slider value={[settings.overlayOpacity]} onValueChange={([v]) => updateBg({ overlayOpacity: v })} min={0} max={80} step={5} />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <Button size="sm" onClick={resetSettings} className="text-xs bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary transition-all">
            <RotateCcw className="h-3 w-3 mr-1" /> Restaurar Padrão do Fundo
          </Button>
        </div>
      </div>

      {/* ===== SEÇÃO 2: Tema de Cores do Site ===== */}
      <div className="bg-card rounded-xl p-6">
        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          Tema de Cores do Site
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Personalize todas as cores da interface do sistema.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {themeColorFields.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-secondary/30">
              <label className="text-xs text-muted-foreground flex-1">{label}</label>
              <input
                type="color"
                value={colors[key]}
                onChange={(e) => handleThemeChange(key, e.target.value)}
                className="w-8 h-8 rounded-md border border-border cursor-pointer bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded"
              />
            </div>
          ))}
        </div>

        <div className="mt-4">
          <Button size="sm" onClick={resetTheme} className="text-xs bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary transition-all">
            <RotateCcw className="h-3 w-3 mr-1" /> Restaurar Tema Padrão
          </Button>
        </div>
      </div>

      {/* ===== SEÇÃO 3: Gestão de Planos ===== */}
      <PlanManagement />
    </div>
  );
};

export default SettingsPanel;