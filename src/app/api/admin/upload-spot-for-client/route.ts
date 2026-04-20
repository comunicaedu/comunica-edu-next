import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function resolveUser(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return null;
  const { data: { user }, error } = await adminClient().auth.getUser(token);
  if (error || !user) return null;
  return user;
}

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await adminClient()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

// POST — admin faz upload de spot e atribui a um cliente específico
export async function POST(req: NextRequest) {
  const caller = await resolveUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = adminClient();

  // Verifica se o chamador é admin
  if (!(await isAdmin(caller.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null) ?? "";
  const targetUserId = formData.get("target_user_id") as string | null;

  if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
  if (!targetUserId) return NextResponse.json({ error: "target_user_id obrigatório" }, { status: 400 });

  const ext = file.name.split(".").pop() ?? "mp3";
  const storagePath = `${targetUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("spots")
    .upload(storagePath, buffer, { contentType: file.type || "audio/mpeg", upsert: false });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data, error: dbError } = await admin
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
    await admin.storage.from("spots").remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ spot: data });
}
