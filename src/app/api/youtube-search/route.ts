import { NextRequest, NextResponse } from "next/server";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;

// Duração máxima: 4 minutos. Mínimo: 1 minuto.
const MIN_DURATION_S = 60;
const MAX_DURATION_S = 240;

// Blacklist de palavras no título que indicam que NÃO é música individual
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
  // versões acústicas / sem produção
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

function isTitleBlacklisted(title: string): boolean {
  const lower = title.toLowerCase();
  return TITLE_BLACKLIST.some((word) => lower.includes(word));
}

// Gemini verifica se o vídeo é uma música individual do gênero correto
async function geminiIsValidSong(
  title: string,
  channelTitle: string,
  durationS: number,
  expectedGenre?: string
): Promise<boolean> {
  if (!GEMINI_API_KEY) return true;

  try {
    const genreLine = expectedGenre
      ? `Gênero esperado da playlist: "${expectedGenre}"\n`
      : "";

    const genreRule = expectedGenre
      ? `- É do gênero "${expectedGenre}" ou compatível com ele?\n`
      : "";

    const prompt =
      `Você é um filtro EXTREMAMENTE rigoroso de músicas para uma rádio profissional. Analise este vídeo do YouTube:\n` +
      `Título: "${title}"\n` +
      `Canal: "${channelTitle}"\n` +
      `Duração: ${Math.floor(durationS / 60)}min ${durationS % 60}s\n` +
      genreLine +
      `\nResponda APENAS "SIM" se TODAS as condições abaixo forem verdadeiras:\n` +
      `- É uma música individual com VOZ e LETRA cantada pelo artista original\n` +
      `- É uma gravação de ESTÚDIO com produção completa (não ao vivo, não acústica, não unplugged)\n` +
      `- NÃO é versão acústica, cover, sessão ao vivo, home session, tiny desk ou qualquer variação sem produção de estúdio\n` +
      `- NÃO é instrumental, beat, karaokê, fundo musical, backing track ou versão sem voz\n` +
      `- NÃO é compilação, álbum completo, playlist, anúncio, comercial ou podcast\n` +
      `- O canal parece ser oficial do artista ou gravadora (VEVO, canal oficial, distribuidora)\n` +
      genreRule +
      `\nResponda "NÃO" se QUALQUER condição falhar. Em caso de dúvida, responda "NÃO".`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 10, temperature: 0 },
        }),
      }
    );

    if (!res.ok) return true; // erro na API → não bloqueia
    const data = await res.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return answer.trim().toUpperCase().startsWith("SIM");
  } catch {
    return true; // falha → não bloqueia
  }
}

export async function GET(req: NextRequest) {
  const title  = req.nextUrl.searchParams.get("title")  ?? "";
  const artist = req.nextUrl.searchParams.get("artist") ?? "";
  const genre  = req.nextUrl.searchParams.get("genre")  ?? undefined;

  if (!title)           return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!YOUTUBE_API_KEY) return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 });

  try {
    // Prioriza gravação oficial de estúdio: adiciona "official audio" à query
    const baseQuery = artist ? `${title} ${artist}` : title;
    const query = `${baseQuery} official audio`;

    // Busca vídeos curtos (< 4min) da categoria Música
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=snippet` +
      `&q=${encodeURIComponent(query)}` +
      `&type=video` +
      `&videoCategoryId=10` +
      `&videoDuration=short` +
      `&maxResults=15` +
      `&key=${YOUTUBE_API_KEY}`;

    const searchRes  = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.items?.length) {
      return NextResponse.json({ error: "no results" }, { status: 404 });
    }

    // 1º filtro: blacklist de títulos
    const validItems = (searchData.items as any[]).filter((item) =>
      !isTitleBlacklisted(item.snippet?.title ?? "")
    );

    if (!validItems.length) {
      return NextResponse.json({ error: "all results blocked by title filter" }, { status: 404 });
    }

    const videoIds = validItems.map((item: any) => item.id?.videoId).filter(Boolean).join(",");

    // Busca duração exata dos candidatos
    const detailsRes  = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`
    );
    const detailsData = await detailsRes.json();

    // Monta mapa videoId → duração
    const durationMap: Record<string, number> = {};
    for (const item of detailsData.items ?? []) {
      durationMap[item.id] = parseIso8601Duration(item.contentDetails?.duration ?? "");
    }

    // 2º filtro: duração + 3º filtro: Gemini
    for (const item of validItems) {
      const videoId    = item.id?.videoId;
      const durationS  = durationMap[videoId] ?? 0;
      const videoTitle = item.snippet?.title ?? "";
      const channel    = item.snippet?.channelTitle ?? "";

      if (durationS < MIN_DURATION_S || durationS > MAX_DURATION_S) continue;

      const approved = await geminiIsValidSong(videoTitle, channel, durationS, genre);
      if (approved) {
        return NextResponse.json({ videoId });
      }
    }

    return NextResponse.json({ error: "no suitable video found" }, { status: 404 });
  } catch (err: any) {
    console.error("[youtube-search]", err?.message ?? err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
