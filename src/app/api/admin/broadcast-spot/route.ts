import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

// POST — admin envia spot para clientes selecionados (ou todos)
export async function POST(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null) ?? "";
  const targetIdsRaw = formData.get("targetUserIds") as string | null;

  if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

  const { data: usersData, error: usersError } = await ctx.db.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 });

  const { data: adminRoles } = await ctx.db.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds = new Set((adminRoles ?? []).map((r: any) => r.user_id));

  const allClientIds = usersData.users
    .filter((u) => !adminIds.has(u.id))
    .map((u) => u.id);

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
    const { error: uploadError } = await ctx.db.storage
      .from("spots")
      .upload(storagePath, buffer, { contentType: file.type || "audio/mpeg", upsert: false });

    if (uploadError) { fail++; continue; }

    const { error: dbError } = await ctx.db
      .from("spots")
      .insert({ user_id: targetUserId, title: spotTitle, file_path: storagePath });

    if (dbError) {
      await ctx.db.storage.from("spots").remove([storagePath]);
      fail++;
    } else {
      ok++;
    }
  }

  return NextResponse.json({ ok, fail, total: clientIds.length });
}
