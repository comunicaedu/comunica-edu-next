import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUser, effectiveUserId } from "@/lib/api-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/favorites?user_id=xxx
export async function GET(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targetUserId = req.nextUrl.searchParams.get("user_id") || undefined;
  const uid = effectiveUserId(user, targetUserId);

  const { data, error } = await supabase
    .from("user_favorites")
    .select("song_id, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ favorites: [] });
  return NextResponse.json({ favorites: data ?? [] });
}

// POST /api/favorites — adiciona ou remove favorito
// body: { song_id, action: "add"|"remove" }
export async function POST(req: NextRequest) {
  const user = await resolveApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { song_id, action } = await req.json();
  if (!song_id) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const uid = user.userId;

  if (action === "remove") {
    await supabase
      .from("user_favorites")
      .delete()
      .eq("user_id", uid)
      .eq("song_id", song_id);
  } else {
    await supabase
      .from("user_favorites")
      .upsert({ user_id: uid, song_id, created_at: new Date().toISOString() }, { onConflict: "user_id,song_id" });
  }

  return NextResponse.json({ ok: true });
}
