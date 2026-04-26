import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUser } from "@/lib/api-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// PATCH /api/songs/[id] — lazy-fill de duration. Qualquer user com session válida pode chamar,
// mas só atualiza se duration atual for null/0 (não sobrescreve valor já preenchido).
// Se YouTube e duration > 270 (4:30), deleta a song e suas linhas em playlist_songs.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const dur = Number(body?.duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    return NextResponse.json({ error: "duration inválido" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("songs")
    .select("id, duration, file_path")
    .eq("id", id)
    .single();

  if (!existing) return NextResponse.json({ error: "Song não encontrada" }, { status: 404 });

  // Regra única: YouTube com duration > 270s (4:30) é deletado
  const isYouTube = existing.file_path?.startsWith("youtube:") ?? false;
  if (isYouTube && dur > 270) {
    await supabase.from("playlist_songs").delete().eq("song_id", id);
    await supabase.from("songs").delete().eq("id", id);
    return NextResponse.json({ ok: true, action: "deleted_over_limit" });
  }

  // Não sobrescrever se já tem valor válido
  if (existing.duration && existing.duration > 0) {
    return NextResponse.json({ ok: true, action: "noop" });
  }

  const { error } = await supabase
    .from("songs")
    .update({ duration: Math.round(dur) })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, action: "filled" });
}
