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
    const { username, accessToken } = await request.json();
    if (!username || !accessToken) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const admin = adminClient();

    // Verifica a sessão do usuário
    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const uname = username.trim().toLowerCase();
    const newEmail = `${uname}@comunicaedu.app`;

    // Atualiza o email do auth sem precisar de confirmação (admin)
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      email: newEmail,
      email_confirm: true,
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
