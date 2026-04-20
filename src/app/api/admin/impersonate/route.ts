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

    // Busca dados do cliente
    const { data: { user: clientUser }, error: userError } = await admin.auth.admin.getUserById(clientId);
    if (userError || !clientUser?.email) {
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
    }

    // Gera magic link sem enviar email
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: clientUser.email,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      return NextResponse.json({ error: linkError?.message || "Erro ao gerar token" }, { status: 500 });
    }

    // Extrai username do email (usuario@comunicaedu.app → usuario)
    const username = clientUser.email.replace("@comunicaedu.app", "");

    return NextResponse.json({
      hashedToken: linkData.properties.hashed_token,
      email: clientUser.email,
      username,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
