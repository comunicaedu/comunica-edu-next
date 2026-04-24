import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

// GET — lista spots; admin vê todos os spots da plataforma com tag do dono
export async function GET(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let query = ctx.db
    .from("spots")
    .select("id, title, file_path, created_at, user_id, type")
    .order("created_at", { ascending: false });

  if (!ctx.isAdmin) {
    query = query.eq("user_id", ctx.userId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Busca profiles de todos os donos para montar a tag (R3: badge em todos os painéis)
  const profileMap: Record<string, string> = {};
  if (data && data.length > 0) {
    const ownerIds = [...new Set(data.map((s: any) => s.user_id))];
    const { data: profiles } = await ctx.db
      .from("profiles")
      .select("user_id, display_name, username")
      .in("user_id", ownerIds);
    (profiles ?? []).forEach((p: any) => {
      profileMap[p.user_id] = p.display_name || p.username || p.user_id.slice(0, 8);
    });
    const missing = ownerIds.filter((id) => !profileMap[id]);
    if (missing.length > 0) {
      const { data: authUsers } = await ctx.db.auth.admin.listUsers({ perPage: 1000 });
      (authUsers?.users ?? []).forEach((u: any) => {
        if (missing.includes(u.id)) {
          profileMap[u.id] = u.email?.split("@")[0] ?? u.id.slice(0, 8);
        }
      });
    }
  }

  const spots = await Promise.all(
    (data ?? []).map(async (s: any) => {
      const { data: signed } = await ctx.db.storage
        .from("spots")
        .createSignedUrl(s.file_path, 3600);
      return {
        ...s,
        file_path: signed?.signedUrl ?? s.file_path,
        storage_path: s.file_path,
        owner_name: profileMap[s.user_id] ?? s.user_id.slice(0, 8),
        owner_id: s.user_id,
      };
    })
  );

  return NextResponse.json({ spots });
}

// POST — upload de spot. Se `replace_id` for enviado, substitui o file_path do spot existente
// (usado pelo fluxo mix do Locutor Virtual pra evitar spot duplicado).
export async function POST(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null) ?? "";
  const replaceId = (formData.get("replace_id") as string | null) ?? null;

  if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

  const ext = file.name.split(".").pop() ?? "mp3";
  const storagePath = `${ctx.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  // `type` é fixado em "mp3" porque a constraint do banco não aceita outros valores.
  // O tipo real do arquivo está em file_path (extensão) e no contentType do storage.
  const spotType = "mp3";

  if (replaceId) {
    const { data: existing } = await ctx.db
      .from("spots").select("id, user_id, file_path").eq("id", replaceId).single();
    if (!existing) return NextResponse.json({ error: "Spot não encontrado" }, { status: 404 });
    if (existing.user_id !== ctx.userId && !ctx.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: uploadError } = await ctx.db.storage
      .from("spots").upload(storagePath, buffer, { contentType: file.type || "audio/mpeg", upsert: false });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

    // Mantém o `type` original do registro — a constraint do banco não aceita "wav"
    const updatePatch: Record<string, unknown> = { file_path: storagePath };
    if (title) updatePatch.title = title;

    const { data, error: dbError } = await ctx.db
      .from("spots").update(updatePatch).eq("id", replaceId).select().single();

    if (dbError) {
      await ctx.db.storage.from("spots").remove([storagePath]);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }
    if (existing.file_path && existing.file_path !== storagePath) {
      await ctx.db.storage.from("spots").remove([existing.file_path]);
    }
    return NextResponse.json({ spot: data });
  }

  const { error: uploadError } = await ctx.db.storage
    .from("spots")
    .upload(storagePath, buffer, { contentType: file.type || "audio/mpeg", upsert: false });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data, error: dbError } = await ctx.db
    .from("spots")
    .insert({
      user_id: ctx.userId,
      title: title || file.name.replace(/\.[^.]+$/, ""),
      file_path: storagePath,
      type: spotType,
    })
    .select()
    .single();

  if (dbError) {
    await ctx.db.storage.from("spots").remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ spot: data });
}

// DELETE — exclui spot (somente o dono)
export async function DELETE(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();

  const { data: spot, error: findError } = await ctx.db
    .from("spots")
    .select("id, file_path, user_id")
    .eq("id", id)
    .single();

  if (findError || !spot) return NextResponse.json({ error: "Spot não encontrado" }, { status: 404 });
  if (spot.user_id !== ctx.userId && !ctx.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await ctx.db.storage.from("spots").remove([spot.file_path]);
  await ctx.db.from("spots").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}

// PATCH — renomeia (title) ou substitui file_path. Admin altera qualquer spot.
export async function PATCH(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, title, file_path } = await req.json();
  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title;
  if (file_path !== undefined) patch.file_path = file_path;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  let query = ctx.db.from("spots").update(patch).eq("id", id);
  if (!ctx.isAdmin) query = query.eq("user_id", ctx.userId);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
