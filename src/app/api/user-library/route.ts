import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const HIDDEN_FILE = path.join(DATA_DIR, "user-hidden.json");
const OVERRIDES_FILE = path.join(DATA_DIR, "user-overrides.json");

type HiddenStore = Record<string, { playlist_ids: string[]; song_ids: string[] }>;
type OverridesStore = Record<string, Record<string, { name?: string; cover?: string }>>;

async function readHidden(): Promise<HiddenStore> {
  try { return JSON.parse(await readFile(HIDDEN_FILE, "utf-8")); } catch { return {}; }
}
async function writeHidden(data: HiddenStore) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(HIDDEN_FILE, JSON.stringify(data), "utf-8");
}
async function readOverrides(): Promise<OverridesStore> {
  try { return JSON.parse(await readFile(OVERRIDES_FILE, "utf-8")); } catch { return {}; }
}
async function writeOverrides(data: OverridesStore) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(OVERRIDES_FILE, JSON.stringify(data), "utf-8");
}

// GET /api/user-library?user_id=xxx
// Retorna quais playlist_ids e song_ids estão ocultos + overrides do usuário
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("user_id");
  if (!userId) return NextResponse.json({ hidden: { playlist_ids: [], song_ids: [] }, overrides: {} });

  const hidden = await readHidden();
  const overrides = await readOverrides();

  return NextResponse.json({
    hidden: hidden[userId] ?? { playlist_ids: [], song_ids: [] },
    overrides: overrides[userId] ?? {},
  });
}

// POST /api/user-library
// body: { user_id, action: "hide_playlist"|"show_playlist"|"hide_song"|"show_song"|"override_playlist", ... }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user_id, action } = body;
  if (!user_id || !action) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  if (action === "hide_playlist" || action === "show_playlist") {
    const hidden = await readHidden();
    if (!hidden[user_id]) hidden[user_id] = { playlist_ids: [], song_ids: [] };
    const ids = new Set(hidden[user_id].playlist_ids);
    if (action === "hide_playlist") ids.add(body.playlist_id);
    else ids.delete(body.playlist_id);
    hidden[user_id].playlist_ids = [...ids];
    await writeHidden(hidden);
    return NextResponse.json({ ok: true });
  }

  if (action === "hide_song" || action === "show_song") {
    const hidden = await readHidden();
    if (!hidden[user_id]) hidden[user_id] = { playlist_ids: [], song_ids: [] };
    const ids = new Set(hidden[user_id].song_ids);
    if (action === "hide_song") ids.add(body.song_id);
    else ids.delete(body.song_id);
    hidden[user_id].song_ids = [...ids];
    await writeHidden(hidden);
    return NextResponse.json({ ok: true });
  }

  if (action === "override_playlist") {
    const overrides = await readOverrides();
    if (!overrides[user_id]) overrides[user_id] = {};
    if (!overrides[user_id][body.playlist_id]) overrides[user_id][body.playlist_id] = {};
    if (body.name !== undefined) overrides[user_id][body.playlist_id].name = body.name;
    if (body.cover !== undefined) overrides[user_id][body.playlist_id].cover = body.cover;
    await writeOverrides(overrides);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
