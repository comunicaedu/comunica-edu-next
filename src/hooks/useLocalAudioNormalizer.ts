"use client";

import { RefObject, useCallback, useRef } from "react";

interface LocalAudioNormalizerOptions {
  targetLufs?: number;
  minGain?: number;
  maxGain?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Controla o volume do elemento de áudio diretamente via audio.volume.
 *
 * Anteriormente usava createMediaElementSource → AudioContext chain.
 * Esse approach capturava o output do <audio> para o Web Audio —
 * se o AudioContext suspendia (tab em background), o áudio ficava
 * silencioso ou parava de avançar, independentemente do número de
 * resume() chamados. A reprodução em background nunca era confiável.
 *
 * Agora: áudio toca 100% nativo. Volume e controle de ganho via
 * audio.volume. Sem AudioContext, sem risco de suspensão.
 */
export const useLocalAudioNormalizer = (
  audioRef: RefObject<HTMLAudioElement | null>,
  enabled: boolean,
  options: LocalAudioNormalizerOptions = {}
) => {
  const minGain = options.minGain ?? 0.45;
  const maxGain = options.maxGain ?? 1.35;

  const userVolumeRef = useRef(1);

  /** Sincroniza o volume atual com o valor persistido pelo usuário */
  const forceSync = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = clamp(userVolumeRef.current, minGain, maxGain);
    if (Math.abs(audio.volume - target) > 0.001) {
      audio.volume = target;
    }
  }, [audioRef, minGain, maxGain]);

  /** Define o volume do usuário (0–1) diretamente no elemento de áudio */
  const setVolume = useCallback((vol: number) => {
    const next = clamp(vol, 0, 1);
    userVolumeRef.current = next;
    const audio = audioRef.current;
    if (audio) audio.volume = next;
  }, [audioRef]);

  return { forceSync, setVolume };
};
