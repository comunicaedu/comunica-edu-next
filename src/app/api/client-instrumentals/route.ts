import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "instrumentals";
const CATEGORIES = ["campanha", "sofisticado", "animado"];

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getUserFromToken(db: ReturnType<typeof adminClient>, token: string) {
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// GET — retorna as trilhas customizadas do cliente (por user_id via query param)
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = adminClient();
  const user = await getUserFromToken(db, token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: rows } = await db
    .from("client_instrumentals")
    .select("category, storage_path")
    .eq("user_id", user.id);

  const tracks: Record<string, { url: string }> = {};
  for (const row of rows ?? []) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, 3600);
    if (signed?.signedUrl) {
      tracks[row.category] = { url: signed.signedUrl };
    }
  }

  return NextResponse.json({ tracks });
}

// POST — cliente faz upload de trilha customizada para uma categoria
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file        = formData.get("file")        as File   | null;
    const category    = formData.get("category")    as string | null;
    const accessToken = formData.get("accessToken") as string | null;

    if (!file || !category || !accessToken) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });
    }

    const db = adminClient();
    const user = await getUserFromToken(db, accessToken);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Deleta arquivo anterior do storage se existir
    const { data: existing } = await db
      .from("client_instrumentals")
      .select("storage_path")
      .eq("user_id", user.id)
      .eq("category", category)
      .maybeSingle();

    if (existing?.storage_path) {
      await db.storage.from(BUCKET).remove([existing.storage_path]);
    }

    // Upload novo arquivo
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp3";
    const path = `clients/${user.id}/${category}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await db.storage.from(BUCKET).upload(path, buffer, {
      contentType: file.type || "audio/mpeg",
      upsert: true,
    });
    if (uploadErr) throw uploadErr;

    // Upsert no banco
    await db.from("client_instrumentals").upsert(
      { user_id: user.id, category, storage_path: path },
      { onConflict: "user_id,category" }
    );

    // Retorna URL assinada
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
    return NextResponse.json({ ok: true, url: signed?.signedUrl ?? "" });
  } catch (err) {
    console.error("[client-instrumentals POST]", err);
    return NextResponse.json({ error: "Falha ao salvar trilha." }, { status: 500 });
  }
}

// DELETE — cliente volta ao padrão (exclui trilha do banco e storage)
export async function DELETE(req: NextRequest) {
  try {
    const { category, accessToken } = await req.json();
    if (!category || !accessToken) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });
    }

    const db = adminClient();
    const user = await getUserFromToken(db, accessToken);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Busca o registro para saber o path do storage
    const { data: existing } = await db
      .from("client_instrumentals")
      .select("storage_path")
      .eq("user_id", user.id)
      .eq("category", category)
      .maybeSingle();

    if (existing?.storage_path) {
      // Deleta do storage
      await db.storage.from(BUCKET).remove([existing.storage_path]);
    }

    // Deleta do banco
    await db.from("client_instrumentals")
      .delete()
      .eq("user_id", user.id)
      .eq("category", category);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[client-instrumentals DELETE]", err);
    return NextResponse.json({ error: "Falha ao remover trilha." }, { status: 500 });
  }
}
