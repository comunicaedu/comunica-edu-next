import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const DATA_FILE = path.join(process.cwd(), "public", "data", "playlist-songs.json");
const SONGS_FILE = path.join(process.cwd(), "public", "data", "songs.json");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface PlaylistSongRecord {
  id: string;
  playlist_id: string;
  song_id: string;
  position: number;
  created_at: string;
}

interface SongRecord {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  cover_url: string | null;
  created_at: string;
  youtube_video_id: string | null;
  duration: number | null;
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

async function migrateFromSupabase(): Promise<PlaylistSongRecord[]> {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const data = await fetchAllFromSupabase("playlist_songs", sb);
    if (!data || data.length === 0) return [];
    const joins: PlaylistSongRecord[] = data.map((j: any) => ({
      id: j.id,
      playlist_id: j.playlist_id,
      song_id: j.song_id,
      position: j.position ?? 0,
      created_at: j.created_at ?? new Date().toISOString(),
    }));
    await mkdir(path.dirname(DATA_FILE), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(joins, null, 2), "utf-8");
    return joins;
  } catch {
    return [];
  }
}

async function readJoins(): Promise<PlaylistSongRecord[]> {
  try {
    const data = JSON.parse(await readFile(DATA_FILE, "utf-8")) as PlaylistSongRecord[];
    if (data.length > 0) return data;
  } catch {}
  return migrateFromSupabase();
}

async function writeJoins(joins: PlaylistSongRecord[]): Promise<void> {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(joins, null, 2), "utf-8");
}

async function readSongs(): Promise<SongRecord[]> {
  try {
    return JSON.parse(await readFile(SONGS_FILE, "utf-8")) as SongRecord[];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const playlistId = req.nextUrl.searchParams.get("playlist_id");
  const joins = await readJoins();

  if (!playlistId) return NextResponse.json({ joins });

  const songs = await readSongs();
  const songMap = new Map(songs.map((s) => [s.id, s]));

  const result = joins
    .filter((j) => j.playlist_id === playlistId)
    .sort((a, b) => a.position - b.position)
    .map((j) => {
      const song = songMap.get(j.song_id);
      if (!song) return null;
      return { ...song, playlist_song_id: j.id };
    })
    .filter(Boolean);

  return NextResponse.json({ songs: result });
}

export async function POST(req: NextRequest) {
  try {
    const { playlist_id, song_ids } = await req.json();
    if (!playlist_id || !Array.isArray(song_ids)) {
      return NextResponse.json({ error: "playlist_id e song_ids obrigatórios" }, { status: 400 });
    }

    const joins = await readJoins();
    const existing = joins.filter((j) => j.playlist_id === playlist_id);
    const existingIds = new Set(existing.map((j) => j.song_id));
    let maxPos = existing.reduce((m, j) => Math.max(m, j.position), -1);

    const newJoins: PlaylistSongRecord[] = [];
    for (const song_id of song_ids) {
      if (existingIds.has(song_id)) continue;
      maxPos++;
      newJoins.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        playlist_id,
        song_id,
        position: maxPos,
        created_at: new Date().toISOString(),
      });
    }

    await writeJoins([...joins, ...newJoins]);
    return NextResponse.json({ added: newJoins.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    let joins = await readJoins();

    if (body.id) {
      joins = joins.filter((j) => j.id !== body.id);
    } else if (body.playlist_id && body.song_id) {
      joins = joins.filter(
        (j) => !(j.playlist_id === body.playlist_id && j.song_id === body.song_id)
      );
    } else if (body.song_id) {
      joins = joins.filter((j) => j.song_id !== body.song_id);
    } else if (body.playlist_id) {
      joins = joins.filter((j) => j.playlist_id !== body.playlist_id);
    }

    await writeJoins(joins);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}
