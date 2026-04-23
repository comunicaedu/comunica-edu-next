import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser, effectiveUserId } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const targetUserId = url.searchParams.get("userId");
  const playlistId = url.searchParams.get("playlistId");

  let query = ctx.db.from("playlist_schedules").select("*");

  if (playlistId) {
    query = query.eq("playlist_id", playlistId);
  }

  if (ctx.isAdmin && !targetUserId) {
    // admin vê todas
  } else {
    const uid = effectiveUserId(ctx, targetUserId);
    query = query.eq("user_id", uid);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ schedules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const target = ctx.isAdmin && body.target_user_id ? body.target_user_id : ctx.userId;

  const payload = { ...body, user_id: target };
  delete payload.target_user_id;

  const { data, error } = await ctx.db.from("playlist_schedules").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ schedule: data });
}

export async function PATCH(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, ...patch } = body;
  if (!id) return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });

  let query = ctx.db.from("playlist_schedules").update(patch).eq("id", id);
  if (!ctx.isAdmin) query = query.eq("user_id", ctx.userId);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await resolveApiUser(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });

  let query = ctx.db.from("playlist_schedules").delete().eq("id", id);
  if (!ctx.isAdmin) query = query.eq("user_id", ctx.userId);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
