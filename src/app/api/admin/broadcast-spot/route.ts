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

// POST — admin envia spot para TODOS os clientes da plataforma
export async function POST(req: NextRequest) {
  const caller = await resolveUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = adminClient();

  if (!(await isAdmin(caller.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null) ?? "";
  const targetIdsRaw = formData.get("targetUserIds") as string | null;

  if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

  // Busca todos os usuários não-admin
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 });

  const { data: adminRoles } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds = new Set((adminRoles ?? []).map((r: any) => r.user_id));

  const allClientIds = usersData.users
    .filter((u) => !adminIds.has(u.id))
    .map((u) => u.id);

  // Se targetUserIds foi enviado, filtra só os selecionados (que sejam não-admin)
  let clientIds: string[];
  if (targetIdsRaw) {
    const requested = JSON.parse(targetIdsRaw) as string[];
    const validSet = new Set(allClientIds);
    clientIds = requested.filter((id) => validSet.has(id));
  } else {
    clientIds = allClientIds;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() ?? "mp3";
  const spotTitle = title || file.name.replace(/\.[^.]+$/, "");

  let ok = 0;
  let fail = 0;

  for (const targetUserId of clientIds) {
    const storagePath = `${targetUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from("spots")
      .upload(storagePath, buffer, { contentType: file.type || "audio/mpeg", upsert: false });

    if (uploadError) { fail++; continue; }

    const { error: dbError } = await admin
      .from("spots")
      .insert({ user_id: targetUserId, title: spotTitle, file_path: storagePath });

    if (dbError) {
      await admin.storage.from("spots").remove([storagePath]);
      fail++;
    } else {
      ok++;
    }
  }

  return NextResponse.json({ ok, fail, total: clientIds.length });
}
