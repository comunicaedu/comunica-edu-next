import { NextRequest, NextResponse } from "next/server";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const MIN_DURATION_S = 60;
const MAX_DURATION_S = 240; // 4 minutos

const TITLE_BLACKLIST = [
  "hora", "horas", "hour", "hours",
  "full album", "álbum completo", "album completo",
  "completo", "complete",
  "playlist", "mix", "megamix",
  "compilation", "compilação",
  "ao vivo", "live", "concert", "show completo",
  "anuncio", "anúncio", "comercial", "propaganda",
  "karaoke", "karaokê",
  "coletânea", "coletanea",
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

// GET /api/validate-youtube?videoId=XXX
// Retorna { valid: true } se o vídeo tem duração 1–4min e título aceitável
// Retorna { valid: false, reason: "..." } se for inválido
export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId") ?? "";
  if (!videoId) return NextResponse.json({ valid: false, reason: "no videoId" });
  if (!YOUTUBE_API_KEY) return NextResponse.json({ valid: true }); // sem chave → não bloqueia

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=contentDetails,snippet` +
      `&id=${encodeURIComponent(videoId)}` +
      `&key=${YOUTUBE_API_KEY}`
    );

    const data = await res.json();
    const item = data?.items?.[0];

    if (!item) return NextResponse.json({ valid: false, reason: "video not found" });

    const durationS = parseIso8601Duration(item.contentDetails?.duration ?? "");
    const title     = (item.snippet?.title ?? "").toLowerCase();

    if (durationS < MIN_DURATION_S) {
      return NextResponse.json({ valid: false, reason: `too short (${durationS}s)` });
    }
    if (durationS > MAX_DURATION_S) {
      return NextResponse.json({ valid: false, reason: `too long (${durationS}s)` });
    }
    if (TITLE_BLACKLIST.some((w) => title.includes(w))) {
      return NextResponse.json({ valid: false, reason: "blacklisted title" });
    }

    return NextResponse.json({ valid: true, durationS });
  } catch {
    return NextResponse.json({ valid: true }); // erro → não bloqueia
  }
}
