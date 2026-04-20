import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Retorna playlists + músicas do cliente para o modo independente
// Ordem: "Aleatório" primeiro, depois as demais por created_at
export async function GET(req: NextRequest) {
  const ownerId = req.nextUrl.searchParams.get("owner_id") ?? "";
  if (!ownerId) return NextResponse.json({ error: "owner_id obrigatório" }, { status: 400 });

  // Busca playlists do cliente
  const { data: playlists, error: plErr } = await supabase
    .from("playlists")
    .select("id, name, cover_url")
    .eq("created_by", ownerId)
    .order("created_at", { ascending: true });

  if (plErr) return NextResponse.json({ error: plErr.message }, { status: 500 });
  if (!playlists || playlists.length === 0) return NextResponse.json({ queue: [] });

  // "Aleatório" vem sempre primeiro
  const sorted = [
    ...playlists.filter(p => p.name?.toLowerCase().includes("aleatório") || p.name?.toLowerCase().includes("aleatorio")),
    ...playlists.filter(p => !p.name?.toLowerCase().includes("aleatório") && !p.name?.toLowerCase().includes("aleatorio")),
  ];

  // Busca músicas de cada playlist em ordem
  const queue: any[] = [];
  let position = 0;

  for (const playlist of sorted) {
    const { data: songs } = await supabase
      .from("playlist_songs")
      .select("position, songs(id, title, artist, file_path, cover_url, youtube_video_id)")
      .eq("playlist_id", playlist.id)
      .order("position", { ascending: true });

    for (const row of songs ?? []) {
      const s = (row as any).songs;
      if (!s) continue;
      // Pula músicas sem áudio confirmado
      if (!s.youtube_video_id && (!s.file_path || s.file_path.startsWith("youtube:pending") || s.file_path === "pending")) continue;
      queue.push({
        id: s.id,
        position: position++,
        title: s.title,
        artist: s.artist ?? null,
        file_path: s.file_path ?? "",
        cover_url: s.cover_url ?? null,
        youtube_video_id: s.youtube_video_id ?? null,
        item_type: "song",
        playlist_name: playlist.name,
      });
    }
  }

  return NextResponse.json({ queue });
}
