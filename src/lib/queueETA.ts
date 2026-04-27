import type { SpotConfigMap } from "./spotConfig";

interface QueueItem {
  id: string;
  title: string;
  duration?: number | null;
  genre?: string | null;
  file_path: string;
}

const DEFAULT_DURATION_SEC = 180; // fallback para musicas sem duration

export function getDuration(item: QueueItem): number {
  if (item.duration && item.duration > 0) return item.duration;
  return DEFAULT_DURATION_SEC;
}

/**
 * Calcula timeline da fila a partir de "agora".
 * Retorna array de { item, startsAt } onde startsAt eh em ms epoch.
 * Assume que o primeiro item ja esta tocando ha audioCurrentTime segundos.
 */
export function calculateQueueETA(
  queue: QueueItem[],
  audioCurrentTime: number,
  spots: QueueItem[],
  configs: SpotConfigMap,
  spotIntervalSongs: number,
): Array<{ item: QueueItem; startsAt: number; isSpot: boolean }> {
  const now = Date.now();
  const out: Array<{ item: QueueItem; startsAt: number; isSpot: boolean }> = [];

  // Primeiro item: calcular quanto falta dele tocar
  if (queue[0]) {
    const remaining = Math.max(0, getDuration(queue[0]) - audioCurrentTime);
    out.push({ item: queue[0], startsAt: now, isSpot: false });

    let cursor = now + remaining * 1000;
    let songCount = 1;
    let spotIdx = 0;

    for (let i = 1; i < queue.length; i++) {
      // Inserir spot intercalado se aplicavel
      if (spotIntervalSongs > 0 && spots.length > 0 && songCount % spotIntervalSongs === 0) {
        const spot = spots[spotIdx % spots.length];
        out.push({ item: spot, startsAt: cursor, isSpot: true });
        cursor += getDuration(spot) * 1000;
        spotIdx++;
      }

      const next = queue[i];
      out.push({ item: next, startsAt: cursor, isSpot: false });
      cursor += getDuration(next) * 1000;
      songCount++;
    }
  }

  return out;
}

/**
 * Encontra ponto natural na fila (entre items) onde encaixa o targetTime
 * dentro de tolerancia (default 60s).
 * Retorna o INDICE da fila apos o qual deve entrar a programacao,
 * ou null se nenhum ponto natural encaixa.
 */
export function findInsertionPoint(
  timeline: Array<{ item: QueueItem; startsAt: number; isSpot: boolean }>,
  targetTime: number,
  toleranceMs: number = 60_000,
): number | null {
  for (let i = 0; i < timeline.length - 1; i++) {
    const itemEndsAt = timeline[i + 1].startsAt;
    const diff = Math.abs(itemEndsAt - targetTime);
    if (diff <= toleranceMs) {
      return i; // programacao entra apos o item i
    }
  }
  return null;
}

/**
 * Reembaralha musicas restantes pra que a soma caia dentro da janela ±toleranceMs.
 * Mantem o primeiro item tocando (nao mexe na musica em curso).
 *
 * Tenta 4 estrategias em sequencia ate achar uma que caiba na janela:
 *   1. Greedy ordenando por duracao crescente
 *   2. Greedy ordenando por duracao decrescente
 *   3. Random shuffles (200 tentativas)
 *   4. Subset-sum exato (so se restMusic.length <= 15)
 *
 * Retorna null se NENHUMA estrategia conseguiu cair na janela —
 * caller deve manter a fila atual nesse caso.
 */
export function rebuildQueueForSchedule(
  queue: QueueItem[],
  audioCurrentTime: number,
  spots: QueueItem[],
  configs: SpotConfigMap,
  spotIntervalSongs: number,
  targetTime: number,
  toleranceMs: number = 60_000,
): QueueItem[] | null {
  const now = Date.now();
  if (queue.length <= 1) return null;

  const firstItemRemaining = Math.max(0, getDuration(queue[0]) - audioCurrentTime) * 1000;
  const timeToFillMs = (targetTime - now) - firstItemRemaining;

  if (timeToFillMs <= 0) return null;

  const restMusic = queue.slice(1).filter(q => q.genre !== "spot");
  if (restMusic.length === 0) return null;

  // Helper: calcula duracao total de uma sequencia incluindo spots intercalados
  const calculateTotalMs = (musicSeq: QueueItem[]): number => {
    let total = 0;
    let songCount = 1;
    let spotIdx = 0;
    for (const m of musicSeq) {
      if (spotIntervalSongs > 0 && spots.length > 0 && songCount % spotIntervalSongs === 0) {
        total += getDuration(spots[spotIdx % spots.length]) * 1000;
        spotIdx++;
      }
      total += getDuration(m) * 1000;
      songCount++;
    }
    return total;
  };

  // Helper: monta queue final com spots intercalados a partir de musicas
  const buildFinalQueue = (musicSeq: QueueItem[]): QueueItem[] => {
    const result: QueueItem[] = [queue[0]];
    let songCount = 1;
    let spotIdx = 0;
    for (const m of musicSeq) {
      if (spotIntervalSongs > 0 && spots.length > 0 && songCount % spotIntervalSongs === 0) {
        result.push(spots[spotIdx % spots.length]);
        spotIdx++;
      }
      result.push(m);
      songCount++;
    }
    // Concatenar musicas que nao entraram (depois do schedule)
    const usedIds = new Set(result.map(i => i.id));
    const remaining = restMusic.filter(m => !usedIds.has(m.id));
    return [...result, ...remaining];
  };

  // Helper: testa se uma combinacao cabe na janela
  const fitsInWindow = (totalMs: number): boolean => {
    return Math.abs(totalMs - timeToFillMs) <= toleranceMs;
  };

  // ESTRATEGIA 1: Greedy ordenando por duracao crescente
  const sortedAsc = [...restMusic].sort((a, b) => getDuration(a) - getDuration(b));
  const greedyAsc: QueueItem[] = [];
  let elapsedAsc = 0;
  for (const m of sortedAsc) {
    const mMs = getDuration(m) * 1000;
    if (elapsedAsc + mMs <= timeToFillMs + toleranceMs) {
      greedyAsc.push(m);
      elapsedAsc += mMs;
    }
  }
  if (fitsInWindow(calculateTotalMs(greedyAsc))) {
    return buildFinalQueue(greedyAsc);
  }

  // ESTRATEGIA 2: Greedy ordenando por duracao decrescente
  const sortedDesc = [...restMusic].sort((a, b) => getDuration(b) - getDuration(a));
  const greedyDesc: QueueItem[] = [];
  let elapsedDesc = 0;
  for (const m of sortedDesc) {
    const mMs = getDuration(m) * 1000;
    if (elapsedDesc + mMs <= timeToFillMs + toleranceMs) {
      greedyDesc.push(m);
      elapsedDesc += mMs;
    }
  }
  if (fitsInWindow(calculateTotalMs(greedyDesc))) {
    return buildFinalQueue(greedyDesc);
  }

  // ESTRATEGIA 3: Random shuffles - tentar 200 vezes
  for (let attempt = 0; attempt < 200; attempt++) {
    const shuffled = [...restMusic].sort(() => Math.random() - 0.5);
    const seq: QueueItem[] = [];
    let elapsed = 0;
    for (const m of shuffled) {
      const mMs = getDuration(m) * 1000;
      if (elapsed + mMs <= timeToFillMs + toleranceMs) {
        seq.push(m);
        elapsed += mMs;
      }
    }
    const total = calculateTotalMs(seq);
    if (fitsInWindow(total)) {
      return buildFinalQueue(seq);
    }
  }

  // ESTRATEGIA 4: Subset sum aproximado - so se restMusic <= 15 (2^15 = 32768 combinacoes)
  if (restMusic.length <= 15) {
    const n = restMusic.length;
    let bestFit: { seq: QueueItem[]; diff: number } | null = null;
    for (let mask = 1; mask < (1 << n); mask++) {
      const subset: QueueItem[] = [];
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) subset.push(restMusic[i]);
      }
      const total = calculateTotalMs(subset);
      const diff = Math.abs(total - timeToFillMs);
      if (diff <= toleranceMs) {
        // Achou subset que cabe — usar o primeiro encontrado, ordem aleatoria pra variar
        const ordered = [...subset].sort(() => Math.random() - 0.5);
        return buildFinalQueue(ordered);
      }
      if (!bestFit || diff < bestFit.diff) {
        bestFit = { seq: subset, diff };
      }
    }
    // Subset sum tambem nao achou — segue pra falha
  }

  // FALHA: nenhuma combinacao cabe em ±toleranceMs. NAO reembaralhar.
  return null;
}
