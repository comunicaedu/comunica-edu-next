import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const DATA_FILE = path.join(process.cwd(), "public", "data", "playlists.json");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface PlaylistRecord {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  is_global: boolean;
  created_by: string | null;
  youtube_playlist_id: string | null;
  created_at: string;
}

async function fetchAllFromSupabase(table: string, sb: any): Promise<any[]> {
  const all: any[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb.from(table).select("*").range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function migrateFromSupabase(): Promise<PlaylistRecord[]> {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const data = await fetchAllFromSupabase("playlists", sb);
    if (!data || data.length === 0) return [];
    const playlists: PlaylistRecord[] = data.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      cover_url: p.cover_url ?? null,
      is_public: p.is_public ?? true,
      is_global: p.is_global ?? false,
      created_by: p.created_by ?? null,
      youtube_playlist_id: p.youtube_playlist_id ?? null,
      created_at: p.created_at,
    }));
    await mkdir(path.dirname(DATA_FILE), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(playlists, null, 2), "utf-8");
    return playlists;
  } catch {
    return [];
  }
}

async function readPlaylists(): Promise<PlaylistRecord[]> {
  try {
    const raw = await readFile(DATA_FILE, "utf-8");
    const playlists = JSON.parse(raw) as PlaylistRecord[];
    if (playlists.length > 0) return playlists;
  } catch {}
  return migrateFromSupabase();
}

async function writePlaylists(playlists: PlaylistRecord[]): Promise<void> {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(playlists, null, 2), "utf-8");
}

export async function GET() {
  const playlists = await readPlaylists();
  return NextResponse.json({ playlists });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, is_public, cover_url, created_by, is_global, youtube_playlist_id } = body;

    if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const playlist: PlaylistRecord = {
      id,
      name,
      description: description || null,
      cover_url: cover_url || null,
      is_public: is_public ?? true,
      is_global: is_global ?? false,
      created_by: created_by || null,
      youtube_playlist_id: youtube_playlist_id || null,
      created_at: new Date().toISOString(),
    };

    const playlists = await readPlaylists();
    playlists.unshift(playlist);
    await writePlaylists(playlists);

    return NextResponse.json({ playlist });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...patch } = body;
    const playlists = await readPlaylists();
    const pl = playlists.find((p) => p.id === id);
    if (pl) Object.assign(pl, patch);
    await writePlaylists(playlists);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    const playlists = await readPlaylists();
    await writePlaylists(playlists.filter((p) => p.id !== id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}
