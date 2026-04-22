import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyEduJwt } from "./jwt";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface ResolvedUser {
  userId: string;
  isAdmin: boolean;
  db: ReturnType<typeof adminClient>;
}

export async function resolveApiUser(req: NextRequest): Promise<ResolvedUser | null> {
  const token =
    req.headers.get("authorization")?.replace("Bearer ", "") ||
    null;

  if (!token) return null;

  // Tenta primeiro validar como JWT próprio (issuer comunicaedu)
  try {
    const payload = await verifyEduJwt(token);
    return {
      userId: payload.sub,
      isAdmin: payload.role === "admin",
      db: adminClient(),
    };
  } catch {
    // Não é JWT nosso (ou expirado). Segue para validação Supabase.
  }

  // Fallback: valida como token Supabase
  const db = adminClient();

  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return null;

  // Verifica role admin
  const { data: roleRow } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  return {
    userId: user.id,
    isAdmin: !!roleRow,
    db,
  };
}

export function effectiveUserId(user: ResolvedUser, targetUserId?: string | null): string {
  if (user.isAdmin && targetUserId) return targetUserId;
  return user.userId;
}
