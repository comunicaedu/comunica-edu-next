import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUser } from "@/lib/api-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const MIN_DURATION_S  = 60;
const MAX_DURATION_S  = 480;

// ── Cooldown no servidor ──────────────────────────────────────────────────────
// Impede que múltiplos usuários/abas disparem a limpeza ao mesmo tempo.
// 23h de cooldown — roda no máximo 1× por dia por instância do servidor.
let lastRunTs = 0;
const COOLDOWN_MS = 23 * 60 * 60 * 1000;

// ── Canais confiáveis ─────────────────────────────────────────────────────────
const TRUSTED_CHANNELS = [
  "vevo",
  "kondzilla",
  "gr6 explode",
  "som livre",
  "warner music brasil",
  "canal kondzilla",
  "mk music",
  "musile records",
  "todah music",
  "graça music",
  "hillsong",
  "elevation worship",
  "bethel music",
  "maverick city music",
];

/** 2 = Topic (máxima prioridade), 1 = canal confiável, 0 = desconhecido */
function channelPriority(channelTitle: string): number {
  const lower = channelTitle.toLowerCase().trim();
  if (lower.endsWith("- topic")) return 2;
  if (TRUSTED_CHANNELS.some((tc) => lower.includes(tc))) return 1;
  return 0;
}

// ── Blacklist de títulos ──────────────────────────────────────────────────────
const TITLE_BLACKLIST = [
  "hora", "horas", "hour", "hours",
  "full album", "álbum completo", "album completo",
  "completo", "complete",
  "playlist", "mix", "megamix",
  "compilation", "compilação",
  "ao vivo", "live", "concert", "show completo",
  "anuncio", "anúncio", "comercial", "propaganda",
  "karaoke", "karaokê", "coletânea", "coletanea",
  "top 10", "top 20", "top 50", "top 100",
  "todas as músicas", "todas as musicas",
  "instrumental", "beat", "fundo musical",
  "without vocals", "no vocals", "backing track", "pista",
  "acústico", "acustico", "acoustic", "unplugged",
  "versão acústica", "versao acustica", "acoustic version",
  "session", "sessions", "home session", "quarantine session",
  "tiny desk", "stripped", "cover",
];

function isTitleBlacklisted(title: string): boolean {
  const lower = title.toLowerCase();
  return TITLE_BLACKLIST.some((w) => lower.includes(w));
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

// ── Busca no YouTube priorizando canais confiáveis ────────────────────────────
async function findTrustedVideo(
  title: string,
  artist: string | null
): Promise<string | null> {
  if (!YOUTUBE_API_KEY) return null;

  const base  = artist ? `${title} ${artist}` : title;
  const query = `${base} official audio`;

  try {
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=snippet&q=${encodeURIComponent(query)}` +
      `&type=video&videoCategoryId=10&videoDuration=short` +
      `&maxResults=20&key=${YOUTUBE_API_KEY}`
    );
    const searchData = await searchRes.json();
    if (!searchData.items?.length) return null;

    const candidates = (searchData.items as any[])
      .filter((item) => !isTitleBlacklisted(item.snippet?.title ?? ""))
      .map((item) => ({
        videoId:  item.id?.videoId as string,
        title:    item.snippet?.title as string,
        channel:  item.snippet?.channelTitle as string,
        priority: channelPriority(item.snippet?.channelTitle ?? ""),
      }))
      .filter((c) => c.videoId && c.priority > 0)
      .sort((a, b) => b.priority - a.priority); // Topic primeiro

    if (!candidates.length) return null;

    const ids = candidates.map((c) => c.videoId).join(",");
    const detailsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=contentDetails&id=${ids}&key=${YOUTUBE_API_KEY}`
    );
    const detailsData = await detailsRes.json();

    const durationMap: Record<string, number> = {};
    for (const item of detailsData.items ?? []) {
      durationMap[item.id] = parseIso8601Duration(item.contentDetails?.duration ?? "");
    }

    for (const c of candidates) {
      const dur = durationMap[c.videoId] ?? 0;
      if (dur >= MIN_DURATION_S && dur <= MAX_DURATION_S) {
        return c.videoId;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── POST /api/admin/clean-pending ─────────────────────────────────────────────
// Rota interna disparada após uploads de músicas.
// Cooldown de 23h no servidor — roda no máximo 1× por dia.
// Limite padrão: 80 músicas por execução (~8.080 unidades de cota).
// Quando a cota aumentar, basta mudar o parâmetro ?limit=N na chamada.
export async function POST(req: NextRequest) {
  // Permite chamadas internas server-to-server (de /api/import-playlist, etc.)
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

  // Cooldown — ignora chamadas repetidas dentro de 23h
  if (Date.now() - lastRunTs < COOLDOWN_MS) {
    return NextResponse.json({ skipped: true, message: "Cooldown ativo — já rodou recentemente." });
  }

  if (!YOUTUBE_API_KEY) {
    return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 });
  }

  // Limit configurável — padrão 80, aumentar quando cota for aprovada
  const url   = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "80", 10), 500);

  const { data: songs, error } = await supabase
    .from("songs")
    .select("id, title, artist, file_path")
    .or("file_path.eq.youtube:pending,file_path.eq.pending,file_path.eq.imported/pending")
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!songs?.length) {
    lastRunTs = Date.now();
    return NextResponse.json({ searched: 0, updated: 0, deleted: 0, message: "Nenhuma música pendente." });
  }

  // Marca cooldown ANTES de processar — evita execuções paralelas
  lastRunTs = Date.now();

  let updated = 0;
  let deleted = 0;

  for (const song of songs) {
    const videoId = await findTrustedVideo(song.title, song.artist);

    if (videoId) {
      await supabase
        .from("songs")
        .update({ file_path: `youtube:${videoId}`, youtube_video_id: videoId })
        .eq("id", song.id);
      updated++;
    } else {
      // Não encontrou canal confiável → deleta (cascata limpa playlists)
      await supabase
        .from("songs")
        .delete()
        .eq("id", song.id);
      deleted++;
    }

    // 300ms entre requisições — respeita rate limit da API
    await new Promise((r) => setTimeout(r, 300));
  }

  return NextResponse.json({
    searched: songs.length,
    updated,
    deleted,
    message: `${updated} resolvidas, ${deleted} deletadas de ${songs.length} pendentes.`,
  });
}
