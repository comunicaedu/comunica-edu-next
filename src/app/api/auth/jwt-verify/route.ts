import { NextResponse } from "next/server";
import { requireJwt } from "@/lib/auth-jwt-helper";

export async function GET(req: Request) {
  const ctx = await requireJwt(req);
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json({
    valid: true,
    user: {
      id: ctx.userId,
      email: ctx.email,
      role: ctx.role,
      username: ctx.username,
    },
  });
}
