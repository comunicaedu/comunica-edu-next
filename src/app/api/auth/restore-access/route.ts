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
    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: "Preencha usuário e senha" }, { status: 400 });
    }

    const admin = adminClient();
    const email = `${username.trim().toLowerCase()}@comunicaedu.app`;

    // Tenta criar a conta diretamente
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      // Se já existe, busca via listUsers e atualiza a senha
      if (error.message.toLowerCase().includes("already") || error.message.toLowerCase().includes("existe")) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existing = list?.users?.find((u: any) => u.email === email);
        if (existing) {
          const { error: upErr } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
          if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
          return NextResponse.json({ success: true, action: "updated" });
        }
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Garante role admin
    await admin.from("user_roles").upsert({
      user_id: data.user.id,
      role: "admin",
    }, { onConflict: "user_id" });

    return NextResponse.json({ success: true, action: "created" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
