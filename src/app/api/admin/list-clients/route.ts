import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  try {
    const user = await resolveApiUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.isAdmin) return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });

    const admin = user.db;

    // Lista todos os usuários auth
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    const userIds = usersData.users.map((u) => u.id);

    // Busca profiles
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, display_name, username, avatar_url, created_at, email_contato")
      .in("user_id", userIds);

    // Busca features
    const { data: features } = await admin
      .from("client_features")
      .select("user_id, feature_key, enabled, limit_value")
      .in("user_id", userIds);

    // Busca roles (para identificar admins no frontend)
    const { data: roles } = await admin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds);

    const profileMap: Record<string, any> = {};
    profiles?.forEach((p) => { profileMap[p.user_id] = p; });

    const clients = usersData.users.map((u) => {
      const p = profileMap[u.id] || {};
      return {
        id: u.id,
        user_id: u.id,
        nome: p.display_name || null,
        email: u.email || null,
        email_contato: p.email_contato || null,
        telefone: null,
        status: "ativo",
        blocked_at: null,
        created_at: p.created_at || u.created_at,
        avatar_url: p.avatar_url || null,
        cidade: null,
        username: p.username || u.email?.replace("@comunicaedu.app", "") || null,
        last_seen: null,
      };
    });

    return NextResponse.json({ clients, roles: roles || [], features: features || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
