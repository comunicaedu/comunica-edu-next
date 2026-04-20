import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser, effectiveUserId } from "@/lib/api-auth";

const BUCKET = "voice-recordings";

// GET — lista as gravações do usuário (ou de um cliente específico se admin)
export async function GET(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targetUserId = effectiveUserId(user, req.nextUrl.searchParams.get("user_id"));

  const { data, error } = await user.db
    .from("voice_recordings")
    .select("id, title, storage_path, duration, mime_type, created_at")
    .eq("user_id", targetUserId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Gera URLs assinadas frescas (1 hora)
  const recordings = await Promise.all(
    (data ?? []).map(async (r) => {
      const { data: signed } = await user.db.storage
        .from(BUCKET)
        .createSignedUrl(r.storage_path, 3600);
      return {
        id: r.id,
        title: r.title,
        url: signed?.signedUrl ?? "",
        duration: r.duration,
        mime_type: r.mime_type,
        created_at: r.created_at,
      };
    })
  );

  return NextResponse.json({ recordings });
}

// POST — upload de uma nova gravação
export async function POST(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string | null) ?? `Gravação ${new Date().toLocaleString("pt-BR")}`;
    const duration = parseInt((formData.get("duration") as string | null) ?? "0", 10);

    if (!file) return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });

    const ext = file.name.split(".").pop()?.toLowerCase() || "webm";
    const path = `${user.userId}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await user.db.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type || "audio/webm",
        upsert: false,
      });
    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const { data: row, error: insertErr } = await user.db
      .from("voice_recordings")
      .insert({
        user_id: user.userId,
        title,
        storage_path: path,
        duration,
        mime_type: file.type || "audio/webm",
      })
      .select()
      .single();
    if (insertErr) {
      await user.db.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const { data: signed } = await user.db.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);

    return NextResponse.json({
      recording: {
        id: row.id,
        title: row.title,
        url: signed?.signedUrl ?? "",
        duration: row.duration,
        mime_type: row.mime_type,
        created_at: row.created_at,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — remove gravação (do banco e storage)
export async function DELETE(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const { data: rec } = await user.db
    .from("voice_recordings")
    .select("storage_path, user_id")
    .eq("id", id)
    .single();

  if (!rec) return NextResponse.json({ error: "Gravação não encontrada" }, { status: 404 });

  // Cliente só pode deletar as suas; admin pode deletar de qualquer
  if (!user.isAdmin && rec.user_id !== user.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await user.db.storage.from(BUCKET).remove([rec.storage_path]);
  await user.db.from("voice_recordings").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}
