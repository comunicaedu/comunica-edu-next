"use client";

import { useState } from "react";
import { Palette, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, ThemeColors } from "@/contexts/ThemeContext";

const colorFields: { key: keyof ThemeColors; label: string }[] = [
  { key: "primary", label: "Cor Principal" },
  { key: "primaryForeground", label: "Texto Principal" },
  { key: "background", label: "Fundo" },
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

const ThemeCustomizer = () => {
  const { colors, setColors, resetTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const handleChange = (key: keyof ThemeColors, value: string) => {
    setColors({ ...colors, [key]: value });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-50 w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
        title="Personalizar Tema"
      >
        <Palette className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-24 right-4 z-50 w-72 max-h-[70vh] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between p-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" /> Personalizar Tema
        </h3>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {colorFields.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <label className="text-xs text-muted-foreground flex-1">{label}</label>
            <div className="relative">
              <input
                type="color"
                value={colors[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-8 h-8 rounded-md border border-border cursor-pointer bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="p-3">
        <Button variant="outline" size="sm" onClick={resetTheme} className="w-full text-xs">
          <RotateCcw className="h-3 w-3 mr-1" /> Restaurar Padrão
        </Button>
      </div>
    </div>
  );
};

export default ThemeCustomizer;