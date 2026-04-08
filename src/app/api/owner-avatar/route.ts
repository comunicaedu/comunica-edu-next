import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const CACHE_PATH = path.join(process.cwd(), ".owner-avatar-cache.json");

function readCache(): string | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const json = JSON.parse(raw);
    return json?.avatar_url ?? null;
  } catch {
    return null;
  }
}

function writeCache(avatar_url: string) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ avatar_url }), "utf-8");
  } catch {}
}

// GET — retorna o avatar do proprietário sem exigir login
export async function GET() {
  // 1. Tenta o cache local primeiro (mais rápido)
  const cached = readCache();
  if (cached) {
    return NextResponse.json({ avatar_url: cached });
  }

  // 2. Busca do Supabase via tabela theme_settings (acessível sem login)
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data } = await supabase
      .from("theme_settings")
      .select("colors")
      .eq("key", "site-avatar")
      .single();

    const avatarUrl = (data?.colors as Record<string, string> | null)?.avatar_url ?? null;

    if (avatarUrl) {
      writeCache(avatarUrl);
      return NextResponse.json({ avatar_url: avatarUrl });
    }
  } catch {}

  return NextResponse.json({ avatar_url: null });
}

// POST — atualiza o cache local quando o dono muda o avatar
export async function POST(request: Request) {
  try {
    const { avatar_url } = await request.json();
    if (typeof avatar_url === "string" && avatar_url.startsWith("http")) {
      writeCache(avatar_url);
    }
  } catch {}
  return NextResponse.json({ ok: true });
}
