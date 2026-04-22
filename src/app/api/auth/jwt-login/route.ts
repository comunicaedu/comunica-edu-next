import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signEduJwt } from "@/lib/jwt";

export async function POST(req: Request) {
  try {
    const { usuario, senha } = await req.json();

    if (!usuario || !senha || typeof usuario !== "string" || typeof senha !== "string") {
      return NextResponse.json({ error: "Credenciais invalidas" }, { status: 400 });
    }

    // Cliente supabase server-side (sem persistência de sessão)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // Tenta username@comunicaedu.app primeiro
    const email = usuario.includes("@") ? usuario : `${usuario}@comunicaedu.app`;
    let { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });

    // Fallback: tenta o input como email direto
    if (error && !usuario.includes("@")) {
      const fallback = await supabase.auth.signInWithPassword({ email: usuario, password: senha });
      data = fallback.data;
      error = fallback.error;
    }

    if (error || !data?.user) {
      return NextResponse.json({ error: "Usuario ou senha incorretos" }, { status: 401 });
    }

    // Descobrir role no user_roles
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();

    const role: "admin" | "client" = roleRow ? "admin" : "client";

    const token = await signEduJwt({
      sub: data.user.id,
      email: data.user.email ?? "",
      role,
      username: usuario.includes("@") ? undefined : usuario,
    });

    return NextResponse.json({
      token,
      user: {
        id: data.user.id,
        email: data.user.email,
        role,
      },
    });
  } catch (err) {
    console.error("[jwt-login] erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
