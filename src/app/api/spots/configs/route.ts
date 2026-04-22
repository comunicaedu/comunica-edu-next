import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

// GET — retorna todas as configs de spots do usuário
export async function GET(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await ctx.db
    .from("spot_configs")
    .select("spot_id, priority, enabled, schedule_start, schedule_end, interval_songs")
    .eq("user_id", ctx.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const configs: Record<string, any> = {};
  for (const row of data ?? []) {
    configs[row.spot_id] = {
      priority: Number(row.priority ?? 1),
      enabled: Boolean(row.enabled ?? true),
      scheduleStart: row.schedule_start ?? null,
      scheduleEnd: row.schedule_end ?? null,
      interval: row.interval_songs != null ? Number(row.interval_songs) : null,
      scheduledAt: null,
    };
  }

  return NextResponse.json({ configs });
}

// POST — salva config de um spot específico
export async function POST(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { spot_id, priority, enabled, scheduleStart, scheduleEnd, interval } = await req.json();
  if (!spot_id) return NextResponse.json({ error: "spot_id obrigatório" }, { status: 400 });

  const { error } = await ctx.db
    .from("spot_configs")
    .upsert(
      {
        spot_id,
        user_id: ctx.userId,
        priority: priority ?? 1,
        enabled: enabled ?? true,
        schedule_start: scheduleStart ?? null,
        schedule_end: scheduleEnd ?? null,
        interval_songs: interval ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "spot_id,user_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
