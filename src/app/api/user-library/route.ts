import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser, effectiveUserId } from "@/lib/api-auth";

// GET /api/user-library?user_id=xxx
// Retorna quais playlist_ids e song_ids estão ocultos + overrides do usuário
export async function GET(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = effectiveUserId(user, req.nextUrl.searchParams.get("user_id"));

  // Buscar itens ocultos
  const { data: hiddenRows, error: hiddenErr } = await user.db
    .from("user_hidden_items")
    .select("item_type, item_id")
    .eq("user_id", userId);

  if (hiddenErr) {
    console.error("[user-library GET] hidden:", hiddenErr);
    return NextResponse.json({ error: "Falha ao buscar dados" }, { status: 500 });
  }

  const playlist_ids: string[] = [];
  const song_ids: string[] = [];
  for (const row of hiddenRows ?? []) {
    if (row.item_type === "playlist") playlist_ids.push(row.item_id);
    else if (row.item_type === "song") song_ids.push(row.item_id);
  }

  // Buscar overrides de playlist (armazenados em user_preferences.playlist_overrides)
  const { data: prefs } = await user.db
    .from("user_preferences")
    .select("playlist_overrides")
    .eq("user_id", userId)
    .maybeSingle();

  const overrides = prefs?.playlist_overrides ?? {};

  return NextResponse.json({
    hidden: { playlist_ids, song_ids },
    overrides,
  });
}

// POST /api/user-library
// body: { user_id, action: "hide_playlist"|"show_playlist"|"hide_song"|"show_song"|"override_playlist", ... }
export async function POST(req: NextRequest) {
  const authUser = await resolveApiUser(req);
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;
  const user_id = effectiveUserId(authUser, body.user_id);
  if (!action) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  // --- Hide / Show Playlist ---
  if (action === "hide_playlist" || action === "show_playlist") {
    if (!body.playlist_id) return NextResponse.json({ error: "playlist_id obrigatório" }, { status: 400 });

    if (action === "hide_playlist") {
      const { error } = await authUser.db
        .from("user_hidden_items")
        .upsert(
          { user_id, item_type: "playlist", item_id: body.playlist_id },
          { onConflict: "user_id,item_type,item_id" }
        );
      if (error) {
        console.error("[user-library POST] hide_playlist:", error);
        return NextResponse.json({ error: "Falha ao ocultar" }, { status: 500 });
      }
    } else {
      const { error } = await authUser.db
        .from("user_hidden_items")
        .delete()
        .eq("user_id", user_id)
        .eq("item_type", "playlist")
        .eq("item_id", body.playlist_id);
      if (error) {
        console.error("[user-library POST] show_playlist:", error);
        return NextResponse.json({ error: "Falha ao exibir" }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // --- Hide / Show Song ---
  if (action === "hide_song" || action === "show_song") {
    if (!body.song_id) return NextResponse.json({ error: "song_id obrigatório" }, { status: 400 });

    if (action === "hide_song") {
      const { error } = await authUser.db
        .from("user_hidden_items")
        .upsert(
          { user_id, item_type: "song", item_id: body.song_id },
          { onConflict: "user_id,item_type,item_id" }
        );
      if (error) {
        console.error("[user-library POST] hide_song:", error);
        return NextResponse.json({ error: "Falha ao ocultar" }, { status: 500 });
      }
    } else {
      const { error } = await authUser.db
        .from("user_hidden_items")
        .delete()
        .eq("user_id", user_id)
        .eq("item_type", "song")
        .eq("item_id", body.song_id);
      if (error) {
        console.error("[user-library POST] show_song:", error);
        return NextResponse.json({ error: "Falha ao exibir" }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // --- Override Playlist (name/cover) ---
  if (action === "override_playlist") {
    if (!body.playlist_id) return NextResponse.json({ error: "playlist_id obrigatório" }, { status: 400 });

    // Buscar overrides atuais
    const { data: prefs } = await authUser.db
      .from("user_preferences")
      .select("playlist_overrides")
      .eq("user_id", user_id)
      .maybeSingle();

    const overrides: Record<string, { name?: string; cover?: string }> = prefs?.playlist_overrides ?? {};

    if (!overrides[body.playlist_id]) overrides[body.playlist_id] = {};
    if (body.name !== undefined) overrides[body.playlist_id].name = body.name;
    if (body.cover !== undefined) overrides[body.playlist_id].cover = body.cover;

    const { error } = await authUser.db
      .from("user_preferences")
      .upsert(
        { user_id, playlist_overrides: overrides, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("[user-library POST] override_playlist:", error);
      return NextResponse.json({ error: "Falha ao salvar override" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
