"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

export interface ClientFeature {
  feature_key: string;
  enabled: boolean;
  limit_value?: number | null;
}

export const ALL_CLIENT_FEATURES = [
  { key: "criar_playlists",     label: "Criar Playlists" },
  { key: "excluir_playlists",   label: "Excluir Playlists" },
  { key: "locutor_virtual",     label: "Locutor Virtual" },
  { key: "importar_playlists",  label: "Importar Playlists" },
  { key: "spots_profissionais", label: "Spots Profissionais" },
  { key: "enviar_spots",        label: "Enviar Spots" },
  { key: "enviar_musicas",      label: "Enviar Músicas" },
  { key: "locutor_ao_vivo",     label: "Locutor ao Vivo" },
  { key: "programar_playlists", label: "Programar Playlists" },
  { key: "programar_spots",     label: "Programar Spots" },
  { key: "modo_offline",        label: "Modo Offline" },
  { key: "programar_play",      label: "Programar o Play" },
  { key: "acesso_remoto",       label: "Acesso Remoto" },
  { key: "favoritar_playlists", label: "Favoritar Playlists" },
  { key: "curtir_musicas",      label: "Curtir Músicas" },
  { key: "excluir_musicas",     label: "Excluir Músicas" },
  { key: "programar_musica",    label: "Programar Música" },
  { key: "editar_playlist",     label: "Editar Playlist" },
  { key: "alterar_capa",        label: "Alterar Capa" },
  { key: "player_espelho",      label: "Players Espelho" },
  { key: "player_independente", label: "Players Independentes" },
] as const;

export type FeatureKey = (typeof ALL_CLIENT_FEATURES)[number]["key"];

const SECTION_TO_FEATURE: Partial<Record<string, FeatureKey>> = {
  locutor:     "locutor_virtual",
  ia:          "locutor_virtual",
  spots:       "spots_profissionais",
  programacao: "programar_playlists",
};

export const useClientFeatures = () => {
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let focusHandler: (() => void) | null = null;

    const loadFeatures = async () => {
      const uid = userIdRef.current;
      if (cancelled || !uid) return;
      try {
        const { data } = await supabase
          .from("client_features")
          .select("feature_key, enabled")
          .eq("user_id", uid);

        if (cancelled) return;
        const map: Record<string, boolean> = {};
        if (data) {
          data.forEach((f: ClientFeature) => { map[f.feature_key] = f.enabled; });
        }
        setFeatures(map);
      } catch { /* silencioso */ }
      setLoading(false);
    };

    const init = async () => {
      // Tenta getSession primeiro (mais rápido), depois getUser como fallback
      let userId: string | null = null;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        userId = session.user.id;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) userId = user.id;
      }

      if (cancelled || !userId) { setLoading(false); return; }
      userIdRef.current = userId;

      // Check if admin
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!cancelled) setIsAdmin(!!roleRow);

      // Primeira carga
      await loadFeatures();

      // Polling a cada 3 segundos
      if (!cancelled) {
        pollId = setInterval(loadFeatures, 3_000);
      }

      // Recarrega ao voltar para a aba
      focusHandler = () => loadFeatures();
      window.addEventListener("focus", focusHandler);
    };

    init();

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      if (focusHandler) window.removeEventListener("focus", focusHandler);
    };
  }, []);

  const isFeatureLocked = useCallback((featureKey: string): boolean => {
    if (isAdmin) return false;
    if (features[featureKey] === undefined) return true;
    if (features[featureKey] === false) return true;
    return false;
  }, [features, isAdmin]);

  const consumeFeature = useCallback(async (featureKey: string): Promise<boolean> => {
    if (isAdmin) return true;
    return !isFeatureLocked(featureKey);
  }, [isAdmin, isFeatureLocked]);

  const isSectionVisible = (sectionId: string): boolean => {
    if (isAdmin) return true;
    const featureKey = SECTION_TO_FEATURE[sectionId];
    if (!featureKey) return true;
    return features[featureKey] === true;
  };

  const isSectionLocked = (sectionId: string): boolean => {
    if (isAdmin) return false;
    const featureKey = SECTION_TO_FEATURE[sectionId];
    if (!featureKey) return false;
    return features[featureKey] !== true;
  };

  return { features, loading, isSectionVisible, isSectionLocked, isFeatureLocked, consumeFeature };
};
