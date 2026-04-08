"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export interface BackgroundSettings {
  zoom: number;
  posX: number;
  posY: number;
  vignetteColor: string;
  vignetteOpacity: number;
  overlayOpacity: number;
  customImage: string | null;
}

interface BackgroundContextType {
  settings: BackgroundSettings;
  setSettings: (s: BackgroundSettings) => void;
  resetSettings: () => void;
}

const defaultSettings: BackgroundSettings = {
  zoom: 200,
  posX: 50,
  posY: 50,
  vignetteColor: "#0d1b3e",
  vignetteOpacity: 70,
  overlayOpacity: 30,
  customImage: null,
};

const BackgroundContext = createContext<BackgroundContextType | undefined>(undefined);

export const BackgroundProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettingsState] = useState<BackgroundSettings>(() => {
    if (typeof window === "undefined") return defaultSettings;
    try {
      const saved = localStorage.getItem("comunica-edu-bg");
      return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  const setSettings = (s: BackgroundSettings) => {
    setSettingsState(s);
    localStorage.setItem("comunica-edu-bg", JSON.stringify(s));
  };

  const resetSettings = () => setSettings(defaultSettings);

  return (
    <BackgroundContext.Provider value={{ settings, setSettings, resetSettings }}>
      {children}
    </BackgroundContext.Provider>
  );
};

export const useBackground = () => {
  const ctx = useContext(BackgroundContext);
  if (!ctx) throw new Error("useBackground must be used within BackgroundProvider");
  return ctx;
};

export { defaultSettings };
