import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

// GET — retorna settings globais de spots do usuário
export async function GET(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await ctx.db
    .from("spot_settings")
    .select("enabled, interval")
    .eq("user_id", ctx.userId)
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
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { enabled, interval } = await req.json();

  const { error } = await ctx.db
    .from("spot_settings")
    .upsert(
      {
        user_id: ctx.userId,
        enabled: enabled ?? false,
        interval: interval ?? 3,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
