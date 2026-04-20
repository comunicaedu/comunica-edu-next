import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, access } from "fs/promises";
import path from "path";
import ytdl from "@distube/ytdl-core";

const YT_CACHE_DIR = path.join(process.cwd(), "public", "uploads", "songs", "yt_cached");

// POST /api/cache-audio
// body: { videoId: string }
// Baixa o áudio do YouTube e salva em /uploads/songs/yt_cached/{videoId}.mp3
// Retorna { file_path: "/uploads/songs/yt_cached/{videoId}.mp3" } ou { error }
export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();
    if (!videoId || typeof videoId !== "string" || videoId.length < 5) {
      return NextResponse.json({ error: "videoId inválido" }, { status: 400 });
    }

    // Sanitiza o videoId para evitar path traversal
    const safeId = videoId.replace(/[^a-zA-Z0-9_\-]/g, "");
    if (!safeId) return NextResponse.json({ error: "videoId inválido" }, { status: 400 });

    const fileName = `${safeId}.mp3`;
    const fullPath = path.join(YT_CACHE_DIR, fileName);
    const filePath = `/uploads/songs/yt_cached/${fileName}`;

    // Já existe? Retorna direto sem baixar novamente
    try {
      await access(fullPath);
      return NextResponse.json({ file_path: filePath, cached: true });
    } catch {
      // Arquivo não existe, vamos baixar
    }

    await mkdir(YT_CACHE_DIR, { recursive: true });

    const url = `https://www.youtube.com/watch?v=${safeId}`;

    // Valida que o vídeo existe e é acessível
    if (!ytdl.validateID(safeId)) {
      return NextResponse.json({ error: "ID do YouTube inválido" }, { status: 400 });
    }

    // Baixa apenas o stream de áudio (menor tamanho)
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = ytdl(url, {
        filter: "audioonly",
        quality: "highestaudio",
        requestOptions: {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        },
      });

      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const buffer = Buffer.concat(chunks);
    await writeFile(fullPath, buffer);

    return NextResponse.json({ file_path: filePath, cached: false, size_kb: Math.round(buffer.length / 1024) });
  } catch (err: any) {
    console.error("[cache-audio]", err?.message ?? err);
    return NextResponse.json({ error: "Falha ao baixar áudio" }, { status: 500 });
  }
}

// GET /api/cache-audio?videoId=xxx — verifica se já está cacheado
export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId") ?? "";
  const safeId = videoId.replace(/[^a-zA-Z0-9_\-]/g, "");
  if (!safeId) return NextResponse.json({ cached: false });

  const fullPath = path.join(YT_CACHE_DIR, `${safeId}.mp3`);
  try {
    await access(fullPath);
    return NextResponse.json({ cached: true, file_path: `/uploads/songs/yt_cached/${safeId}.mp3` });
  } catch {
    return NextResponse.json({ cached: false });
  }
}
