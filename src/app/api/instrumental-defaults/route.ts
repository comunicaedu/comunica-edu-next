import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "instrumentals";

// Trilhas padrão de fábrica (caso admin ainda não tenha definido as suas)
const FACTORY_DEFAULTS: Record<string, { name: string; path: string }> = {
  campanha:    { name: "Wallpaper",      path: "campanha_1.mp3"    },
  sofisticado: { name: "Morning",        path: "sofisticado_1.mp3" },
  animado:     { name: "Paradise Found", path: "animado_1.mp3"     },
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET — retorna as 3 trilhas padrão (uma por categoria) com URLs assinadas frescas
export async function GET() {
  const db = adminClient();

  const keys = ["instrumental_default_campanha", "instrumental_default_sofisticado", "instrumental_default_animado"];
  const { data: settings } = await db.from("app_settings").select("key, value").in("key", keys);

  const settingsMap: Record<string, string> = {};
  for (const row of settings ?? []) settingsMap[row.key] = row.value;

  const result: Record<string, { name: string; url: string }> = {};

  for (const [cat, fallback] of Object.entries(FACTORY_DEFAULTS)) {
    const saved = settingsMap[`instrumental_default_${cat}`];
    let path = fallback.path;
    let name = fallback.name;

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        path = parsed.path;
        name = parsed.name;
      } catch { /* usa fallback */ }
    }

    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
    result[cat] = { name, url: signed?.signedUrl ?? "" };
  }

  return NextResponse.json({ tracks: result });
}

// POST — admin define nova trilha padrão para uma categoria
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file        = formData.get("file")        as File   | null;
    const category    = formData.get("category")    as string | null;
    const accessToken = formData.get("accessToken") as string | null;

    if (!file || !category || !accessToken) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!Object.keys(FACTORY_DEFAULTS).includes(category)) {
      return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });
    }

    const db = adminClient();

    // Verifica autenticação e role admin
    const { data: { user }, error: userError } = await db.auth.getUser(accessToken);
    if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: roleRow } = await db.from("user_roles")
      .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Upload (sobrescreve arquivo anterior)
    const ext  = file.name.split(".").pop()?.toLowerCase() ?? "mp3";
    const path = `system/${category}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await db.storage.from(BUCKET).upload(path, buffer, {
      contentType: file.type || "audio/mpeg",
      upsert: true,
    });
    if (uploadErr) throw uploadErr;

    // Salva metadados no app_settings
    const name = file.name.replace(/\.[^.]+$/, "");
    await db.from("app_settings").upsert(
      { key: `instrumental_default_${category}`, value: JSON.stringify({ path, name }) },
      { onConflict: "key" }
    );

    // Retorna URL assinada fresca
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
    return NextResponse.json({ ok: true, name, url: signed?.signedUrl ?? "" });
  } catch (err) {
    console.error("[instrumental-defaults POST]", err);
    return NextResponse.json({ error: "Falha ao salvar trilha." }, { status: 500 });
  }
}
