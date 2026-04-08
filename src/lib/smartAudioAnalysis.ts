export interface SmartPoints {
  startTime: number;
  endTime: number;
}

interface ChunkMetric {
  rms: number;
  zcr: number;
  flux: number;
  musicConfidence: number;
  isMusic: boolean;
}

interface AnalysisProfile {
  metrics: ChunkMetric[];
  baseEnergy: number;
  highEnergy: number;
  chunkDuration: number;
  voiceZcrFloor: number;
}

// --- Config ---
const CHUNK_DURATION = 0.03; // 30ms chunks for higher resolution
const MAX_INTRO_SCAN_S = 120;
const INTRO_WINDOW_S = 2.8;
const INTRO_MIN_RUN_S = 1.0;
const INTRO_MIN_MUSIC_RATIO = 0.55;
const INTRO_PREROLL_S = 0.25;

const OUTRO_SCAN_FROM_RATIO = 0.35;
const OUTRO_MIN_SEGMENT_S = 3.5;
const OUTRO_MAX_GAP_S = 1.0;
const OUTRO_MIN_TAIL_S = 4.0;
const OUTRO_MAX_TAIL_MUSIC_RATIO = 0.38;
const OUTRO_MIN_AUDIBLE_NON_MUSIC_RATIO = 0.25;
const OUTRO_MIN_VOICE_RATIO = 0.18;
const OUTRO_MIN_SILENCE_RATIO = 0.55;
const OUTRO_PAD_S = 0.5; // more padding for smoother transition

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[idx];
}

function movingAverage(values: number[], radius: number): number[] {
  if (values.length === 0) return [];
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    let sum = 0;
    for (let j = start; j <= end; j++) sum += values[j];
    out[i] = sum / (end - start + 1);
  }
  return out;
}

/**
 * Compute spectral centroid approximation via energy-weighted ZCR bands.
 * Higher values = brighter/richer harmonics = more likely music.
 */
function spectralBrightness(samples: Float32Array, offset: number, end: number): number {
  let highEnergy = 0;
  let totalEnergy = 0;
  let prevSample = samples[offset] || 0;

  for (let j = offset + 1; j < end; j++) {
    const s = samples[j];
    const energy = s * s;
    totalEnergy += energy;
    // "high frequency" proxy: large magnitude changes between consecutive samples
    const diff = Math.abs(s - prevSample);
    highEnergy += diff * diff;
    prevSample = s;
  }

  return totalEnergy > 0.00001 ? highEnergy / totalEnergy : 0;
}

function stabilizeMusicFlags(metrics: ChunkMetric[], baseEnergy: number): void {
  if (metrics.length < 5) return;

  // Pass 1: Remove isolated 1-2 chunk spikes (plosives, coughs)
  for (let i = 1; i < metrics.length - 1; i++) {
    if (metrics[i].isMusic && !metrics[i - 1].isMusic && !metrics[i + 1].isMusic) {
      metrics[i].isMusic = false;
    }
  }
  // 2-chunk spikes
  for (let i = 1; i < metrics.length - 2; i++) {
    if (metrics[i].isMusic && metrics[i + 1].isMusic &&
        !metrics[i - 1].isMusic && !metrics[i + 2]?.isMusic) {
      if (metrics[i].musicConfidence < 0.65 && metrics[i + 1].musicConfidence < 0.65) {
        metrics[i].isMusic = false;
        metrics[i + 1].isMusic = false;
      }
    }
  }

  // Pass 2: Fill small gaps (1-3 chunks) between musical regions
  for (let i = 1; i < metrics.length - 1; i++) {
    if (!metrics[i].isMusic && metrics[i].rms >= baseEnergy * 0.5) {
      // Look for music on both sides within 3 chunks
      let leftMusic = false, rightMusic = false;
      for (let d = 1; d <= 3 && i - d >= 0; d++) {
        if (metrics[i - d].isMusic) { leftMusic = true; break; }
      }
      for (let d = 1; d <= 3 && i + d < metrics.length; d++) {
        if (metrics[i + d].isMusic) { rightMusic = true; break; }
      }
      if (leftMusic && rightMusic) {
        metrics[i].isMusic = true;
      }
    }
  }
}

function buildProfile(buffer: AudioBuffer): AnalysisProfile | null {
  const sampleRate = buffer.sampleRate;
  const chunkSize = Math.max(64, Math.floor(sampleRate * CHUNK_DURATION));
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  // Mix to mono
  let mono: Float32Array;
  if (right) {
    mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) * 0.5;
  } else {
    mono = left;
  }

  const totalChunks = Math.floor(mono.length / chunkSize);
  if (totalChunks <= 0) return null;

  const rmsValues = new Array<number>(totalChunks);
  const zcrValues = new Array<number>(totalChunks);
  const fluxValues = new Array<number>(totalChunks);
  const brightnessValues = new Array<number>(totalChunks);

  let prevRms = 0;

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * chunkSize;
    const end = Math.min(offset + chunkSize, mono.length);

    let sq = 0;
    let zeroCrossings = 0;
    let count = 0;

    for (let j = offset; j < end; j++) {
      sq += mono[j] * mono[j];
      count++;
      if (j > offset && ((mono[j - 1] >= 0 && mono[j] < 0) || (mono[j - 1] < 0 && mono[j] >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = count > 0 ? Math.sqrt(sq / count) : 0;
    const zcr = count > 1 ? zeroCrossings / count : 0;
    const flux = i === 0 ? 0 : Math.abs(rms - prevRms);
    const brightness = spectralBrightness(mono, offset, end);

    rmsValues[i] = rms;
    zcrValues[i] = zcr;
    fluxValues[i] = flux;
    brightnessValues[i] = brightness;
    prevRms = rms;
  }

  const rmsP50 = percentile(rmsValues, 0.5);
  const rmsP60 = percentile(rmsValues, 0.6);
  const rmsP90 = percentile(rmsValues, 0.9);

  const baseEnergy = Math.max(0.004, rmsP50 * 0.55);
  const highEnergy = Math.max(baseEnergy * 1.8, rmsP90 * 0.72);

  const activeZcr = zcrValues.filter((_, idx) => rmsValues[idx] >= baseEnergy * 0.8);
  const zcrP65 = percentile(activeZcr.length > 0 ? activeZcr : zcrValues, 0.65);
  const zcrCeil = clamp(zcrP65 + 0.04, 0.08, 0.26);
  const voiceZcrFloor = clamp(zcrP65 * 0.85, 0.055, 0.17);

  const fluxP70 = Math.max(percentile(fluxValues, 0.7), 0.0006);
  const brightnessP50 = percentile(brightnessValues, 0.5);
  const energyDenom = Math.max(0.000001, highEnergy - baseEnergy);

  const rawConfidence = rmsValues.map((rms, idx) => {
    const zcr = zcrValues[idx];
    const flux = fluxValues[idx];
    const brightness = brightnessValues[idx];

    const energyScore = clamp((rms - baseEnergy) / energyDenom, 0, 1.5);
    const harmonicScore = clamp(1 - zcr / zcrCeil, 0, 1);
    const stabilityScore = clamp(1 - flux / (fluxP70 * 2.0), 0, 1);
    // Music tends to have richer spectral content
    const brightnessScore = brightnessP50 > 0.001
      ? clamp(brightness / (brightnessP50 * 2), 0, 1)
      : 0.5;
    // Speech penalty: high ZCR + high flux = rapidly changing articulation
    const speechPenalty = zcr >= zcrCeil * 0.9 && flux >= fluxP70 * 1.0 ? 0.22 : 0;
    // Silence penalty
    const silencePenalty = rms < baseEnergy * 0.3 ? 0.4 : 0;

    return clamp(
      energyScore * 0.45 + harmonicScore * 0.25 + stabilityScore * 0.15 + brightnessScore * 0.15
      - speechPenalty - silencePenalty,
      0, 1
    );
  });

  // Double smoothing pass for stability
  const smooth1 = movingAverage(rawConfidence, 4);
  const smoothedConfidence = movingAverage(smooth1, 3);

  const metrics: ChunkMetric[] = rmsValues.map((rms, idx) => {
    const musicConfidence = smoothedConfidence[idx];
    const isMusic = (musicConfidence >= 0.52 && rms >= baseEnergy * 0.75) || rms >= highEnergy;
    return {
      rms,
      zcr: zcrValues[idx],
      flux: fluxValues[idx],
      musicConfidence,
      isMusic,
    };
  });

  stabilizeMusicFlags(metrics, baseEnergy);

  return { metrics, baseEnergy, highEnergy, chunkDuration: CHUNK_DURATION, voiceZcrFloor };
}

function hasConsecutiveMusicRun(metrics: ChunkMetric[], start: number, endExclusive: number, minRunChunks: number): boolean {
  let run = 0;
  for (let i = start; i < endExclusive; i++) {
    if (metrics[i].isMusic) {
      run++;
      if (run >= minRunChunks) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function findStartTime(profile: AnalysisProfile): number {
  const { metrics, baseEnergy, chunkDuration } = profile;

  const windowChunks = Math.max(1, Math.round(INTRO_WINDOW_S / chunkDuration));
  const runChunks = Math.max(1, Math.round(INTRO_MIN_RUN_S / chunkDuration));
  const maxScanChunks = Math.min(metrics.length, Math.floor(MAX_INTRO_SCAN_S / chunkDuration));
  const maxStart = Math.max(0, maxScanChunks - windowChunks);

  for (let i = 0; i <= maxStart; i++) {
    let musicCount = 0;
    let confidenceSum = 0;
    let rmsSum = 0;

    for (let j = i; j < i + windowChunks; j++) {
      const m = metrics[j];
      if (m.isMusic) musicCount++;
      confidenceSum += m.musicConfidence;
      rmsSum += m.rms;
    }

    const musicRatio = musicCount / windowChunks;
    const meanConfidence = confidenceSum / windowChunks;
    const meanRms = rmsSum / windowChunks;

    if (
      musicRatio >= INTRO_MIN_MUSIC_RATIO &&
      meanConfidence >= 0.48 &&
      meanRms >= baseEnergy * 0.95 &&
      hasConsecutiveMusicRun(metrics, i, Math.min(metrics.length, i + windowChunks + runChunks), runChunks)
    ) {
      return Math.max(0, i * chunkDuration - INTRO_PREROLL_S);
    }
  }

  // Fallback: find first sustained music run
  let runStart = -1;
  let runLen = 0;
  const introLimit = Math.min(metrics.length, maxScanChunks);

  for (let i = 0; i < introLimit; i++) {
    const m = metrics[i];
    if (m.isMusic && m.rms >= baseEnergy * 0.85) {
      if (runStart === -1) runStart = i;
      runLen++;
      if (runLen >= runChunks) {
        return Math.max(0, runStart * chunkDuration - INTRO_PREROLL_S);
      }
    } else {
      runStart = -1;
      runLen = 0;
    }
  }

  return 0;
}

function findEndTime(profile: AnalysisProfile, duration: number): number {
  const { metrics, baseEnergy, chunkDuration, voiceZcrFloor } = profile;
  const totalChunks = metrics.length;

  if (totalChunks < 16) return 0;

  const scanStart = Math.floor(totalChunks * OUTRO_SCAN_FROM_RATIO);
  const maxGapChunks = Math.max(1, Math.round(OUTRO_MAX_GAP_S / chunkDuration));
  const minSegmentChunks = Math.max(1, Math.round(OUTRO_MIN_SEGMENT_S / chunkDuration));
  const minTailChunks = Math.max(1, Math.round(OUTRO_MIN_TAIL_S / chunkDuration));

  const segments: Array<{ start: number; end: number; meanConfidence: number }> = [];

  let currentStart = -1;
  let lastMusic = -1;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (let i = scanStart; i < totalChunks; i++) {
    const m = metrics[i];

    if (m.isMusic) {
      if (currentStart === -1) {
        currentStart = i;
        confidenceSum = 0;
        confidenceCount = 0;
      }
      lastMusic = i;
      confidenceSum += m.musicConfidence;
      confidenceCount++;
      continue;
    }

    if (currentStart !== -1 && lastMusic !== -1 && i - lastMusic > maxGapChunks) {
      if (lastMusic - currentStart + 1 >= minSegmentChunks) {
        segments.push({
          start: currentStart,
          end: lastMusic,
          meanConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
        });
      }
      currentStart = -1;
      lastMusic = -1;
      confidenceSum = 0;
      confidenceCount = 0;
    }
  }

  if (currentStart !== -1 && lastMusic !== -1 && lastMusic - currentStart + 1 >= minSegmentChunks) {
    segments.push({
      start: currentStart,
      end: lastMusic,
      meanConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
    });
  }

  if (segments.length === 0) return 0;

  let lastMusicSegment = segments[segments.length - 1];
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].meanConfidence >= 0.45) {
      lastMusicSegment = segments[i];
      break;
    }
  }

  const tailStart = lastMusicSegment.end + 1;
  const tailChunks = totalChunks - tailStart;
  if (tailChunks < minTailChunks) return 0;

  let tailMusicCount = 0;
  let audibleNonMusicCount = 0;
  let voiceLikeCount = 0;
  let silenceCount = 0;

  for (let i = tailStart; i < totalChunks; i++) {
    const m = metrics[i];
    if (m.isMusic) {
      tailMusicCount++;
      continue;
    }
    if (m.rms >= baseEnergy * 0.45) {
      audibleNonMusicCount++;
      if (m.zcr >= voiceZcrFloor) voiceLikeCount++;
    } else {
      silenceCount++;
    }
  }

  const tailMusicRatio = tailMusicCount / tailChunks;
  const audibleNonMusicRatio = audibleNonMusicCount / tailChunks;
  const voiceLikeRatio = voiceLikeCount / tailChunks;
  const silenceRatio = silenceCount / tailChunks;

  const shouldTrimTail =
    tailMusicRatio <= OUTRO_MAX_TAIL_MUSIC_RATIO &&
    (
      audibleNonMusicRatio >= OUTRO_MIN_AUDIBLE_NON_MUSIC_RATIO ||
      voiceLikeRatio >= OUTRO_MIN_VOICE_RATIO ||
      silenceRatio >= OUTRO_MIN_SILENCE_RATIO
    );

  if (!shouldTrimTail) return 0;

  // Walk back to find the last strong musical moment
  let cutChunk = lastMusicSegment.end;
  while (cutChunk > scanStart) {
    const m = metrics[cutChunk];
    if (m.isMusic && m.musicConfidence >= 0.42 && m.rms >= baseEnergy * 0.7) break;
    cutChunk--;
  }

  const endTime = Math.min(duration, (cutChunk + 1) * chunkDuration + OUTRO_PAD_S);
  if (endTime < duration * 0.4) return 0;

  console.log(`[SmartAnalysis] Trim: endTime=${endTime.toFixed(1)}s / ${duration.toFixed(1)}s (tail: music=${(tailMusicRatio*100).toFixed(0)}% voice=${(voiceLikeRatio*100).toFixed(0)}% silence=${(silenceRatio*100).toFixed(0)}%)`);

  return endTime;
}

export function analyzeSmartPointsFromBuffer(buffer: AudioBuffer): SmartPoints {
  const profile = buildProfile(buffer);
  if (!profile) return { startTime: 0, endTime: 0 };

  const startTime = findStartTime(profile);
  const endTime = findEndTime(profile, buffer.duration);

  console.log(`[SmartAnalysis] Result: start=${startTime.toFixed(2)}s end=${endTime > 0 ? endTime.toFixed(2) + 's' : 'none'} duration=${buffer.duration.toFixed(1)}s`);

  return { startTime, endTime };
}
