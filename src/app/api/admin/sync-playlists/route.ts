import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUser } from "@/lib/api-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const YT_KEY  = process.env.YOUTUBE_API_KEY!;
const YT_BASE = "https://www.googleapis.com/youtube/v3";

// Cooldown de 20h — sincroniza no máximo 1× por dia por instância
let lastRunTs = 0;
const COOLDOWN_MS = 20 * 60 * 60 * 1000;

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

function parseIso8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (
    parseInt(match[1] ?? "0") * 3600 +
    parseInt(match[2] ?? "0") * 60 +
    parseInt(match[3] ?? "0")
  );
}

async function fetchAllPlaylistItems(playlistId: string): Promise<any[]> {
  const items: any[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 5; page++) {
    const url = `${YT_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=50&key=${YT_KEY}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res  = await fetch(url);
    const data = await res.json();
    items.push(...(data.items ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return items;
}

export async function POST(req: NextRequest) {
  // Permite chamadas internas server-to-server usando o header x-internal-call
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

  // Busca todas as playlists que têm youtube_playlist_id
  const { data: playlists, error } = await supabase
    .from("playlists")
    .select("id, name, youtube_playlist_id")
    .not("youtube_playlist_id", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!playlists?.length) return NextResponse.json({ message: "Nenhuma playlist vinculada ao YouTube." });

  lastRunTs = Date.now();

  let totalAdded   = 0;
  let totalRemoved = 0;

  for (const playlist of playlists) {
    const ytId = playlist.youtube_playlist_id as string;

    // 1. Busca itens atuais no YouTube
    const rawItems = await fetchAllPlaylistItems(ytId);

    // 2. Filtra só canais confiáveis com youtube_video_id
    const trustedItems = rawItems.filter((item: any) => {
      const channel = item.snippet?.videoOwnerChannelTitle ?? item.snippet?.channelTitle ?? "";
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      const title   = (item.snippet?.title ?? "").toLowerCase();
      if (!videoId) return false;
      if (title === "private video" || title === "deleted video") return false;
      return isTrustedChannel(channel);
    });

    // 3. Valida duração em lote
    const videoIds = trustedItems
      .map((i: any) => i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId)
      .filter(Boolean);

    const durationMap: Record<string, number> = {};
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50).join(",");
      const res   = await fetch(`${YT_BASE}/videos?part=contentDetails&id=${batch}&key=${YT_KEY}`);
      const data  = await res.json();
      for (const v of data.items ?? []) {
        durationMap[v.id] = parseIso8601Duration(v.contentDetails?.duration ?? "");
      }
    }

    // IDs válidos (duração entre 60s e 720s)
    const validYtIds = new Set(
      trustedItems
        .map((i: any) => i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId)
        .filter((id: string) => {
          const dur = durationMap[id] ?? 0;
          return dur >= 60 && dur <= 720;
        })
    );

    // 4. Busca músicas já existentes nessa playlist
    const { data: existingSongs } = await supabase
      .from("playlist_songs")
      .select("song_id, songs(file_path)")
      .eq("playlist_id", playlist.id);

    const existingYtIds = new Set(
      (existingSongs ?? [])
        .map((ps: any) => {
          const fp = ps.songs?.file_path ?? "";
          return fp.startsWith("youtube:") ? fp.replace("youtube:", "") : null;
        })
        .filter(Boolean)
    );

    // 5. Adiciona músicas novas
    for (const item of trustedItems) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      if (!validYtIds.has(videoId) || existingYtIds.has(videoId)) continue;

      const title   = item.snippet?.title ?? "Sem título";
      const channel = item.snippet?.videoOwnerChannelTitle ?? item.snippet?.channelTitle ?? "";
      const cover   = item.snippet?.thumbnails?.medium?.url ?? null;

      // Cria a música
      const { data: newSong } = await supabase
        .from("songs")
        .insert({ title, file_path: `youtube:${videoId}`, genre: null })
        .select("id")
        .single();

      if (!newSong?.id) continue;

      // Busca posição máxima atual
      const { data: maxRow } = await supabase
        .from("playlist_songs")
        .select("position")
        .eq("playlist_id", playlist.id)
        .order("position", { ascending: false })
        .limit(1)
        .single();

      const nextPos = (maxRow?.position ?? -1) + 1;

      await supabase
        .from("playlist_songs")
        .insert({ playlist_id: playlist.id, song_id: newSong.id, position: nextPos });

      totalAdded++;
    }

    // Remoção automática desativada — músicas indisponíveis são puladas silenciosamente pelo player.
  }

  return NextResponse.json({
    playlists_synced: playlists.length,
    songs_added:      totalAdded,
    songs_removed:    totalRemoved,
    message:          `Sincronização concluída: ${totalAdded} adicionadas, ${totalRemoved} removidas.`,
  });
}
