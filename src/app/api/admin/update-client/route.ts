import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  try {
    const user = await resolveApiUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.isAdmin) return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });

    const { clientId, password, username, display_name, email_contato } = await req.json();

    if (!clientId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const admin = user.db;

    const updates: Record<string, string> = {};

    if (password) {
      if (password.length < 4) {
        return NextResponse.json({ error: "Senha muito curta" }, { status: 400 });
      }
      updates.password = password;
    }

    if (username) {
      const newEmail = `${username.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@comunicaedu.app`;
      updates.email = newEmail;

      // Atualiza username na tabela profiles
      await admin
        .from("profiles")
        .update({ username: username.toLowerCase().replace(/[^a-z0-9._-]/g, "") })
        .eq("user_id", clientId);
    }

    // Atualiza campos de perfil (display_name, email_contato) via service role — bypasses RLS
    if (display_name !== undefined || email_contato !== undefined) {
      const profileUpdates: Record<string, string | null> = {};
      if (display_name !== undefined) profileUpdates.display_name = display_name || null;
      if (email_contato !== undefined) profileUpdates.email_contato = email_contato || null;

      // Upsert: garante que o perfil existe mesmo se não tiver sido criado ainda
      const { error: profileErr } = await admin
        .from("profiles")
        .upsert({ user_id: clientId, ...profileUpdates }, { onConflict: "user_id" });

      if (profileErr) {
        return NextResponse.json({ error: profileErr.message }, { status: 500 });
      }
    }

    // Só atualiza auth se houver mudanças de senha/email
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await admin.auth.admin.updateUserById(clientId, updates);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
