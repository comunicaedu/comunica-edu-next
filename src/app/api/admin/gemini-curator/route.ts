import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUser } from "@/lib/api-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

// Cooldown de 6h — pode rodar até 4× por dia
let lastRunTs = 0;
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE  = 50;

// ── Gemini: analisa uma música ────────────────────────────────────────────────
async function analyzeSong(title: string, artist: string | null): Promise<{
  genre: string | null;
  language: string | null;
  explicit: boolean;
} | null> {
  if (!GEMINI_KEY) return null;

  const prompt =
    `Analise esta música e responda APENAS com JSON válido, sem markdown:\n` +
    `Título: "${title}"\n` +
    `Artista/Canal: "${artist ?? "desconhecido"}"\n\n` +
    `Responda exatamente neste formato:\n` +
    `{"genre":"<gênero em português: gospel nacional, gospel internacional, pop nacional, pop internacional, sertanejo, pagode, funk, rock, eletrônico, reggae, outro>","language":"<pt-BR ou en-US ou es>","explicit":<true ou false>}\n\n` +
    `Regras para explicit=true: palavrões explícitos no título, artista conhecido por conteúdo adulto explícito, ou letra explicitamente sexual/violenta conhecida.\n` +
    `Em caso de dúvida no explicit, use false.`;

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 60, temperature: 0 },
      }),
    });

    if (!res.ok) return null;
    const data  = await res.json();
    const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const clean = text.trim().replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// ── Gemini: gera descrição de playlist ───────────────────────────────────────
async function generatePlaylistDescription(playlistName: string, sampleTitles: string[]): Promise<string | null> {
  if (!GEMINI_KEY || !sampleTitles.length) return null;

  const prompt =
    `Crie uma descrição curta (máximo 100 caracteres) para uma playlist de rádio chamada "${playlistName}".\n` +
    `Algumas músicas: ${sampleTitles.slice(0, 5).join(", ")}\n` +
    `Responda APENAS com o texto da descrição, sem aspas, sem markdown.`;

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 50, temperature: 0.3 },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return text.trim().slice(0, 100) || null;
  } catch {
    return null;
  }
}

// ── Gemini: playlist semanal de favoritos ─────────────────────────────────────
async function generateWeeklyPlaylist(userId: string): Promise<void> {
  // Busca favoritos do usuário
  const { data: favs } = await supabase
    .from("user_favorites")
    .select("song_id, songs(id, title, genre, file_path)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!favs?.length || favs.length < 3) return;

  // Conta gêneros mais favoritados
  const genreCount: Record<string, number> = {};
  for (const f of favs) {
    const genre = (f as any).songs?.genre;
    if (genre) genreCount[genre] = (genreCount[genre] ?? 0) + 1;
  }

  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

  if (!topGenres.length) return;

  const favSongIds = new Set(favs.map((f: any) => f.song_id));

  // Busca músicas do mesmo gênero que o usuário ainda não favoritou
  const { data: candidates } = await supabase
    .from("songs")
    .select("id, title, genre, file_path")
    .in("genre", topGenres)
    .not("file_path", "in", `(youtube:pending,imported/pending,pending)`)
    .limit(200);

  const pool = (candidates ?? [])
    .filter((s: any) => !favSongIds.has(s.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, 50);

  // Completa com favoritos se precisar
  const finalSongs = pool.length >= 20
    ? pool
    : [...pool, ...favs.map((f: any) => f.songs).filter(Boolean)].slice(0, 50);

  if (!finalSongs.length) return;

  const genreLabel = topGenres.slice(0, 2).join(" & ");
  const playlistName = `Criamos para você — ${genreLabel}`;
  const now     = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Remove smart playlist anterior deste usuário
  const { data: oldSmarts } = await supabase
    .from("smart_playlists")
    .select("playlist_id")
    .eq("user_id", userId);

  if (oldSmarts?.length) {
    const oldIds = oldSmarts.map((s: any) => s.playlist_id);
    await supabase.from("playlist_songs").delete().in("playlist_id", oldIds);
    await supabase.from("playlists").delete().in("id", oldIds);
    await supabase.from("smart_playlists").delete().eq("user_id", userId);
  }

  // Cria nova playlist
  const { data: newPlaylist } = await supabase
    .from("playlists")
    .insert({ name: playlistName, created_by: userId, is_public: false })
    .select("id")
    .single();

  if (!newPlaylist?.id) return;

  // Insere músicas
  const rows = finalSongs.map((s: any, i: number) => ({
    playlist_id: newPlaylist.id,
    song_id:     s.id,
    position:    i,
  }));
  await supabase.from("playlist_songs").insert(rows);

  // Registra smart playlist
  await supabase.from("smart_playlists").insert({
    user_id:      userId,
    playlist_id:  newPlaylist.id,
    generated_at: now.toISOString(),
    expires_at:   expires.toISOString(),
  }).then(() => {});
}

// ── POST /api/admin/gemini-curator ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Permite chamadas internas server-to-server (de /api/songs, /api/import-playlist, etc.)
  // usando o header x-internal-call com o segredo INTERNAL_API_SECRET.
  const internalSecret = process.env.INTERNAL_API_SECRET;
  const isInternalCall =
    !!internalSecret &&
    req.headers.get("x-internal-call") === internalSecret;

  if (!isInternalCall) {
    const user = await resolveApiUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.isAdmin) return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }

  if (Date.now() - lastRunTs < COOLDOWN_MS) {
    return NextResponse.json({ skipped: true, message: "Cooldown ativo." });
  }

  if (!GEMINI_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY não configurada" }, { status: 500 });
  }

  lastRunTs = Date.now();

  const url   = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? String(BATCH_SIZE), 10), 200);

  // Busca músicas sem gênero classificado
  const { data: songs, error } = await supabase
    .from("songs")
    .select("id, title, file_path")
    .is("genre", null)
    .not("file_path", "in", `(youtube:pending,imported/pending,pending)`)
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Busca todas as playlists com gênero para matching
  const { data: playlists } = await supabase
    .from("playlists")
    .select("id, name, genre");

  const playlistByGenre = new Map<string, string>();
  for (const p of playlists ?? []) {
    if (p.genre) playlistByGenre.set(p.genre.toLowerCase().trim(), p.id);
  }

  // Busca joins de músicas → playlists para saber onde cada música está
  const songIds = (songs ?? []).map((s: any) => s.id);
  const { data: joins } = await supabase
    .from("playlist_songs")
    .select("song_id, playlist_id")
    .in("song_id", songIds);

  const songPlaylistMap = new Map<string, string>();
  for (const j of joins ?? []) {
    songPlaylistMap.set(j.song_id, j.playlist_id);
  }

  let deleted  = 0;
  let moved    = 0;
  let updated  = 0;

  for (const song of songs ?? []) {
    const artist = song.file_path?.startsWith("youtube:")
      ? null
      : null;

    const analysis = await analyzeSong(song.title, artist);
    if (!analysis) continue;

    // Palavrão → deleta do banco (cascade remove de playlist_songs)
    if (analysis.explicit) {
      await supabase.from("songs").delete().eq("id", song.id);
      deleted++;
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    // Atualiza gênero na música
    const genreValue = analysis.genre || null;
    if (genreValue) {
      await supabase.from("songs").update({ genre: genreValue }).eq("id", song.id);
      updated++;
    }

    // Verifica se está na playlist errada e existe uma playlist correta
    const currentPlaylistId = songPlaylistMap.get(song.id);
    if (genreValue && currentPlaylistId) {
      const correctPlaylistId = playlistByGenre.get(genreValue.toLowerCase().trim());
      if (correctPlaylistId && correctPlaylistId !== currentPlaylistId) {
        // Move: remove da playlist atual, adiciona na correta
        await supabase
          .from("playlist_songs")
          .delete()
          .eq("song_id", song.id)
          .eq("playlist_id", currentPlaylistId);

        const { data: maxRow } = await supabase
          .from("playlist_songs")
          .select("position")
          .eq("playlist_id", correctPlaylistId)
          .order("position", { ascending: false })
          .limit(1)
          .single();

        await supabase.from("playlist_songs").insert({
          playlist_id: correctPlaylistId,
          song_id:     song.id,
          position:    (maxRow?.position ?? -1) + 1,
        });
        moved++;
      }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  // Gera descrições para playlists sem descrição
  const { data: playlistsWithoutDesc } = await supabase
    .from("playlists")
    .select("id, name")
    .is("description", null)
    .limit(10);

  for (const p of playlistsWithoutDesc ?? []) {
    const { data: pSongs } = await supabase
      .from("playlist_songs")
      .select("songs(title)")
      .eq("playlist_id", p.id)
      .limit(5);

    const titles = (pSongs ?? []).map((ps: any) => ps.songs?.title).filter(Boolean);
    const desc   = await generatePlaylistDescription(p.name, titles);
    if (desc) {
      await supabase.from("playlists").update({ description: desc }).eq("id", p.id).then(() => {});
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Gera playlists semanais para todos os usuários com favoritos
  const { data: userIds } = await supabase
    .from("user_favorites")
    .select("user_id")
    .limit(1000);

  const uniqueUsers = [...new Set((userIds ?? []).map((u: any) => u.user_id))];
  for (const uid of uniqueUsers) {
    await generateWeeklyPlaylist(uid);
  }

  return NextResponse.json({
    songs_analyzed: (songs ?? []).length,
    deleted,
    moved,
    updated,
    weekly_playlists: uniqueUsers.length,
    message: `Curadoria concluída: ${updated} classificadas, ${moved} movidas, ${deleted} deletadas.`,
  });
}
