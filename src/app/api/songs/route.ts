import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const DATA_FILE = path.join(process.cwd(), "public", "data", "songs.json");
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "songs");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SB_STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/audio/`;

export interface SongRecord {
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

function resolveFilePath(fp: string): string {
  if (!fp) return fp;
  if (fp.startsWith("/uploads/") || fp.startsWith("youtube:") || fp.startsWith("direct:") || fp.startsWith("http")) return fp;
  // Supabase storage relative path → full URL
  return SB_STORAGE_BASE + fp;
}

async function fetchAllFromSupabase(table: string, sb: any): Promise<any[]> {
  const all: any[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb.from(table).select("*").order("created_at", { ascending: false }).range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function migrateFromSupabase(): Promise<SongRecord[]> {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const data = await fetchAllFromSupabase("songs", sb);
    if (!data || data.length === 0) return [];
    const songs: SongRecord[] = data.map((s: any) => ({
      id: s.id,
      title: s.title,
      artist: s.artist ?? null,
      genre: s.genre ?? null,
      file_path: resolveFilePath(s.file_path ?? ""),
      cover_url: s.cover_url ?? null,
      created_at: s.created_at,
      youtube_video_id: s.youtube_video_id ?? null,
      duration: s.duration ?? null,
    }));
    await mkdir(path.dirname(DATA_FILE), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(songs, null, 2), "utf-8");
    return songs;
  } catch {
    return [];
  }
}

async function readSongs(): Promise<SongRecord[]> {
  try {
    const raw = await readFile(DATA_FILE, "utf-8");
    const songs = JSON.parse(raw) as SongRecord[];
    if (songs.length > 0) return songs;
  } catch {}
  return migrateFromSupabase();
}

async function writeSongs(songs: SongRecord[]): Promise<void> {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(songs, null, 2), "utf-8");
}

export async function GET(req: NextRequest) {
  const songs = await readSongs();
  const genre = req.nextUrl.searchParams.get("genre");
  const search = req.nextUrl.searchParams.get("search");

  let result = songs;
  if (genre) result = result.filter((s) => s.genre === genre);
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.artist ?? "").toLowerCase().includes(q)
    );
  }

  return NextResponse.json({ songs: result });
}

export async function POST(req: NextRequest) {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const title = formData.get("title") as string | null;
      const artist = formData.get("artist") as string | null;
      const genre = formData.get("genre") as string | null;
      const duration = formData.get("duration") as string | null;

      if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

      const ext = file.name.split(".").pop() ?? "mp3";
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const fileName = `${id}.${ext}`;
      const filePath = `/uploads/songs/${fileName}`;
      const fullPath = path.join(UPLOAD_DIR, fileName);

      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(fullPath, buffer);

      const song: SongRecord = {
        id,
        title: title || file.name.replace(/\.[^.]+$/, ""),
        artist: artist || null,
        genre: genre || null,
        file_path: filePath,
        cover_url: null,
        created_at: new Date().toISOString(),
        youtube_video_id: null,
        duration: duration ? Number(duration) : null,
      };

      const songs = await readSongs();
      songs.unshift(song);
      await writeSongs(songs);

      return NextResponse.json({ song });
    } else {
      const body = await req.json();
      const { title, artist, genre, youtube_video_id, file_path, duration } = body;

      if (!title) return NextResponse.json({ error: "Título obrigatório" }, { status: 400 });

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const song: SongRecord = {
        id,
        title,
        artist: artist || null,
        genre: genre || null,
        file_path: file_path || "",
        cover_url: null,
        created_at: new Date().toISOString(),
        youtube_video_id: youtube_video_id || null,
        duration: duration ? Number(duration) : null,
      };

      const songs = await readSongs();
      songs.unshift(song);
      await writeSongs(songs);

      return NextResponse.json({ song });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...patch } = body;
    const songs = await readSongs();
    const song = songs.find((s) => s.id === id);
    if (song) Object.assign(song, patch);
    await writeSongs(songs);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    const songs = await readSongs();
    const song = songs.find((s) => s.id === id);

    if (song?.file_path?.startsWith("/uploads/songs/")) {
      const fullPath = path.join(process.cwd(), "public", song.file_path);
      await unlink(fullPath).catch(() => {});
    }

    await writeSongs(songs.filter((s) => s.id !== id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}
