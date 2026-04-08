import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import path from "path";

const DB_FILE = path.join(process.cwd(), "public", "uploads", "spots", "_spots.json");
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "spots");

async function readSpots() {
  try {
    const raw = await readFile(DB_FILE, "utf-8");
    return JSON.parse(raw) as SpotRecord[];
  } catch {
    return [];
  }
}

async function writeSpots(spots: SpotRecord[]) {
  await writeFile(DB_FILE, JSON.stringify(spots, null, 2), "utf-8");
}

interface SpotRecord {
  id: string;
  title: string;
  file_path: string;
  created_at: string;
}

// GET — list spots
export async function GET() {
  const spots = await readSpots();
  return NextResponse.json({ spots });
}

// POST — upload spot
export async function POST(req: NextRequest) {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string | null;

    if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

    const ext = file.name.split(".").pop() ?? "mp3";
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fileName = `${id}.${ext}`;
    const filePath = `/uploads/spots/${fileName}`;
    const fullPath = path.join(UPLOAD_DIR, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, buffer);

    const spot: SpotRecord = {
      id,
      title: title || file.name.replace(/\.[^.]+$/, ""),
      file_path: filePath,
      created_at: new Date().toISOString(),
    };

    const spots = await readSpots();
    spots.unshift(spot);
    await writeSpots(spots);

    return NextResponse.json({ spot });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

// DELETE — remove spot
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    const spots = await readSpots();
    const spot = spots.find((s) => s.id === id);

    if (spot) {
      const fullPath = path.join(process.cwd(), "public", spot.file_path);
      await unlink(fullPath).catch(() => {});
    }

    const updated = spots.filter((s) => s.id !== id);
    await writeSpots(updated);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}

// PATCH — rename spot
export async function PATCH(req: NextRequest) {
  try {
    const { id, title } = await req.json();
    const spots = await readSpots();
    const spot = spots.find((s) => s.id === id);
    if (spot) spot.title = title;
    await writeSpots(spots);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
  }
}
