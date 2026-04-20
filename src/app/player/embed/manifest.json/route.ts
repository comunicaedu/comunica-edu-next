import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client") ?? "";

  const manifest = {
    name: "ComunicaEDU Player",
    short_name: "EDU Player",
    description: "Player de rádio flutuante",
    start_url: `/player/embed?client=${client}`,
    scope: "/player/embed",
    display: "standalone",
    background_color: "#0f1117",
    theme_color: "#0f1117",
    orientation: "any",
    icons: [
      { src: "/edu-logo-icon.png", sizes: "any", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };

  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
