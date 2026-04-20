import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser, effectiveUserId } from "@/lib/api-auth";

const SB_STORAGE_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/audio/`;

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

/** Verifica acesso à playlist.
 *  mode='read'  → admin, dono OU playlist pública
 *  mode='write' → apenas admin ou dono (editar/adicionar/remover músicas da playlist)
 */
async function verifyPlaylistAccess(
  db: any,
  playlistId: string,
  userId: string,
  isAdmin: boolean,
  mode: "read" | "write" = "write"
): Promise<boolean> {
  if (isAdmin) return true;
  const { data } = await db
    .from("playlists")
    .select("created_by, is_public")
    .eq("id", playlistId)
    .single();
  if (!data) return false;
  if (data.created_by === userId) return true;
  // is_public pode ser true, false ou NULL — NULL trata como público (default)
  if (mode === "read" && data.is_public !== false) return true;
  return false;
}

export async function GET(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const playlistId = req.nextUrl.searchParams.get("playlist_id");
  const uid = effectiveUserId(user, req.nextUrl.searchParams.get("user_id"));

  if (!playlistId) {
    // Sem playlist_id: retorna joins apenas das playlists do usuário
    // Admin sem user_id vê tudo
    if (user.isAdmin && uid === user.userId && !req.nextUrl.searchParams.get("user_id")) {
      const { data, error } = await user.db
        .from("playlist_songs")
        .select("*")
        .order("position", { ascending: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ joins: data ?? [] });
    }

    // Busca IDs das playlists visíveis ao usuário: próprias + não-privadas (NULL = público)
    const { data: userPlaylists } = await user.db
      .from("playlists")
      .select("id")
      .or(`created_by.eq.${uid},is_public.neq.false`);
    const pIds = (userPlaylists ?? []).map((p: any) => p.id);

    if (pIds.length === 0) return NextResponse.json({ joins: [] });

    const { data, error } = await user.db
      .from("playlist_songs")
      .select("*")
      .in("playlist_id", pIds)
      .order("position", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ joins: data ?? [] });
  }

  // Com playlist_id: GET permite ler playlists públicas de outros
  if (!await verifyPlaylistAccess(user.db, playlistId, user.userId, user.isAdmin, "read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Busca músicas da playlist com join
  let data: any[] | null = null;
  let error: any = null;

  const fullSelect = await user.db
    .from("playlist_songs")
    .select(`id, position, song_id, songs (id, title, artist, genre, file_path, cover_url, created_at, youtube_video_id, duration)`)
    .eq("playlist_id", playlistId)
    .order("position", { ascending: true });

  if (fullSelect.error) {
    const baseSelect = await user.db
      .from("playlist_songs")
      .select(`id, position, song_id, songs (id, title, file_path, genre, created_at)`)
      .eq("playlist_id", playlistId)
      .order("position", { ascending: true });
    data = baseSelect.data;
    error = baseSelect.error;
  } else {
    data = fullSelect.data;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const songs = (data ?? [])
    .map((row: any) => {
      const s = row.songs;
      if (!s) return null;
      const fp = resolveFilePath(s.file_path ?? "");
      const ytId = s.youtube_video_id ?? (s.file_path?.startsWith("youtube:") ? s.file_path.replace("youtube:", "") : null);
      return {
        id:               s.id,
        title:            s.title,
        artist:           s.artist ?? null,
        genre:            s.genre ?? null,
        file_path:        fp,
        cover_url:        s.cover_url ?? null,
        created_at:       s.created_at,
        youtube_video_id: ytId,
        duration:         s.duration ?? null,
        position:         row.position,
        playlist_song_id: row.id,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ songs });
}

export async function POST(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { playlist_id, song_ids } = await req.json();
    if (!playlist_id || !Array.isArray(song_ids)) {
      return NextResponse.json({ error: "playlist_id e song_ids obrigatórios" }, { status: 400 });
    }

    // POST (adicionar música) → só dono ou admin
    if (!await verifyPlaylistAccess(user.db, playlist_id, user.userId, user.isAdmin, "write")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Busca posição máxima atual
    const { data: existing } = await user.db
      .from("playlist_songs")
      .select("song_id, position")
      .eq("playlist_id", playlist_id);

    const existingIds = new Set((existing ?? []).map((j: any) => j.song_id));
    let maxPos = (existing ?? []).reduce((m: number, j: any) => Math.max(m, j.position ?? 0), -1);

    const newRows = song_ids
      .filter((sid: string) => !existingIds.has(sid))
      .map((sid: string) => {
        maxPos++;
        return { playlist_id, song_id: sid, position: maxPos };
      });

    if (newRows.length === 0) return NextResponse.json({ added: 0 });

    const { error } = await user.db.from("playlist_songs").insert(newRows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ added: newRows.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();

    // Determina o playlist_id para verificar ownership
    let playlistId: string | null = body.playlist_id ?? null;

    // Se veio apenas id (do join), busca o playlist_id do registro
    if (!playlistId && body.id) {
      const { data: joinRow } = await user.db
        .from("playlist_songs")
        .select("playlist_id")
        .eq("id", body.id)
        .single();
      playlistId = joinRow?.playlist_id ?? null;
    }

    // DELETE (remover música da playlist) → só dono da playlist ou admin
    if (!playlistId && body.song_id) {
      if (!user.isAdmin) {
        const { data: joins } = await user.db
          .from("playlist_songs")
          .select("playlist_id")
          .eq("song_id", body.song_id);
        const pIds = [...new Set((joins ?? []).map((j: any) => j.playlist_id))];
        for (const pid of pIds) {
          if (!await verifyPlaylistAccess(user.db, pid as string, user.userId, false, "write")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
          }
        }
      }
    } else if (playlistId) {
      if (!await verifyPlaylistAccess(user.db, playlistId, user.userId, user.isAdmin, "write")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Parâmetro inválido" }, { status: 400 });
    }

    let query = user.db.from("playlist_songs").delete();

    if (body.id) {
      query = query.eq("id", body.id);
    } else if (body.playlist_id && body.song_id) {
      query = query.eq("playlist_id", body.playlist_id).eq("song_id", body.song_id);
    } else if (body.song_id) {
      query = query.eq("song_id", body.song_id);
    } else if (body.playlist_id) {
      query = query.eq("playlist_id", body.playlist_id);
    } else {
      return NextResponse.json({ error: "Parâmetro inválido" }, { status: 400 });
    }

    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}
