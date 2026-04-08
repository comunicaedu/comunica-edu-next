"use client";

/**
 * Smart Start/End (Corte Inteligente) v4
 *
 * - Non-blocking: reproduz imediatamente e analisa em background
 * - Focado em áudio extraído de vídeo (falas, ministração, silêncio e vinhetas)
 */

import { analyzeSmartPointsFromBuffer, type SmartPoints } from "@/lib/smartAudioAnalysis";

const ANALYSIS_CACHE = new Map<string, SmartPoints>();
const PENDING = new Map<string, Promise<SmartPoints>>();

export const FADE_DURATION = 4.5; // 4.5s smooth cubic fade

async function doAnalysis(audioUrl: string): Promise<SmartPoints> {
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) return { startTime: 0, endTime: 0 };

    const arrayBuffer = await response.arrayBuffer();
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      return analyzeSmartPointsFromBuffer(audioBuffer);
    } finally {
      ctx.close().catch(() => {});
    }
  } catch (err) {
    console.warn("[SmartStartEnd] Analysis failed:", err);
    return { startTime: 0, endTime: 0 };
  }
}

/**
 * Get cached smart points instantly, or null if not yet analyzed.
 */
export function getCachedSmartPoints(audioUrl: string): SmartPoints | null {
  return ANALYSIS_CACHE.get(audioUrl) ?? null;
}

/**
 * Analyze audio and return smart points. De-duplicates concurrent requests.
 */
export async function analyzeAudioSmartPoints(audioUrl: string): Promise<SmartPoints> {
  const cached = ANALYSIS_CACHE.get(audioUrl);
  if (cached) return cached;

  const pending = PENDING.get(audioUrl);
  if (pending) return pending;

  const promise = doAnalysis(audioUrl)
    .then((points) => {
      ANALYSIS_CACHE.set(audioUrl, points);
      return points;
    })
    .finally(() => {
      PENDING.delete(audioUrl);
    });

  PENDING.set(audioUrl, promise);
  return promise;
}

/**
 * Pre-analyze a URL in background (fire-and-forget).
 */
export function preAnalyze(audioUrl: string): void {
  if (!audioUrl || ANALYSIS_CACHE.has(audioUrl) || PENDING.has(audioUrl)) return;
  analyzeAudioSmartPoints(audioUrl).catch(() => {});
}

export function clearSmartCache() {
  ANALYSIS_CACHE.clear();
  PENDING.clear();
}

declare global {
  interface HTMLAudioElement {
    _smartTargetVolume?: number;
    _smartEndTime?: number;
  }
}
