import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

/**
 * Garante que o usuário autenticado tem role "admin" em user_roles.
 * Lógica: se não há NENHUM admin cadastrado, o primeiro usuário autenticado
 * que chamar este endpoint vira admin automaticamente.
 * Se já há admins, verifica se este usuário é um deles.
 */
export async function POST(request: Request) {
  try {
    const { accessToken } = await request.json();
    if (!accessToken) {
      return NextResponse.json({ isAdmin: false, error: "Missing token" }, { status: 400 });
    }

    const admin = adminClient();

    // Verifica o caller
    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ isAdmin: false }, { status: 401 });
    }

    // Verifica se este usuário já é admin
    const { data: existingRole } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (existingRole) {
      return NextResponse.json({ isAdmin: true });
    }

    // Verifica se há algum admin no sistema
    const { data: anyAdmin } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();

    if (!anyAdmin) {
      // Nenhum admin existe — este usuário é o proprietário do sistema
      await admin.from("user_roles").upsert(
        { user_id: user.id, role: "admin" },
        { onConflict: "user_id" }
      );
      return NextResponse.json({ isAdmin: true, initialized: true });
    }

    // Há admins mas este usuário não é um deles — é cliente
    return NextResponse.json({ isAdmin: false });
  } catch (e: any) {
    return NextResponse.json({ isAdmin: false, error: e?.message }, { status: 500 });
  }
}
