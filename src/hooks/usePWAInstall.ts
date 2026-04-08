"use client";

import { useEffect, useRef, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export const usePWAInstall = () => {
  const listenerAdded = useRef(false);

  useEffect(() => {
    if (listenerAdded.current) return;
    listenerAdded.current = true;

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const triggerInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) {
      // Already installed or not supported
      return false;
    }
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      return outcome === "accepted";
    } catch {
      return false;
    }
  }, []);

  const isInstallable = useCallback(() => !!deferredPrompt, []);

  return { triggerInstall, isInstallable };
};
