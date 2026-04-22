import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";
import { SignJWT } from "jose";

const SECRET_STR = process.env.JWT_SECRET!;
const SECRET = new TextEncoder().encode(SECRET_STR);

export async function POST(req: NextRequest) {
  const admin = await resolveApiUser(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admin.isAdmin) return NextResponse.json({ error: "Forbidden - admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const targetUserId = body?.userId;
  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json({ error: "userId obrigatorio" }, { status: 400 });
  }

  if (targetUserId === admin.userId) {
    return NextResponse.json({ error: "Nao faz sentido impersonar a si mesmo" }, { status: 400 });
  }

  const { data: targetProfile } = await admin.db
    .from("profiles")
    .select("user_id, username")
    .eq("user_id", targetUserId)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: "Usuario alvo nao encontrado" }, { status: 404 });
  }

  const { data: authUser } = await admin.db.auth.admin.getUserById(targetUserId);
  const email = authUser?.user?.email ?? "";

  const { data: targetRoleRow } = await admin.db
    .from("user_roles")
    .select("role")
    .eq("user_id", targetUserId)
    .eq("role", "admin")
    .maybeSingle();

  const targetRole: "admin" | "client" = targetRoleRow ? "admin" : "client";

  const token = await new SignJWT({
    sub: targetUserId,
    email,
    role: targetRole,
    username: targetProfile.username ?? undefined,
    impersonated_by: admin.userId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("comunicaedu")
    .setAudience("comunicaedu-app")
    .setExpirationTime("2h")
    .sign(SECRET);

  return NextResponse.json({
    token,
    user: {
      id: targetUserId,
      email,
      role: targetRole,
      username: targetProfile.username ?? undefined,
    },
  });
}
