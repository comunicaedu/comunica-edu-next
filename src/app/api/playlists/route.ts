import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser, effectiveUserId } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const uid = effectiveUserId(user, req.nextUrl.searchParams.get("user_id"));

  let query = user.db.from("playlists").select("*").order("created_at", { ascending: false });

  // Admin olhando a si mesmo → vê tudo. Cliente (ou admin impersonando) → próprias + não-privadas.
  // is_public pode ser true ou NULL (default = público). Só is_public=false é privada.
  if (!user.isAdmin || uid !== user.userId) {
    query = query.or(`created_by.eq.${uid},is_public.neq.false`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filtra playlists que este usuário ocultou
  const { data: hiddenRows } = await user.db
    .from("user_hidden_items")
    .select("item_id")
    .eq("user_id", uid)
    .eq("item_type", "playlist");
  const hiddenIds = new Set((hiddenRows ?? []).map((r: any) => r.item_id));

  const playlists = (data ?? []).filter((p: any) => !hiddenIds.has(p.id));
  return NextResponse.json({ playlists });
}

export async function POST(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { name, description, is_public, cover_url, is_global, youtube_playlist_id } = body;

    if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });

    // Bloqueia duplicata por (created_by, lower(name))
    const { data: existingPl } = await user.db
      .from("playlists")
      .select("id, name")
      .eq("created_by", user.userId)
      .ilike("name", name)
      .maybeSingle();
    if (existingPl) {
      return NextResponse.json(
        { error: `Já existe uma playlist com o nome "${existingPl.name}" na sua biblioteca.`, duplicate: true, existing: existingPl },
        { status: 409 }
      );
    }

    const fullRow: any = { name, created_by: user.userId };
    if (cover_url           !== undefined) fullRow.cover_url           = cover_url           || null;
    if (is_public           !== undefined) fullRow.is_public           = is_public           ?? true;
    if (youtube_playlist_id !== undefined) fullRow.youtube_playlist_id = youtube_playlist_id || null;

    const { data, error } = await user.db
      .from("playlists")
      .insert(fullRow)
      .select()
      .single();

    // Coluna inexistente → tenta só com nome + created_by
    if (error?.code === "PGRST204" || error?.message?.includes("column")) {
      const { data: data2, error: error2 } = await user.db
        .from("playlists")
        .insert({ name, created_by: user.userId })
        .select()
        .single();
      if (error2) return NextResponse.json({ error: error2.message }, { status: 500 });
      return NextResponse.json({ playlist: data2 });
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ playlist: data });
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

    // Verifica ownership
    if (!user.isAdmin) {
      const { data: playlist } = await user.db
        .from("playlists")
        .select("created_by")
        .eq("id", id)
        .single();
      if (!playlist || playlist.created_by !== user.userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Nunca deixar o client trocar o created_by
    delete patch.created_by;

    const { error } = await user.db.from("playlists").update(patch).eq("id", id);
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

    const { data: playlist } = await user.db
      .from("playlists")
      .select("created_by")
      .eq("id", id)
      .single();
    if (!playlist) return NextResponse.json({ error: "Playlist não encontrada" }, { status: 404 });

    // Regra: SÓ admin deleta do banco. Cliente (mesmo dono) sempre soft-hide.
    if (user.isAdmin) {
      const { error } = await user.db.from("playlists").delete().eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, action: "deleted" });
    }

    const { error } = await user.db
      .from("user_hidden_items")
      .upsert(
        { user_id: user.userId, item_type: "playlist", item_id: id },
        { onConflict: "user_id,item_type,item_id" }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "hidden" });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}
