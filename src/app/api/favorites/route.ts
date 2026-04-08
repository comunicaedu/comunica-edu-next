import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const FAV_FILE = path.join(DATA_DIR, "user-favorites.json");

interface FavEntry { song_id: string; favorited_at: string; }
type FavStore = Record<string, FavEntry[]>;

async function readFavs(): Promise<FavStore> {
  try { return JSON.parse(await readFile(FAV_FILE, "utf-8")); } catch { return {}; }
}
async function writeFavs(data: FavStore) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FAV_FILE, JSON.stringify(data), "utf-8");
}

// GET /api/favorites?user_id=xxx
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("user_id");
  if (!userId) return NextResponse.json({ favorites: [] });
  const favs = await readFavs();
  return NextResponse.json({ favorites: favs[userId] ?? [] });
}

// POST /api/favorites — adiciona ou remove favorito
// body: { user_id, song_id, action: "add"|"remove" }
export async function POST(req: NextRequest) {
  const { user_id, song_id, action } = await req.json();
  if (!user_id || !song_id) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const favs = await readFavs();
  if (!favs[user_id]) favs[user_id] = [];

  if (action === "remove") {
    favs[user_id] = favs[user_id].filter((f) => f.song_id !== song_id);
  } else {
    // add — evita duplicata
    if (!favs[user_id].find((f) => f.song_id === song_id)) {
      favs[user_id].push({ song_id, favorited_at: new Date().toISOString() });
    }
  }

  await writeFavs(favs);
  return NextResponse.json({ ok: true });
}
