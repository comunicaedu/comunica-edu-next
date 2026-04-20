import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const ownerId = req.nextUrl.searchParams.get("owner_id") ?? "";
  if (!ownerId) return NextResponse.json({ error: "owner_id obrigatório" }, { status: 400 });

  const { data, error } = await supabase
    .from("radio_state")
    .select("queue_index, is_playing, volume")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ state: data ?? { queue_index: 0, is_playing: false, volume: 70 } });
}
