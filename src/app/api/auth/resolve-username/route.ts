import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

/**
 * Resolve a username to its Supabase auth email.
 * Tries username@comunicaedu.app first, then searches profiles by email field.
 */
export async function POST(request: Request) {
  try {
    const { username } = await request.json();
    if (!username) {
      return NextResponse.json({ error: "Missing username" }, { status: 400 });
    }

    const admin = adminClient();
    const uname = username.trim().toLowerCase();
    const primaryEmail = `${uname}@comunicaedu.app`;

    // Busca via listUsers pelo email username@comunicaedu.app
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = list?.users?.find((u: any) => u.email === primaryEmail);
    if (found) {
      return NextResponse.json({ email: primaryEmail });
    }

    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
