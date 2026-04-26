import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser, effectiveUserId } from "@/lib/api-auth";

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

  // ── Search playlists by name (trusted music channels only) ──
  if (action === "search") {
    const q = searchParams.get("q");
    if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

    // Canais confiáveis — mesma lista usada na importação (POST)
    const TRUSTED_CHANNEL_PATTERNS = [
      /- topic$/i,
      /vevo/i,
      /kondzilla/i,
      /gr6 explode/i,
      /som livre/i,
      /warner music brasil/i,
      /mk music/i,
      /musile records/i,
      /todah music/i,
      /graça music/i,
      /hillsong/i,
      /elevation worship/i,
      /bethel music/i,
      /maverick city music/i,
    ];

    const isTrustedChannel = (channel: string) =>
      TRUSTED_CHANNEL_PATTERNS.some((p) => p.test(channel ?? ""));

    // Busca mais resultados para ter margem após o filtro de canal
    const musicQuery = `${q} playlist`;
    const res = await fetch(
      `${YT_BASE}/search?part=snippet&type=playlist&q=${encodeURIComponent(musicQuery)}&maxResults=50&key=${YT_KEY}`
    );
    const data = await res.json();

    if (!res.ok) return NextResponse.json({ error: data.error?.message ?? "YouTube error" }, { status: 502 });

    const results = (data.items ?? [])
      .filter((item: any) => isTrustedChannel(item.snippet?.channelTitle ?? ""))
      .slice(0, 8)
      .map((item: any) => ({
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

    // Busca todas as páginas (máx 5 páginas = 250 itens para limitar cota)
    const allRawItems: any[] = [];
    let pageToken: string | undefined = undefined;
    for (let page = 0; page < 5; page++) {
      const pageUrl: string = `${YT_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=50&key=${YT_KEY}${pageToken ? `&pageToken=${pageToken}` : ""}`;
      const itemsRes: Response = await fetch(pageUrl);
      const itemsData: { items?: unknown[]; nextPageToken?: string } = await itemsRes.json();
      allRawItems.push(...(itemsData.items ?? []));
      if (!itemsData.nextPageToken) break;
      pageToken = itemsData.nextPageToken;
    }

    // Títulos que indicam conteúdo não-musical
    const NON_MUSIC_KEYWORDS = [
      "interview", "entrevista", "behind the scenes", "bastidores", "trailer",
      "making of", "documentary", "documentário", "reaction", "reação",
      "podcast", "talk show", "commentary", "comentário", "vlog", "short film",
      "movie", "filme", "episode", "episódio", "unboxing", "gameplay",
    ];

    const rawItems = allRawItems.filter((item: any) => {
      const title = (item.snippet?.title ?? "").toLowerCase();
      if (title === "private video" || title === "deleted video") return false;
      if (NON_MUSIC_KEYWORDS.some((kw) => title.includes(kw))) return false;
      return true;
    });

    // Buscar detalhes dos vídeos (duração + categoria) em lotes de 50
    let durationMap: Record<string, number> = {};
    let categoryMap: Record<string, string> = {};

    const allVideoIds = rawItems
      .map((item: any) => item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId)
      .filter(Boolean);

    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batch = allVideoIds.slice(i, i + 50).join(",");
      const detailsRes = await fetch(`${YT_BASE}/videos?part=contentDetails,snippet&id=${batch}&key=${YT_KEY}`);
      const detailsData = await detailsRes.json();
      for (const v of detailsData.items ?? []) {
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
        // Filtrar: só música (categoria 10), duração até 270s (4:30)
        // categoria vazia = aceitar (pode ser playlist privada sem acesso total)
        if (duration > 0 && duration > 270) return null;
        if (category && category !== "10") return null;
        return {
          title: truncateName(item.snippet?.title ?? "Sem título", 80),
          artist: item.snippet?.videoOwnerChannelTitle ?? item.snippet?.channelTitle ?? "",
          cover_url: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
          youtube_video_id: videoId ?? null,
          duration: duration || null,
        };
      })
      .filter(Boolean)
      .slice(0, 200); // Preview retorna até 200; o POST aplica o limite real por role

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
export async function POST(request: NextRequest) {
  const user = await resolveApiUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const origin = new URL(request.url).origin;
  const { playlist_name, description, cover_url, tracks, user_id: targetUserId, playlist_id: ytPlaylistId } = await request.json();

  const userId = effectiveUserId(user, targetUserId);

  if (!playlist_name || !tracks?.length) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  // Admin pode importar até 200 músicas; clientes até 50
  const TRACK_LIMIT = user.isAdmin ? 200 : 50;

  // Canais confiáveis — só estes têm áudio limpo (sem barulho de videoclipe)
  const TRUSTED_CHANNEL_PATTERNS = [
    /- topic$/i,
    /vevo/i,
    /kondzilla/i,
    /gr6 explode/i,
    /som livre/i,
    /warner music brasil/i,
    /mk music/i,
    /musile records/i,
    /todah music/i,
    /graça music/i,
    /hillsong/i,
    /elevation worship/i,
    /bethel music/i,
    /maverick city music/i,
  ];

  function isTrustedChannel(channelTitle: string): boolean {
    const lower = (channelTitle ?? "").toLowerCase().trim();
    return TRUSTED_CHANNEL_PATTERNS.some((p) => p.test(lower));
  }

  // Só entra no banco música de canal confiável (Topic/VEVO etc).
  // Clipes de canais não-confiáveis são descartados — não entram no banco.
  const resolvedTracks = tracks.filter((t: any) =>
    t.youtube_video_id && isTrustedChannel(t.artist ?? "")
  ).slice(0, TRACK_LIMIT);

  // Só rejeita se a lista de faixas estiver completamente vazia
  if (!resolvedTracks.length) {
    return NextResponse.json({ error: "Nenhuma faixa encontrada" }, { status: 400 });
  }

  // ── DETECÇÃO DE PLAYLIST DUPLICADA ──
  // Se já existe playlist com o mesmo youtube_playlist_id ou mesmo nome+músicas,
  // avisa o usuário e retorna a playlist existente
  if (ytPlaylistId) {
    const { data: existingPlaylist } = await user.db
      .from("playlists")
      .select("id, name, cover_url, created_by")
      .eq("youtube_playlist_id", ytPlaylistId)
      .maybeSingle();
    if (existingPlaylist) {
      return NextResponse.json({
        duplicate: true,
        message: "Esta playlist já existe no sistema",
        playlist: existingPlaylist,
      });
    }
  }

  // Forward auth header to internal API calls
  const authHeader = request.headers.get("authorization");
  const internalFetchHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) internalFetchHeaders["Authorization"] = authHeader;

  // 1. Criar a playlist como global (compartilhada entre todos os clientes)
  const createRes = await fetch(`${origin}/api/playlists`, {
    method: "POST",
    headers: internalFetchHeaders,
    body: JSON.stringify({
      name: playlist_name,
      cover_url: cover_url ?? null,
      created_by: userId,
      youtube_playlist_id: ytPlaylistId ?? null,
    }),
  });

  const createData = await createRes.json();
  if (!createRes.ok || !createData.playlist?.id) {
    return NextResponse.json({ error: createData.error ?? "Erro ao criar playlist" }, { status: 500 });
  }

  const playlistId = createData.playlist.id;

  // 2. Criar cada música individualmente e coletar os IDs
  const songIds: string[] = [];
  for (const track of resolvedTracks) {
    const filePath = track.youtube_video_id ? `youtube:${track.youtube_video_id}` : "imported/pending";
    const songRes = await fetch(`${origin}/api/songs`, {
      method: "POST",
      headers: internalFetchHeaders,
      body: JSON.stringify({
        title: track.title,
        artist: track.artist || null,
        genre: null,
        file_path: filePath,
        cover_url: track.cover_url ?? null,
        youtube_video_id: track.youtube_video_id ?? null,
        duration: track.duration ?? null,
      }),
    });
    const songData = await songRes.json();
    if (songData.song?.id) songIds.push(songData.song.id);
  }

  // 3. Adicionar músicas à playlist
  const songsRes = await fetch(`${origin}/api/playlist-songs`, {
    method: "POST",
    headers: internalFetchHeaders,
    body: JSON.stringify({ playlist_id: playlistId, song_ids: songIds }),
  });

  if (!songsRes.ok) {
    return NextResponse.json({ error: "Erro ao inserir músicas" }, { status: 500 });
  }

  // Dispara limpeza e curadoria em background — sem await, não bloqueia a resposta.
  const internalSecret = process.env.INTERNAL_API_SECRET;
  const internalHeaders: Record<string, string> = internalSecret
    ? { "x-internal-call": internalSecret }
    : {};
  fetch(`${origin}/api/admin/clean-pending`, { method: "POST", headers: internalHeaders }).catch(() => {});
  fetch(`${origin}/api/admin/gemini-curator`, { method: "POST", headers: internalHeaders }).catch(() => {});

  return NextResponse.json({ playlist_id: playlistId, songs_count: songIds.length });
}
