import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

// GET — leitura pública de settings (sem auth, dados não sensíveis)
export async function GET(req: NextRequest) {
  const keys = req.nextUrl.searchParams.get("keys");
  if (!keys) return NextResponse.json({ settings: {} });

  const keyList = keys.split(",").map(k => k.trim()).filter(Boolean);
  const { data } = await adminClient()
    .from("app_settings")
    .select("key, value")
    .in("key", keyList);

  const settings: Record<string, string> = {};
  for (const row of data ?? []) settings[row.key] = row.value;

  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  try {
    const { key, value, accessToken } = await request.json();
    if (!key || !value || !accessToken) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const admin = adminClient();

    // Verify caller is authenticated
    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Owner bypass — sem consulta ao banco
    const ownerUserId = process.env.VOICE_COMMAND_USER_ID;
    const isOwner = ownerUserId ? user.id === ownerUserId : false;

    if (!isOwner) {
      // Verifica role admin na tabela user_roles
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (!roleRow) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const { error } = await admin
      .from("app_settings")
      .upsert({ key, value }, { onConflict: "key" });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[save-setting]", err);
    return NextResponse.json({ error: "Falha ao salvar." }, { status: 500 });
  }
}
