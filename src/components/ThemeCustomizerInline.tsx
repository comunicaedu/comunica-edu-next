"use client";

import { Palette, RotateCcw } from "lucide-react";
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

const ThemeCustomizerInline = () => {
  const { colors, setColors, resetTheme } = useTheme();

  const handleChange = (key: keyof ThemeColors, value: string) => {
    setColors({ ...colors, [key]: value });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-card rounded-xl p-6">
        <h3 className="text-base font-semibold mb-2 flex items-center gap-2 text-card-foreground">
          <Palette className="h-5 w-5 text-primary" />
          Personalizar Cores do Tema
        </h3>
        <p className="text-sm text-muted-foreground mb-6">
          Altere as cores da plataforma em tempo real. Suas preferências serão salvas automaticamente.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {colorFields.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-secondary/30">
              <label className="text-sm text-card-foreground font-medium">{label}</label>
              <input
                type="color"
                value={colors[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-1 [&::-webkit-color-swatch]:rounded-md"
              />
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Button variant="outline" onClick={resetTheme} className="text-sm">
            <RotateCcw className="h-4 w-4 mr-2" /> Restaurar Tema Padrão
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ThemeCustomizerInline;