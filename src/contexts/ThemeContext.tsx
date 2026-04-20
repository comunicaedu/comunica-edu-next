"use client";

import { createContext, useCallback, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  sidebarBackground: string;
}

export const defaultTheme: ThemeColors = {
  background: "#272d38",
  foreground: "#dbdbdb",
  card: "#5c5c5c",
  cardForeground: "#2d3340",
  primary: "#f59e0b",
  primaryForeground: "#ffffff",
  secondary: "#ebedf0",
  secondaryForeground: "#2d3340",
  muted: "#3a4150",
  mutedForeground: "#ffffff",
  accent: "#f59e0b",
  accentForeground: "#ffffff",
  border: "#d4d7dc",
  sidebarBackground: "#1f242e",
};

function hexToHSL(hex: string): string {
  hex = hex.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function applyTheme(colors: ThemeColors) {
  const root = document.documentElement;
  root.style.setProperty("--background", hexToHSL(colors.background));
  root.style.setProperty("--foreground", hexToHSL(colors.foreground));
  root.style.setProperty("--card", hexToHSL(colors.card));
  root.style.setProperty("--card-foreground", hexToHSL(colors.cardForeground));
  root.style.setProperty("--primary", hexToHSL(colors.primary));
  root.style.setProperty("--primary-foreground", hexToHSL(colors.primaryForeground));
  root.style.setProperty("--secondary", hexToHSL(colors.secondary));
  root.style.setProperty("--secondary-foreground", hexToHSL(colors.secondaryForeground));
  root.style.setProperty("--muted", hexToHSL(colors.muted));
  root.style.setProperty("--muted-foreground", hexToHSL(colors.mutedForeground));
  root.style.setProperty("--accent", hexToHSL(colors.accent));
  root.style.setProperty("--accent-foreground", hexToHSL(colors.accentForeground));
  root.style.setProperty("--border", hexToHSL(colors.border));
  root.style.setProperty("--input", hexToHSL(colors.border));
  root.style.setProperty("--ring", hexToHSL(colors.primary));
  root.style.setProperty("--sidebar-background", hexToHSL(colors.sidebarBackground));
  root.style.setProperty("--sidebar-foreground", hexToHSL(colors.foreground));
  root.style.setProperty("--sidebar-primary", hexToHSL(colors.primary));
  root.style.setProperty("--popover", hexToHSL(colors.card));
  root.style.setProperty("--popover-foreground", hexToHSL(colors.cardForeground));
}

function getInitialTheme(): ThemeColors {
  if (typeof window === "undefined") return defaultTheme;
  try {
    const stored = localStorage.getItem("comunica-edu-theme");
    if (!stored) return defaultTheme;
    return { ...defaultTheme, ...JSON.parse(stored) };
  } catch {
    return defaultTheme;
  }
}

interface ThemeContextType {
  colors: ThemeColors;
  setColors: (colors: ThemeColors) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [colors, setColorsState] = useState<ThemeColors>(getInitialTheme);

  const syncToCloud = useCallback(async (c: ThemeColors) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("profiles").update({ theme_colors: JSON.stringify(c) }).eq("user_id", user.id);
    } catch {}
  }, []);

  const setColors = useCallback((next: ThemeColors) => {
    setColorsState(next);
    localStorage.setItem("comunica-edu-theme", JSON.stringify(next));
    void syncToCloud(next);
  }, [syncToCloud]);

  const resetTheme = useCallback(() => setColors(defaultTheme), [setColors]);

  // Aplica tema ao DOM
  useEffect(() => { applyTheme(colors); }, [colors]);

  // Sincroniza com servidor ao carregar
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("profiles").select("theme_colors").eq("user_id", user.id).single();
      if (data?.theme_colors) {
        try {
          const remote = { ...defaultTheme, ...JSON.parse(data.theme_colors) } as ThemeColors;
          setColorsState(remote);
          applyTheme(remote);
          localStorage.setItem("comunica-edu-theme", JSON.stringify(remote));
        } catch {}
      }
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ colors, setColors, resetTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
