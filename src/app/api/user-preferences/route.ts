import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getUserId(db: ReturnType<typeof adminClient>, req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

// GET — retorna todas as preferências do usuário
export async function GET(req: NextRequest) {
  const db = adminClient();
  const userId = await getUserId(db, req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await db
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // Se não existe ainda, retorna defaults
  if (!data) {
    return NextResponse.json({ preferences: { user_id: userId } });
  }

  return NextResponse.json({ preferences: data });
}

// POST — atualiza preferências (merge parcial — só envia os campos que mudaram)
export async function POST(req: NextRequest) {
  const db = adminClient();
  const userId = await getUserId(db, req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  // Remove campos que não devem ser sobrescritos pelo cliente
  delete body.user_id;

  // Upsert com merge
  const { error } = await db
    .from("user_preferences")
    .upsert(
      { user_id: userId, ...body, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[user-preferences POST]", error);
    return NextResponse.json({ error: "Falha ao salvar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
