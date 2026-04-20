import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function resolveUser(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  const admin = adminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
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

// GET — lista spots; admin vê todos os spots da plataforma com tag do dono
export async function GET(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = adminClient();
  const callerIsAdmin = await isAdmin(user.id);

  let query = admin
    .from("spots")
    .select("id, title, file_path, created_at, user_id, type")
    .order("created_at", { ascending: false });

  if (!callerIsAdmin) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Para admin: busca profiles de todos os donos para montar a tag
  let profileMap: Record<string, string> = {};
  if (callerIsAdmin && data && data.length > 0) {
    const ownerIds = [...new Set(data.map((s: any) => s.user_id))];
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, display_name, username")
      .in("user_id", ownerIds);
    (profiles ?? []).forEach((p: any) => {
      profileMap[p.user_id] = p.display_name || p.username || p.user_id.slice(0, 8);
    });
    // fallback: busca emails do auth para os que não têm profile
    const missing = ownerIds.filter((id) => !profileMap[id]);
    if (missing.length > 0) {
      const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
      (authUsers?.users ?? []).forEach((u: any) => {
        if (missing.includes(u.id)) {
          profileMap[u.id] = u.email?.split("@")[0] ?? u.id.slice(0, 8);
        }
      });
    }
  }

  // Gera URLs assinadas para cada arquivo (válidas por 1 hora)
  const spots = await Promise.all(
    (data ?? []).map(async (s: any) => {
      const { data: signed } = await admin.storage
        .from("spots")
        .createSignedUrl(s.file_path, 3600);
      return {
        ...s,
        file_path: signed?.signedUrl ?? s.file_path,
        storage_path: s.file_path,
        owner_name: callerIsAdmin ? (profileMap[s.user_id] ?? s.user_id.slice(0, 8)) : undefined,
        owner_id: callerIsAdmin ? s.user_id : undefined,
      };
    })
  );

  return NextResponse.json({ spots });
}

// POST — upload de spot (cliente envia para si mesmo)
export async function POST(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = (formData.get("title") as string | null) ?? "";

  if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

  const ext = file.name.split(".").pop() ?? "mp3";
  const storagePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const admin = adminClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("spots")
    .upload(storagePath, buffer, { contentType: file.type || "audio/mpeg", upsert: false });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data, error: dbError } = await admin
    .from("spots")
    .insert({
      user_id: user.id,
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

// DELETE — exclui spot (somente o dono)
export async function DELETE(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  const admin = adminClient();

  const { data: spot, error: findError } = await admin
    .from("spots")
    .select("id, file_path, user_id")
    .eq("id", id)
    .single();

  if (findError || !spot) return NextResponse.json({ error: "Spot não encontrado" }, { status: 404 });
  if (spot.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await admin.storage.from("spots").remove([spot.file_path]);
  await admin.from("spots").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}

// PATCH — renomeia spot
export async function PATCH(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, title } = await req.json();
  const admin = adminClient();

  const { error } = await admin
    .from("spots")
    .update({ title })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
