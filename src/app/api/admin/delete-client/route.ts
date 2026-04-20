import { NextRequest, NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  try {
    const user = await resolveApiUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.isAdmin) return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });

    const { clientId } = await req.json();
    if (!clientId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const admin = user.db;

    // Não permite deletar a si mesmo
    if (user.userId === clientId) {
      return NextResponse.json({ error: "Não é possível excluir sua própria conta" }, { status: 400 });
    }

    const { error } = await admin.auth.admin.deleteUser(clientId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
