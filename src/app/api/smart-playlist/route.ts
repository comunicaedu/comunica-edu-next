import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const FAV_FILE = path.join(DATA_DIR, "user-favorites.json");
const SONGS_FILE = path.join(DATA_DIR, "songs.json");
const PLAYLISTS_FILE = path.join(DATA_DIR, "playlists.json");
const PLAYLIST_SONGS_FILE = path.join(DATA_DIR, "playlist-songs.json");
const SMART_FILE = path.join(DATA_DIR, "smart-playlists.json");

const SMART_DAYS = 7;
const TARGET_SIZE = 50;
const MIN_FAVORITES_TO_TRIGGER = 3;

interface FavEntry { song_id: string; favorited_at: string; }
interface SmartRecord { user_id: string; playlist_id: string; generated_at: string; expires_at: string; }

async function readJson(file: string): Promise<any> {
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return null; }
}
async function writeJson(file: string, data: any) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data), "utf-8");
}

// GET /api/smart-playlist?user_id=xxx
// Verifica se o usuário tem favoritos suficientes e gera/renova a playlist inteligente
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("user_id");
  if (!userId) return NextResponse.json({ playlist: null });

  const favsStore: Record<string, FavEntry[]> = (await readJson(FAV_FILE)) ?? {};
  const userFavs: FavEntry[] = favsStore[userId] ?? [];

  // Precisar de pelo menos MIN_FAVORITES_TO_TRIGGER favoritos
  if (userFavs.length < MIN_FAVORITES_TO_TRIGGER) {
    return NextResponse.json({ playlist: null, reason: "not_enough_favorites" });
  }

  // Verificar se já existe uma smart playlist válida (não expirada)
  const smartStore: SmartRecord[] = (await readJson(SMART_FILE)) ?? [];
  const existing = smartStore.find((s) => s.user_id === userId);
  if (existing && new Date(existing.expires_at) > new Date()) {
    return NextResponse.json({ playlist_id: existing.playlist_id, status: "existing" });
  }

  // Calcular gêneros mais favoritados
  const songs: any[] = (await readJson(SONGS_FILE)) ?? [];
  const songMap = new Map(songs.map((s) => [s.id, s]));

  const genreCount: Record<string, number> = {};
  for (const fav of userFavs) {
    const song = songMap.get(fav.song_id);
    if (song?.genre) {
      genreCount[song.genre] = (genreCount[song.genre] ?? 0) + 1;
    }
  }

  const favSongIds = new Set(userFavs.map((f) => f.song_id));
  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

  // Buscar músicas parecidas que o usuário ainda não favoritou
  let candidates = songs.filter(
    (s) => s.genre && topGenres.includes(s.genre) && !favSongIds.has(s.id)
  );

  // Completar com as próprias favoritas se precisar
  if (candidates.length < TARGET_SIZE) {
    const favSongs = userFavs.map((f) => songMap.get(f.song_id)).filter(Boolean);
    candidates = [...candidates, ...favSongs];
  }

  // Embaralhar e limitar a 50
  candidates = candidates.sort(() => Math.random() - 0.5).slice(0, TARGET_SIZE);

  if (!candidates.length) {
    return NextResponse.json({ playlist: null, reason: "no_songs_found" });
  }

  // Criar nome baseado nos gêneros
  const genreNames = topGenres.slice(0, 2).join(" e ");
  const playlistName = `Criamos para você — ${genreNames || "sua seleção"}`;

  // Criar a playlist
  const now = new Date();
  const expires = new Date(now.getTime() + SMART_DAYS * 24 * 60 * 60 * 1000);
  const playlistId = `smart-${userId.slice(0, 8)}-${Date.now()}`;

  const playlists: any[] = (await readJson(PLAYLISTS_FILE)) ?? [];
  // Remover smart playlist anterior deste usuário
  const filtered = playlists.filter((p) => !p.id.startsWith(`smart-${userId.slice(0, 8)}`));
  filtered.unshift({
    id: playlistId,
    name: playlistName,
    description: `Gerada automaticamente com base nos seus favoritos. Válida até ${expires.toLocaleDateString("pt-BR")}.`,
    cover_url: null,
    is_public: false,
    is_global: false,
    created_by: userId,
    youtube_playlist_id: null,
    created_at: now.toISOString(),
    is_smart: true,
  });
  await writeJson(PLAYLISTS_FILE, filtered);

  // Inserir músicas na playlist
  const joins: any[] = (await readJson(PLAYLIST_SONGS_FILE)) ?? [];
  // Remover joins da playlist anterior
  const filteredJoins = joins.filter((j) => !j.playlist_id.startsWith(`smart-${userId.slice(0, 8)}`));
  const newJoins = candidates.map((song, i) => ({
    id: `${playlistId}-${i}`,
    playlist_id: playlistId,
    song_id: song.id,
    position: i,
    created_at: now.toISOString(),
  }));
  await writeJson(PLAYLIST_SONGS_FILE, [...filteredJoins, ...newJoins]);

  // Salvar registro da smart playlist
  const updatedSmart = smartStore.filter((s) => s.user_id !== userId);
  updatedSmart.push({
    user_id: userId,
    playlist_id: playlistId,
    generated_at: now.toISOString(),
    expires_at: expires.toISOString(),
  });
  await writeJson(SMART_FILE, updatedSmart);

  return NextResponse.json({ playlist_id: playlistId, songs_count: candidates.length, status: "created" });
}
