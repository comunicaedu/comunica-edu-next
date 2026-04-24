import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

// POST — apaga agendamentos concluídos há mais de 7 dias. Só admin.
export async function POST(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Forbidden - admin only" }, { status: 403 });

  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const cutoffDate = cutoffIso.slice(0, 10);

  const { data: spotsDeleted, error: spotsErr } = await ctx.db
    .from("spot_configs")
    .delete()
    .not("schedule_end", "is", null)
    .lt("schedule_end", cutoffIso)
    .select("spot_id");

  if (spotsErr) return NextResponse.json({ error: spotsErr.message }, { status: 500 });

  const { data: playlistsDeleted, error: plErr } = await ctx.db
    .from("playlist_schedules")
    .delete()
    .not("end_date", "is", null)
    .lt("end_date", cutoffDate)
    .select("id");

  if (plErr) return NextResponse.json({ error: plErr.message }, { status: 500 });

  return NextResponse.json({
    spots_deleted: spotsDeleted?.length ?? 0,
    playlists_deleted: playlistsDeleted?.length ?? 0,
    cutoff: cutoffIso,
  });
}
