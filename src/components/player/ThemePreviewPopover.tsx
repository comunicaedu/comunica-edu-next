"use client";

import { useState } from "react";
import { Palette, Check, RotateCcw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useTheme, ThemeColors, defaultTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";

const colorLabels: { key: keyof ThemeColors; label: string }[] = [
  { key: "primary", label: "Principal" },
  { key: "primaryForeground", label: "Texto Principal" },
  { key: "background", label: "Fundo" },
  { key: "foreground", label: "Texto Geral" },
  { key: "card", label: "Cards" },
  { key: "cardForeground", label: "Texto Cards" },
  { key: "secondary", label: "Secundária" },
  { key: "muted", label: "Suave" },
  { key: "accent", label: "Destaque" },
  { key: "border", label: "Bordas" },
  { key: "sidebarBackground", label: "Sidebar" },
];

interface ThemePreviewPopoverProps {
  children: React.ReactNode;
}

const ThemePreviewPopover = ({ children }: ThemePreviewPopoverProps) => {
  const { colors, setColors, resetTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const handleMakeOfficial = () => {
    // Save current colors as the "official" theme in localStorage
    localStorage.setItem("comunica-edu-theme-official", JSON.stringify(colors));
    toast.success("Cores oficializadas com sucesso! Este será o novo padrão do site.");
    setOpen(false);
  };

  const handleRestoreOfficial = () => {
    const saved = localStorage.getItem("comunica-edu-theme-official");
    if (saved) {
      try {
        const official = JSON.parse(saved) as ThemeColors;
        setColors({ ...defaultTheme, ...official });
        toast.success("Cores oficiais restauradas!");
      } catch {
        resetTheme();
      }
    } else {
      resetTheme();
      toast.info("Nenhuma cor oficial salva. Tema padrão restaurado.");
    }
    setOpen(false);
  };

  const handleChangeColor = (key: keyof ThemeColors, value: string) => {
    setColors({ ...colors, [key]: value });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-4 bg-card border-border"
      >
        <div className="flex items-center gap-2 mb-3">
          <Palette className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-card-foreground">Cores do Site</h4>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Edite e oficialize as cores da plataforma.
        </p>

        <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1 scrollbar-none">
          {colorLabels.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-secondary/30">
              <input
                type="color"
                value={colors[key]}
                onChange={(e) => handleChangeColor(key, e.target.value)}
                className="w-6 h-6 rounded border border-border cursor-pointer bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-sm shrink-0"
              />
              <span className="text-xs text-card-foreground truncate">{label}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-4 pt-3">
          <Button
            size="sm"
            onClick={handleMakeOfficial}
            className="flex-1 text-xs bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] transition-all"
          >
            <Check className="h-3 w-3 mr-1" /> Tornar Oficial
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRestoreOfficial}
            className="text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Restaurar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ThemePreviewPopover;