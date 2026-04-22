import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

// POST — admin faz upload de spot e atribui a um cliente específico
export async function POST(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null) ?? "";
  const targetUserId = formData.get("target_user_id") as string | null;

  if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
  if (!targetUserId) return NextResponse.json({ error: "target_user_id obrigatório" }, { status: 400 });

  const ext = file.name.split(".").pop() ?? "mp3";
  const storagePath = `${targetUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await ctx.db.storage
    .from("spots")
    .upload(storagePath, buffer, { contentType: file.type || "audio/mpeg", upsert: false });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data, error: dbError } = await ctx.db
    .from("spots")
    .insert({
      user_id: targetUserId,
      title: title || file.name.replace(/\.[^.]+$/, ""),
      file_path: storagePath,
      type: "mp3",
    })
    .select()
    .single();

  if (dbError) {
    await ctx.db.storage.from("spots").remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ spot: data });
}
