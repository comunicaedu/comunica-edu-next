import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Helper centralizado de autenticação para TODAS as APIs.
 *
 * Regras:
 * 1. Extrai user_id do Bearer token — NUNCA confia no user_id do body/query
 * 2. Verifica se o usuário é admin via user_roles
 * 3. Retorna { userId, isAdmin } ou null se não autenticado
 */

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

/**
 * Resolve o usuário autenticado a partir do Bearer token.
 * Retorna null se não autenticado.
 *
 * Uso:
 *   const user = await resolveApiUser(req);
 *   if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   // user.userId = ID do usuário autenticado (do token)
 *   // user.isAdmin = true se tem role admin
 *   // user.db = cliente Supabase com service_role
 */
export async function resolveApiUser(req: NextRequest): Promise<ResolvedUser | null> {
  const token =
    req.headers.get("authorization")?.replace("Bearer ", "") ||
    null;

  if (!token) return null;

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

/**
 * Determina o user_id efetivo para queries.
 * - Se admin e targetUserId fornecido → usa targetUserId (admin pode ver dados de qualquer cliente)
 * - Se cliente → SEMPRE usa seu próprio userId (ignora qualquer targetUserId)
 */
export function effectiveUserId(user: ResolvedUser, targetUserId?: string | null): string {
  if (user.isAdmin && targetUserId) return targetUserId;
  return user.userId;
}
