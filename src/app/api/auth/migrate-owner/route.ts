import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

// Migra o email de auth do proprietário para o formato username@comunicaedu.app
// Chamado uma vez para resolver o período de transição
export async function POST(request: Request) {
  try {
    const { currentEmail, username } = await request.json();
    if (!currentEmail || !username) {
      return NextResponse.json({ error: "currentEmail e username são obrigatórios" }, { status: 400 });
    }

    const admin = adminClient();
    const uname = username.trim().toLowerCase();
    const newEmail = `${uname}@comunicaedu.app`;

    // Busca o user_id na tabela profiles pelo email
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("user_id")
      .eq("email", currentEmail.toLowerCase())
      .maybeSingle();

    // Se não achou por email, pega o primeiro admin
    let userId = profile?.user_id;
    if (!userId) {
      const { data: roles } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();
      userId = roles?.user_id;
    }

    if (!userId) {
      return NextResponse.json({ error: "Usuário não encontrado. Informe o user_id manualmente." }, { status: 404 });
    }

    // Atualiza o email para username@comunicaedu.app (sem confirmação)
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      email: newEmail,
      email_confirm: true,
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, newEmail });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
