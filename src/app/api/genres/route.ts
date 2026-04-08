import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const DATA_FILE = path.join(process.cwd(), "public", "data", "genres.json");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface GenreRecord {
  id: string;
  name: string;
  display_name: string;
  created_at: string;
}

async function migrateFromSupabase(): Promise<GenreRecord[]> {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await sb.from("genre_standards").select("id, name, display_name, created_at").eq("is_active", true);
    if (!data || data.length === 0) return [];
    const genres: GenreRecord[] = data.map((g: any) => ({
      id: g.id,
      name: g.name,
      display_name: g.display_name ?? g.name,
      created_at: g.created_at ?? new Date().toISOString(),
    }));
    await mkdir(path.dirname(DATA_FILE), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(genres, null, 2), "utf-8");
    return genres;
  } catch {
    return [];
  }
}

async function readGenres(): Promise<GenreRecord[]> {
  try {
    const raw = await readFile(DATA_FILE, "utf-8");
    const genres = JSON.parse(raw) as GenreRecord[];
    if (genres.length > 0) return genres;
  } catch {}
  return migrateFromSupabase();
}

async function writeGenres(genres: GenreRecord[]): Promise<void> {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(genres, null, 2), "utf-8");
}

export async function GET() {
  const genres = await readGenres();
  return NextResponse.json({ genres });
}

export async function POST(req: NextRequest) {
  try {
    const { name, display_name } = await req.json();
    if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const genre: GenreRecord = {
      id,
      name: name.toLowerCase().trim(),
      display_name: display_name || name,
      created_at: new Date().toISOString(),
    };

    const genres = await readGenres();
    if (genres.some((g) => g.name === genre.name)) {
      return NextResponse.json({ error: "Género já existe" }, { status: 409 });
    }
    genres.push(genre);
    await writeGenres(genres);

    return NextResponse.json({ genre });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    const genres = await readGenres();
    await writeGenres(genres.filter((g) => g.id !== id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}
