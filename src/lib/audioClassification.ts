/**
 * Audio Classification via Web Audio API
 *
 * Extracts audio features (BPM, energy, spectral centroid, etc.)
 * from an MP3 file in the browser, then sends to AI for classification.
 */

export interface AudioFeatures {
  bpm: number;
  averageEnergy: number;       // RMS energy 0-1
  spectralCentroid: number;    // brightness indicator
  zeroCrossingRate: number;    // speech vs music indicator
  dynamicRange: number;        // difference between loud and quiet
  durationSeconds: number;
}

export interface AudioClassification {
  genre: string;
  mood: string;           // alegre | triste | crente | vendas | relaxado
  moodLabel: string;
  isExplicit: boolean;
  confidence: number;     // 0-1
}

/**
 * Extract audio features from a File using Web Audio API.
 */
export async function extractAudioFeatures(file: File): Promise<AudioFeatures> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;

    // --- RMS Energy ---
    let sumSquares = 0;
    for (let i = 0; i < channelData.length; i++) {
      sumSquares += channelData[i] * channelData[i];
    }
    const averageEnergy = Math.sqrt(sumSquares / channelData.length);

    // --- Zero Crossing Rate ---
    let zeroCrossings = 0;
    for (let i = 1; i < channelData.length; i++) {
      if ((channelData[i] >= 0 && channelData[i - 1] < 0) ||
          (channelData[i] < 0 && channelData[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    const zeroCrossingRate = zeroCrossings / channelData.length;

    // --- Spectral Centroid (approximate via FFT on chunks) ---
    const fftSize = 2048;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    const freqData = new Float32Array(analyser.frequencyBinCount);

    // Analyze middle section of audio for representative spectral data
    const chunkSize = fftSize;
    const midStart = Math.floor(channelData.length / 2) - chunkSize;
    const chunk = channelData.slice(Math.max(0, midStart), midStart + chunkSize);

    // Manual DFT approximation for spectral centroid
    let weightedSum = 0;
    let magnitudeSum = 0;
    const numBins = 256;
    for (let k = 0; k < numBins; k++) {
      let real = 0, imag = 0;
      for (let n = 0; n < chunk.length; n++) {
        const angle = (2 * Math.PI * k * n) / chunk.length;
        real += chunk[n] * Math.cos(angle);
        imag -= chunk[n] * Math.sin(angle);
      }
      const magnitude = Math.sqrt(real * real + imag * imag);
      const freq = (k * sampleRate) / chunk.length;
      weightedSum += freq * magnitude;
      magnitudeSum += magnitude;
    }
    const spectralCentroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;

    // --- BPM Detection (onset-based) ---
    const bpm = detectBPM(channelData, sampleRate);

    // --- Dynamic Range ---
    const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows
    let maxRMS = 0, minRMS = 1;
    for (let i = 0; i < channelData.length - windowSize; i += windowSize) {
      let wSum = 0;
      for (let j = i; j < i + windowSize; j++) {
        wSum += channelData[j] * channelData[j];
      }
      const wRMS = Math.sqrt(wSum / windowSize);
      if (wRMS > maxRMS) maxRMS = wRMS;
      if (wRMS > 0.001 && wRMS < minRMS) minRMS = wRMS; // ignore silence
    }
    const dynamicRange = maxRMS - minRMS;

    return {
      bpm,
      averageEnergy,
      spectralCentroid,
      zeroCrossingRate,
      dynamicRange,
      durationSeconds: duration,
    };
  } finally {
    ctx.close().catch(() => {});
  }
}

/**
 * Simple onset-based BPM detection.
 */
function detectBPM(samples: Float32Array, sampleRate: number): number {
  const windowSize = Math.floor(sampleRate * 0.01); // 10ms
  const energies: number[] = [];

  for (let i = 0; i < samples.length - windowSize; i += windowSize) {
    let sum = 0;
    for (let j = i; j < i + windowSize; j++) {
      sum += samples[j] * samples[j];
    }
    energies.push(sum / windowSize);
  }

  // Detect onsets (energy peaks)
  const onsets: number[] = [];
  const threshold = 1.5;
  const avgWindow = 10;

  for (let i = avgWindow; i < energies.length; i++) {
    let localAvg = 0;
    for (let j = i - avgWindow; j < i; j++) {
      localAvg += energies[j];
    }
    localAvg /= avgWindow;

    if (energies[i] > localAvg * threshold && energies[i] > 0.001) {
      onsets.push(i);
    }
  }

  if (onsets.length < 4) return 120; // default

  // Calculate inter-onset intervals
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    intervals.push((onsets[i] - onsets[i - 1]) * (windowSize / sampleRate));
  }

  // Median interval → BPM
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];
  let bpm = 60 / medianInterval;

  // Normalize to reasonable range
  while (bpm > 200) bpm /= 2;
  while (bpm < 60) bpm *= 2;

  return Math.round(bpm);
}
