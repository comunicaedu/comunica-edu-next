import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUser } from "@/lib/api-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SB_STORAGE_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/audio/`;

export interface SongRecord {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  cover_url: string | null;
  created_at: string;
  youtube_video_id: string | null;
  duration: number | null;
}

function resolveFilePath(fp: string): string {
  if (!fp) return fp;
  if (
    fp.startsWith("/uploads/") ||
    fp.startsWith("youtube:") ||
    fp.startsWith("imported/") ||
    fp.startsWith("direct:") ||
    fp.startsWith("http")
  ) return fp;
  return SB_STORAGE_BASE + fp;
}

function mapRow(s: any): SongRecord {
  return {
    id:               s.id,
    title:            s.title,
    artist:           s.artist ?? null,
    genre:            s.genre ?? null,
    file_path:        resolveFilePath(s.file_path ?? ""),
    cover_url:        s.cover_url ?? null,
    created_at:       s.created_at,
    youtube_video_id: s.youtube_video_id ?? null,
    duration:         s.duration ?? null,
  };
}

export async function GET(req: NextRequest) {
  const genre  = req.nextUrl.searchParams.get("genre");
  const search = req.nextUrl.searchParams.get("search");

  let query = supabase
    .from("songs")
    .select("*")
    .order("created_at", { ascending: false });

  if (genre)  query = query.eq("genre", genre);
  if (search) query = query.or(`title.ilike.%${search}%,artist.ilike.%${search}%,genre.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filtra músicas que este usuário ocultou (se autenticado)
  const user = await resolveApiUser(req);
  let hiddenIds = new Set<string>();
  if (user) {
    const { data: hiddenRows } = await supabase
      .from("user_hidden_items")
      .select("item_id")
      .eq("user_id", user.userId)
      .eq("item_type", "song");
    hiddenIds = new Set((hiddenRows ?? []).map((r: any) => r.item_id));
  }

  const songs = (data ?? []).filter((s: any) => !hiddenIds.has(s.id)).map(mapRow);
  return NextResponse.json({ songs });
}

export async function POST(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file     = formData.get("file") as File | null;
      const title    = formData.get("title") as string | null;
      const genre    = formData.get("genre") as string | null;
      const durationRaw = formData.get("duration");
      const duration = durationRaw != null && durationRaw !== ""
        ? Number.parseInt(String(durationRaw), 10)
        : null;

      if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

      const ext      = file.name.split(".").pop() ?? "mp3";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const buffer   = Buffer.from(await file.arrayBuffer());

      const { error: uploadError } = await supabase.storage
        .from("audio")
        .upload(fileName, buffer, { contentType: file.type || "audio/mpeg", upsert: false });

      if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

      const songTitle = title || file.name.replace(/\.[^.]+$/, "");

      // Verifica duplicata pelo título (case-insensitive)
      const { data: existing } = await supabase
        .from("songs")
        .select("*")
        .ilike("title", songTitle)
        .limit(1)
        .single();

      if (existing) {
        // Já existe — remove o arquivo recém-enviado e retorna o existente
        await supabase.storage.from("audio").remove([fileName]).catch(() => {});
        return NextResponse.json({ song: mapRow(existing), duplicate: true });
      }

      const row: any = {
        title:     songTitle,
        file_path: fileName,
        genre:     genre || null,
        uploaded_by: user.userId,
      };
      if (duration && Number.isFinite(duration) && duration > 0) row.duration = duration;

      const { data, error } = await supabase.from("songs").insert(row).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Dispara curadoria Gemini em background — skip se o cliente pedir (batch upload)
      const skipGemini = formData.get("skip_gemini") === "true";
      if (!skipGemini) {
        const origin = new URL(req.url).origin;
        const internalSecret = process.env.INTERNAL_API_SECRET;
        fetch(`${origin}/api/admin/gemini-curator`, {
          method: "POST",
          headers: internalSecret ? { "x-internal-call": internalSecret } : {},
        }).catch(() => {});
      }

      return NextResponse.json({ song: mapRow(data) });

    } else {
      const body = await req.json();
      const { title, artist, genre, youtube_video_id, file_path, cover_url, duration } = body;

      if (!title) return NextResponse.json({ error: "Título obrigatório" }, { status: 400 });

      // ── DEDUPLICAÇÃO GLOBAL ──
      // Se a música já existe no sistema (mesmo youtube_video_id ou mesmo file_path),
      // retorna a existente em vez de criar duplicata
      if (youtube_video_id) {
        const { data: existing } = await supabase
          .from("songs")
          .select("*")
          .eq("youtube_video_id", youtube_video_id)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({ song: mapRow(existing), duplicate: true });
        }
      }
      if (file_path && (file_path.startsWith("youtube:") || file_path.startsWith("imported/"))) {
        const { data: existing } = await supabase
          .from("songs")
          .select("*")
          .eq("file_path", file_path)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({ song: mapRow(existing), duplicate: true });
        }
      }

      const row: any = {
        title,
        file_path: file_path || "",
        genre:     genre || null,
        uploaded_by: user.userId,
      };

      // Adiciona colunas opcionais apenas se existirem no banco
      if (artist !== undefined)           row.artist           = artist || null;
      if (youtube_video_id !== undefined) row.youtube_video_id = youtube_video_id || null;
      if (cover_url !== undefined)        row.cover_url        = cover_url || null;
      if (duration !== undefined)         row.duration         = duration ? Number(duration) : null;

      const { data, error } = await supabase.from("songs").insert(row).select().single();

      // Se der erro de coluna inexistente, tenta só com campos básicos
      if (error?.code === "PGRST204") {
        const { data: data2, error: error2 } = await supabase
          .from("songs")
          .insert({ title, file_path: file_path || "", genre: genre || null })
          .select().single();
        if (error2) return NextResponse.json({ error: error2.message }, { status: 500 });
        return NextResponse.json({ song: mapRow(data2) });
      }

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ song: mapRow(data) });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { id, ...patch } = body;
    if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

    // Only admin or the uploader can edit
    if (!user.isAdmin) {
      const { data: song } = await supabase.from("songs").select("uploaded_by").eq("id", id).single();
      if (song?.uploaded_by !== user.userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const { error } = await supabase.from("songs").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

    const { data: song } = await supabase.from("songs").select("file_path, uploaded_by").eq("id", id).single();
    if (!song) return NextResponse.json({ error: "Música não encontrada" }, { status: 404 });

    // Regra: SÓ admin deleta do banco. Cliente (mesmo uploader) sempre soft-hide.
    if (user.isAdmin) {
      if (song.file_path && !song.file_path.startsWith("youtube:") &&
          !song.file_path.startsWith("imported/") && !song.file_path.startsWith("http") &&
          !song.file_path.startsWith("direct:")) {
        await supabase.storage.from("audio").remove([song.file_path]).catch(() => {});
      }
      const { error } = await supabase.from("songs").delete().eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, action: "deleted" });
    }

    const { error } = await supabase
      .from("user_hidden_items")
      .upsert(
        { user_id: user.userId, item_type: "song", item_id: id },
        { onConflict: "user_id,item_type,item_id" }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "hidden" });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}
