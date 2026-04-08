"use client";

/**
 * Smart Shuffle System
 *
 * Rules:
 * 1. Songs play in random order when a playlist is selected
 * 2. New songs (added by auto-sync in the last 24h) get priority
 * 3. If user leaves and returns, already-played songs are excluded for 1 hour
 * 4. Unplayed songs from previous sessions get priority
 * 5. Local (server) songs always come before YouTube-only songs
 */

interface ShuffleSong {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  cover_url: string | null;
  created_at: string;
}

interface PlayHistory {
  playlistId: string;
  playedIds: string[];
  timestamp: number;
}

const STORAGE_KEY = "smart-shuffle-history";
const REPLAY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const NEW_SONG_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

function getHistory(): PlayHistory[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(history: PlayHistory[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

/** Record a song as played for a playlist */
export function markSongPlayed(playlistId: string, songId: string) {
  const history = getHistory();
  const existing = history.find(h => h.playlistId === playlistId);
  if (existing) {
    if (!existing.playedIds.includes(songId)) {
      existing.playedIds.push(songId);
    }
    existing.timestamp = Date.now();
  } else {
    history.push({ playlistId, playedIds: [songId], timestamp: Date.now() });
  }
  // Keep only last 20 playlists
  saveHistory(history.slice(-20));
}

/** Clear played history for a playlist (when all songs have been played) */
export function clearPlaylistHistory(playlistId: string) {
  const history = getHistory().filter(h => h.playlistId !== playlistId);
  saveHistory(history);
}

/** Get recently played song IDs if within the 1-hour window */
function getRecentlyPlayed(playlistId: string): Set<string> {
  const history = getHistory();
  const entry = history.find(h => h.playlistId === playlistId);
  if (!entry) return new Set();

  const elapsed = Date.now() - entry.timestamp;
  if (elapsed > REPLAY_WINDOW_MS) {
    // Expired — clear it
    clearPlaylistHistory(playlistId);
    return new Set();
  }
  return new Set(entry.playedIds);
}

/** Fisher-Yates shuffle */
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Check if a song is a local (server) file */
function isLocalSong(song: ShuffleSong): boolean {
  const fp = song.file_path;
  return !!fp && !fp.startsWith("youtube:") && !fp.startsWith("imported/") && !fp.startsWith("direct:");
}

/**
 * Build a smart shuffled queue for a playlist.
 * Priority order:
 * 1. New local songs (added in last 24h) that haven't been played in the last hour — shuffled
 * 2. Unplayed local songs — shuffled
 * 3. New YouTube songs (added in last 24h) that haven't been played — shuffled
 * 4. Unplayed YouTube songs — shuffled
 * 5. Already played songs (only if all others exhausted) — shuffled
 */
export function buildSmartQueue(playlistId: string, songs: ShuffleSong[]): ShuffleSong[] {
  if (songs.length === 0) return [];

  // Deduplicate by song ID first
  const seen = new Set<string>();
  const uniqueSongs = songs.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  const recentlyPlayed = getRecentlyPlayed(playlistId);
  const now = Date.now();

  const newLocalUnplayed: ShuffleSong[] = [];
  const regularLocalUnplayed: ShuffleSong[] = [];
  const newYtUnplayed: ShuffleSong[] = [];
  const regularYtUnplayed: ShuffleSong[] = [];
  const alreadyPlayed: ShuffleSong[] = [];

  for (const song of uniqueSongs) {
    const isPlayed = recentlyPlayed.has(song.id);
    const songAge = now - new Date(song.created_at).getTime();
    const isNew = songAge < NEW_SONG_THRESHOLD_MS;
    const isLocal = isLocalSong(song);

    if (isPlayed) {
      alreadyPlayed.push(song);
    } else if (isLocal && isNew) {
      newLocalUnplayed.push(song);
    } else if (isLocal) {
      regularLocalUnplayed.push(song);
    } else if (isNew) {
      newYtUnplayed.push(song);
    } else {
      regularYtUnplayed.push(song);
    }
  }

  // If all songs have been played within the hour, reset and treat all as unplayed
  const totalUnplayed = newLocalUnplayed.length + regularLocalUnplayed.length + newYtUnplayed.length + regularYtUnplayed.length;
  if (totalUnplayed === 0) {
    clearPlaylistHistory(playlistId);
    // Re-sort with server priority even on reset
    const local = uniqueSongs.filter(isLocalSong);
    const yt = uniqueSongs.filter(s => !isLocalSong(s));
    return [...shuffleArray(local), ...shuffleArray(yt)];
  }

  // Priority: local first (new > regular), then YouTube (new > regular), then already played last
  return [
    ...shuffleArray(newLocalUnplayed),
    ...shuffleArray(regularLocalUnplayed),
    ...shuffleArray(newYtUnplayed),
    ...shuffleArray(regularYtUnplayed),
    ...shuffleArray(alreadyPlayed),
  ];
}
