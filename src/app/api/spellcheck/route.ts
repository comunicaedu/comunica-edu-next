import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  let text: string;
  try {
    ({ text } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  if (!text?.trim()) return NextResponse.json({ matches: [] });

  try {
    const params = new URLSearchParams({
      text,
      language: "pt-BR",
      enabledOnly: "false",
    });

    const res = await fetch("https://api.languagetool.org/v2/check", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) return NextResponse.json({ matches: [] });

    const data = await res.json();
    return NextResponse.json({ matches: data.matches ?? [] });
  } catch {
    return NextResponse.json({ matches: [] });
  }
}
