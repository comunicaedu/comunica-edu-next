import { NextResponse } from "next/server";

// Esta rota não é mais utilizada.
// A fila do embed player é lida via localStorage no cliente (modo espelho)
// ou via /api/embed/playlists (modo independente).
export async function GET() {
  return NextResponse.json({ error: "Rota descontinuada" }, { status: 410 });
}
