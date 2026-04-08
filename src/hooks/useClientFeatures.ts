"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

export interface ClientFeature {
  feature_key: string;
  enabled: boolean;
}

/**
 * Master list of all controllable features.
 * Add new features here to make them available system-wide.
 */
export const ALL_CLIENT_FEATURES = [
  { key: "locutor_virtual", label: "Locutor Virtual (IA)" },
  { key: "ia_comercial", label: "Sugestor de Textos Comerciais" },
  { key: "biblioteca_trilhas", label: "Biblioteca de Trilhas" },
  { key: "upload_vinhetas", label: "Upload de Vinhetas Próprias" },
  { key: "download_audios", label: "Download de Áudios/Vinhetas" },
  { key: "programacao_playlists", label: "Programação de Playlists e Vinhetas" },
  { key: "modo_offline", label: "Modo Offline da Plataforma" },
  { key: "link_usuario_cliente", label: "Gerador de Link para Usuário do Cliente" },
  { key: "mixagem_volume", label: "Mixagem de Volume Independente (Músicas × Spots)" },
] as const;

export type FeatureKey = (typeof ALL_CLIENT_FEATURES)[number]["key"];

/**
 * Maps sidebar section ids to feature keys.
 * Sections not listed here are always visible.
 */
const SECTION_TO_FEATURE: Record<string, FeatureKey> = {
  locutor: "locutor_virtual",
  ia: "ia_comercial",
  musicas: "biblioteca_trilhas",
  spots: "upload_vinhetas",
  programacao: "programacao_playlists",
};

/**
 * Hook for clients: fetches their enabled features and provides
 * a helper to check if a sidebar section should be visible.
 */
export const useClientFeatures = () => {
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFeatures = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data } = await supabase
        .from("client_features")
        .select("feature_key, enabled")
        .eq("user_id", user.id);

      const map: Record<string, boolean> = {};
      if (data) {
        data.forEach((f: ClientFeature) => { map[f.feature_key] = f.enabled; });
      }
      setFeatures(map);
      setLoading(false);
    };
    fetchFeatures();
  }, []);

  /**
   * Returns true if the given sidebar section should be visible.
   * Sections not controlled by features are always visible.
   * Features default to enabled (true) if no record exists.
   */
  const isSectionVisible = (sectionId: string): boolean => {
    const featureKey = SECTION_TO_FEATURE[sectionId];
    if (!featureKey) return true;
    return features[featureKey] !== false;
  };

  return { features, loading, isSectionVisible };
};
