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

// GET — retorna settings globais de spots do usuário
export async function GET(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await adminClient()
    .from("spot_settings")
    .select("enabled, interval")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    settings: {
      enabled: data?.enabled ?? false,
      interval: data?.interval ?? 3,
    },
  });
}

// POST — salva settings globais de spots do usuário
export async function POST(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { enabled, interval } = await req.json();

  const { error } = await adminClient()
    .from("spot_settings")
    .upsert(
      {
        user_id: user.id,
        enabled: enabled ?? false,
        interval: interval ?? 3,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
