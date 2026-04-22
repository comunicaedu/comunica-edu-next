import { NextResponse } from "next/server";
import { verifyEduJwt, type EduJwtPayload } from "./jwt";

export interface AuthedRequestContext {
  userId: string;
  email: string;
  role: "admin" | "client";
  username?: string;
  payload: EduJwtPayload;
}

/**
 * Extrai e valida JWT do header Authorization: Bearer {token}.
 * Retorna o contexto autenticado ou NextResponse 401 se inválido.
 */
export async function requireJwt(req: Request): Promise<AuthedRequestContext | NextResponse> {
  const authHeader = req.headers.get("authorization");

  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "Token ausente" }, { status: 401 });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Token vazio" }, { status: 401 });
  }

  try {
    const payload = await verifyEduJwt(token);
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      username: payload.username,
      payload,
    };
  } catch {
    return NextResponse.json({ error: "Token invalido ou expirado" }, { status: 401 });
  }
}

/**
 * Variante que exige role específico. Retorna 403 se o role não bater.
 */
export async function requireRole(req: Request, allowedRoles: Array<"admin" | "client">): Promise<AuthedRequestContext | NextResponse> {
  const ctx = await requireJwt(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!allowedRoles.includes(ctx.role)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }
  return ctx;
}
