import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUser } from "@/lib/api-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const YOUTUBE_API_KEY  = process.env.YOUTUBE_API_KEY;
const MIN_DURATION_S   = 60;
const MAX_DURATION_S   = 480; // 8 min — cobre a maioria das músicas normais

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
  "versão karaokê", "versao karaoke", "without vocals", "no vocals",
  "backing track", "pista",
  "acústico", "acustico", "acoustic", "unplugged",
  "versão acústica", "versao acustica", "acoustic version",
  "session", "sessions", "home session", "quarantine session",
  "tiny desk", "stripped", "cover",
];

function parseIso8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] ?? "0");
  const m = parseInt(match[2] ?? "0");
  const s = parseInt(match[3] ?? "0");
  return h * 3600 + m * 60 + s;
}

// POST /api/admin/clean-youtube
// Verifica todos os youtube_video_id salvos no banco e remove os inválidos
export async function POST(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });

  if (!YOUTUBE_API_KEY) {
    return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 });
  }

  // Busca todas as músicas com youtube_video_id salvo
  const { data: songs, error } = await supabase
    .from("songs")
    .select("id, title, youtube_video_id, file_path")
    .not("youtube_video_id", "is", null)
    .neq("youtube_video_id", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!songs?.length) return NextResponse.json({ cleaned: 0, message: "Nenhuma música com videoId encontrada" });

  const invalidIds: string[] = [];
  let cleaned = 0;

  // Processa em lotes de 50 (limite da YouTube API)
  for (let i = 0; i < songs.length; i += 50) {
    const batch = songs.slice(i, i + 50);
    const videoIds = batch
      .map((s) => s.youtube_video_id)
      .filter(Boolean)
      .join(",");

    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos` +
        `?part=contentDetails,snippet&id=${videoIds}&key=${YOUTUBE_API_KEY}`
      );
      const data = await res.json();

      const validMap: Record<string, { duration: number; title: string }> = {};
      for (const item of data.items ?? []) {
        validMap[item.id] = {
          duration: parseIso8601Duration(item.contentDetails?.duration ?? ""),
          title: item.snippet?.title ?? "",
        };
      }

      for (const song of batch) {
        const vid = song.youtube_video_id;
        if (!vid) continue;

        const info = validMap[vid];

        // Vídeo não existe mais no YouTube
        if (!info) { invalidIds.push(song.id); continue; }

        // Duração fora do intervalo
        if (info.duration < MIN_DURATION_S || info.duration > MAX_DURATION_S) {
          invalidIds.push(song.id); continue;
        }

        // Título na blacklist
        const lower = info.title.toLowerCase();
        if (TITLE_BLACKLIST.some((w) => lower.includes(w))) {
          invalidIds.push(song.id);
        }
      }
    } catch {
      // Lote falhou → pula sem remover (melhor manter do que apagar erroneamente)
    }
  }

  // Remove youtube_video_id das músicas inválidas em lotes
  for (let i = 0; i < invalidIds.length; i += 50) {
    const batch = invalidIds.slice(i, i + 50);
    await supabase
      .from("songs")
      .update({ youtube_video_id: null })
      .in("id", batch);
    cleaned += batch.length;
  }

  return NextResponse.json({
    total: songs.length,
    cleaned,
    message: `${cleaned} vídeos ruins removidos de ${songs.length} músicas verificadas`,
  });
}
