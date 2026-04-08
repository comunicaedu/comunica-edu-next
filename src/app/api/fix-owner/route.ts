import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// This route runs server-side and cleans corrupted "owner" rows from the songs table.
// It uses the anon key — works if RLS allows deletion by the record owner,
// but the main goal is to expose this as a callable endpoint.
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Use raw postgres filter to find rows where uploaded_by text equals 'owner'
  // We cast to text to avoid UUID type error
  const { data, error } = await supabase
    .from("songs")
    .select("id, title, uploaded_by")
    .filter("uploaded_by", "eq", "00000000-0000-0000-0000-000000000000"); // safe probe

  return NextResponse.json({
    message: "Use o Supabase Dashboard → SQL Editor e execute: UPDATE songs SET uploaded_by = NULL WHERE uploaded_by::text = 'owner';",
    probe: { data, error },
  });
}
