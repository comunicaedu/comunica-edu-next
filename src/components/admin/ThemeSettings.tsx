"use client";

import { RotateCcw, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, ThemeColors } from "@/contexts/ThemeContext";

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
  { key: "sidebarBackground", label: "Fundo da Sidebar" },
];

const ThemeSettings = () => {
  const { colors, setColors, resetTheme } = useTheme();

  const handleThemeChange = (key: keyof ThemeColors, value: string) => {
    setColors({ ...colors, [key]: value });
  };

  return (
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
  );
};

export default ThemeSettings;