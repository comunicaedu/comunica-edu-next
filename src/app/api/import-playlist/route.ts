import { NextResponse } from "next/server";

const YT_KEY = process.env.YOUTUBE_API_KEY!;
const YT_BASE = "https://www.googleapis.com/youtube/v3";

function truncateName(name: string, max = 40): string {
  const clean = name.trim();
  return clean.length > max ? clean.slice(0, max - 3).trimEnd() + "..." : clean;
}

function cleanPlaylistTitle(rawName: string, tracks: { title: string; artist: string }[] = []): string {
  let name = rawName ?? "";

  // Remove padrões genéricos do YouTube
  const junkPatterns = [
    /music videos?\s*\d{0,4}/gi,
    /best music videos?\s*\d{0,4}/gi,
    /top\s*\d+\s*(music|songs?|hits?|videos?)?/gi,
    /\b(vevo|official|HD|4K|UHD|HQ|lyrics?)\b/gi,
    /\b20[12]\d\b/g,            // anos como 2020-2029
    /\bplaylist\b/gi,
    /\bmix\b/gi,
    /\bhits?\b/gi,
    /[-|–—]+/g,                 // hífens e pipes
    /\s{2,}/g,                  // espaços duplos
  ];

  for (const pattern of junkPatterns) {
    name = name.replace(pattern, " ");
  }
  name = name.trim().replace(/^[\s\-|]+|[\s\-|]+$/g, "").trim();

  // Se ficou muito curto ou vazio, usa o artista mais frequente das faixas
  if (name.length < 3 && tracks.length > 0) {
    const artistCount: Record<string, number> = {};
    for (const t of tracks) {
      const a = (t.artist ?? "").split(/\s*[-,&]\s*/)[0].trim();
      if (a) artistCount[a] = (artistCount[a] ?? 0) + 1;
    }
    const topArtist = Object.entries(artistCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    name = topArtist ?? rawName;
  }

  return truncateName(name || rawName);
}

function detectPlatform(url: string): "youtube" | "spotify" | "deezer" | "unknown" {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("spotify.com")) return "spotify";
  if (url.includes("deezer.com")) return "deezer";
  return "unknown";
}

function extractYouTubePlaylistId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("list");
  } catch {
    if (/^PL[A-Za-z0-9_-]{10,}$/.test(url.trim())) return url.trim();
    return null;
  }
}

function extractSpotifyPlaylistId(url: string): string | null {
  const match = url.match(/playlist\/([A-Za-z0-9]+)/);
  return match?.[1] ?? null;
}

function extractDeezerPlaylistId(url: string): string | null {
  const match = url.match(/playlist\/(\d+)/);
  return match?.[1] ?? null;
}

// Search YouTube for a single track and return video ID
async function searchYouTubeTrack(title: string, artist: string): Promise<{ youtube_video_id: string; cover_url: string | null } | null> {
  try {
    const q = `${title} ${artist}`.trim();
    const res = await fetch(`${YT_BASE}/search?part=snippet&type=video&q=${encodeURIComponent(q)}&maxResults=1&key=${YT_KEY}`);
    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return null;
    return {
      youtube_video_id: item.id?.videoId,
      cover_url: item.snippet?.thumbnails?.medium?.url ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchDeezerPreview(playlistId: string) {
  const res = await fetch(`https://api.deezer.com/playlist/${playlistId}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.error) return null;

  const tracks = (data.tracks?.data ?? []).slice(0, 50).map((t: any) => ({
    title: t.title_short ?? t.title,
    artist: t.artist?.name ?? "",
    cover_url: t.album?.cover_medium ?? null,
    youtube_video_id: null as string | null,
  }));

  return {
    playlist_name: cleanPlaylistTitle(data.title ?? "Playlist Deezer", (data.tracks?.data ?? []).map((t: any) => ({ title: t.title, artist: t.artist?.name ?? "" }))),
    description: null,
    cover_url: data.picture_medium ?? null,
    tracks_count: data.nb_tracks ?? tracks.length,
    source: "deezer",
    tracks,
  };
}

async function fetchSpotifyPreview(playlistId: string) {
  // Use Spotify's public embed oEmbed to get playlist name
  try {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/${playlistId}`);
    const oembed = await oembedRes.json();
    const name = truncateName(oembed?.title ?? "Playlist Spotify");
    const cover_url = oembed?.thumbnail_url ?? null;
    // We can't get individual tracks without OAuth — return metadata only
    return { playlist_name: name, cover_url, tracks_count: 0, source: "spotify", tracks: [], description: null };
  } catch {
    return null;
  }
}

// GET /api/import-playlist?action=preview&url=...
// GET /api/import-playlist?action=search&q=...
// GET /api/import-playlist?action=playlist_by_id&id=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  // ── Search playlists by name ──
  if (action === "search") {
    const q = searchParams.get("q");
    if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

    const res = await fetch(
      `${YT_BASE}/search?part=snippet&type=playlist&q=${encodeURIComponent(q)}&maxResults=8&key=${YT_KEY}`
    );
    const data = await res.json();

    if (!res.ok) return NextResponse.json({ error: data.error?.message ?? "YouTube error" }, { status: 502 });

    const results = (data.items ?? []).map((item: any) => ({
      id: item.id?.playlistId,
      name: item.snippet?.title,
      description: item.snippet?.description ?? null,
      cover_url: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
      channel: item.snippet?.channelTitle ?? null,
    }));

    return NextResponse.json({ results });
  }

  // ── Preview playlist by URL or ID ──
  if (action === "preview" || action === "playlist_by_id") {
    const url = searchParams.get("url") ?? "";
    const directId = searchParams.get("id");
    const platform = url ? detectPlatform(url) : "youtube";

    // ── Deezer ──
    if (platform === "deezer") {
      let resolvedUrl = url;
      // Link curto (link.deezer.com) → resolve o redirect para pegar a URL final
      if (url.includes("link.deezer.com")) {
        try {
          const r = await fetch(url, { redirect: "follow" });
          resolvedUrl = r.url;
        } catch {
          return NextResponse.json({ error: "Link do Deezer inválido" }, { status: 400 });
        }
      }
      const dzId = extractDeezerPlaylistId(resolvedUrl);
      if (!dzId) return NextResponse.json({ error: "Link do Deezer inválido" }, { status: 400 });
      const preview = await fetchDeezerPreview(dzId);
      if (!preview) return NextResponse.json({ error: "Playlist Deezer não encontrada" }, { status: 404 });
      return NextResponse.json({ preview });
    }

    // ── Spotify ──
    if (platform === "spotify") {
      const spId = extractSpotifyPlaylistId(url);
      if (!spId) return NextResponse.json({ error: "Link do Spotify inválido" }, { status: 400 });
      const preview = await fetchSpotifyPreview(spId);
      if (!preview) return NextResponse.json({ error: "Playlist Spotify não encontrada" }, { status: 404 });
      return NextResponse.json({ preview, spotify_id: spId });
    }

    // ── YouTube ──
    const playlistId = directId ?? (url ? extractYouTubePlaylistId(url) : null);
    if (!playlistId) return NextResponse.json({ error: "URL ou ID inválido" }, { status: 400 });

    const metaRes = await fetch(`${YT_BASE}/playlists?part=snippet,contentDetails&id=${playlistId}&key=${YT_KEY}`);
    const metaData = await metaRes.json();
    if (!metaRes.ok || !metaData.items?.length) return NextResponse.json({ error: "Playlist não encontrada" }, { status: 404 });

    const meta = metaData.items[0];
    const totalCount: number = meta.contentDetails?.itemCount ?? 0;
    const itemsRes = await fetch(`${YT_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=50&key=${YT_KEY}`);
    const itemsData = await itemsRes.json();

    // Títulos que indicam conteúdo não-musical
    const NON_MUSIC_KEYWORDS = [
      "interview", "entrevista", "behind the scenes", "bastidores", "trailer",
      "making of", "documentary", "documentário", "reaction", "reação",
      "podcast", "talk show", "commentary", "comentário", "vlog", "short film",
      "movie", "filme", "episode", "episódio", "unboxing", "gameplay",
    ];

    const rawItems = (itemsData.items ?? []).filter((item: any) => {
      const title = (item.snippet?.title ?? "").toLowerCase();
      if (title === "private video" || title === "deleted video") return false;
      if (NON_MUSIC_KEYWORDS.some((kw) => title.includes(kw))) return false;
      return true;
    });

    // Buscar detalhes dos vídeos (duração + categoria) em lote
    const videoIds = rawItems
      .map((item: any) => item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId)
      .filter(Boolean)
      .join(",");

    let durationMap: Record<string, number> = {};
    let categoryMap: Record<string, string> = {};

    if (videoIds) {
      const detailsRes = await fetch(`${YT_BASE}/videos?part=contentDetails,snippet&id=${videoIds}&key=${YT_KEY}`);
      const detailsData = await detailsRes.json();
      for (const v of detailsData.items ?? []) {
        // Parse ISO 8601 duration (PT3M45S → seconds)
        const dur = v.contentDetails?.duration ?? "";
        const match = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (match) {
          const seconds = (parseInt(match[1] ?? "0") * 3600) + (parseInt(match[2] ?? "0") * 60) + parseInt(match[3] ?? "0");
          durationMap[v.id] = seconds;
        }
        categoryMap[v.id] = v.snippet?.categoryId ?? "";
      }
    }

    const tracks = rawItems
      .map((item: any) => {
        const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
        const duration = durationMap[videoId] ?? 0;
        const category = categoryMap[videoId] ?? "";
        // Filtrar: só música (categoria 10), duração entre 90s e 720s
        // categoria vazia = aceitar (pode ser playlist privada sem acesso total)
        if (duration > 0 && (duration < 90 || duration > 720)) return null;
        if (category && category !== "10") return null;
        return {
          title: truncateName(item.snippet?.title ?? "Sem título", 80),
          artist: item.snippet?.videoOwnerChannelTitle ?? item.snippet?.channelTitle ?? "",
          cover_url: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
          youtube_video_id: videoId ?? null,
          duration_seconds: duration || null,
        };
      })
      .filter(Boolean);

    const preview = {
      playlist_id: playlistId,
      playlist_name: cleanPlaylistTitle(meta.snippet?.title ?? "Playlist", tracks as any),
      description: meta.snippet?.description ?? null,
      cover_url: meta.snippet?.thumbnails?.maxres?.url ?? meta.snippet?.thumbnails?.high?.url ?? meta.snippet?.thumbnails?.medium?.url ?? null,
      tracks_count: totalCount,
      source: "youtube",
      tracks,
    };

    return NextResponse.json({ preview });
  }

  return NextResponse.json({ error: "action inválida" }, { status: 400 });
}

// POST /api/import-playlist — cria a playlist e insere as músicas
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const { playlist_name, description, cover_url, tracks, user_id, playlist_id: ytPlaylistId } = await request.json();

  if (!playlist_name || !tracks?.length) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  // Para faixas sem youtube_video_id, tenta buscar no YouTube.
  // Se a busca falhar (cota esgotada, etc.), importa mesmo assim com file_path="imported/pending"
  // — o cascade resolve o YouTube ID automaticamente quando a música for tocada.
  const resolvedTracks = await Promise.all(
    tracks.map(async (t: any) => {
      if (t.youtube_video_id) return t;
      const result = await searchYouTubeTrack(t.title, t.artist ?? "");
      if (result) return { ...t, youtube_video_id: result.youtube_video_id, cover_url: t.cover_url ?? result.cover_url };
      // Importa sem ID — cascade buscará no momento da reprodução
      return { ...t, youtube_video_id: null };
    })
  );

  // Só rejeita se a lista de faixas estiver completamente vazia
  if (!resolvedTracks.length) {
    return NextResponse.json({ error: "Nenhuma faixa encontrada" }, { status: 400 });
  }

  // 1. Criar a playlist como global (compartilhada entre todos os clientes)
  const createRes = await fetch(`${origin}/api/playlists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: playlist_name,
      description: description ?? null,
      cover_url: cover_url ?? null,
      created_by: user_id ?? null,
      is_global: true,
      youtube_playlist_id: ytPlaylistId ?? null,
    }),
  });

  const createData = await createRes.json();
  if (!createRes.ok || !createData.playlist?.id) {
    return NextResponse.json({ error: "Erro ao criar playlist" }, { status: 500 });
  }

  const playlistId = createData.playlist.id;

  // 2. Criar cada música individualmente e coletar os IDs
  const songIds: string[] = [];
  for (const track of resolvedTracks) {
    const filePath = track.youtube_video_id ? `youtube:${track.youtube_video_id}` : "imported/pending";
    const songRes = await fetch(`${origin}/api/songs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: track.title,
        artist: track.artist || null,
        genre: null,
        file_path: filePath,
        cover_url: track.cover_url ?? null,
        youtube_video_id: track.youtube_video_id ?? null,
      }),
    });
    const songData = await songRes.json();
    if (songData.song?.id) songIds.push(songData.song.id);
  }

  // 3. Adicionar músicas à playlist
  const songsRes = await fetch(`${origin}/api/playlist-songs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playlist_id: playlistId, song_ids: songIds }),
  });

  if (!songsRes.ok) {
    return NextResponse.json({ error: "Erro ao inserir músicas" }, { status: 500 });
  }

  return NextResponse.json({ playlist_id: playlistId, songs_count: songIds.length });
}
