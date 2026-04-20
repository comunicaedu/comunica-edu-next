import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

export async function POST(request: Request) {
  try {
    const { username, password, accessToken, profile } = await request.json();
    if (!username || !password || !accessToken) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const admin = adminClient();

    // Verifica que o chamador está autenticado
    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(accessToken);
    if (callerError || !caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const uname = username.trim().toLowerCase();
    const email = `${uname}@comunicaedu.app`;

    // Cria usuário sem exigir confirmação de email
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data?.user?.id) {
      return NextResponse.json({ error: "Usuário criado sem ID" }, { status: 500 });
    }

    const userId = data.user.id;

    // Upsert do profile via service role (bypassa RLS)
    await admin.from("profiles").upsert({
      user_id: userId,
      username: uname,
      display_name: profile?.nome || null,
    }, { onConflict: "user_id" });

    return NextResponse.json({ userId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
