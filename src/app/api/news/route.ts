import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/news?categories=saude,esportes
 *
 * Retorna as notícias do dia da tabela global `news_items`.
 * Não requer autenticação do usuário — os dados são públicos/compartilhados.
 * Filtra por categoria se o parâmetro `categories` for informado.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const categoriesParam = searchParams.get("categories");
  const categories = categoriesParam
    ? categoriesParam.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  const today = new Date().toISOString().split("T")[0];

  let query = adminClient()
    .from("news_items")
    .select("id, title, file_path, category, fetched_date, created_at")
    .eq("fetched_date", today)
    .order("category", { ascending: true });

  if (categories.length > 0) {
    query = query.in("category", categories);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    artist: null,
    genre: "news",
    file_path: row.file_path,
    cover_url: null,
    created_at: row.created_at,
    category: row.category,
    youtube_video_id: null,
  }));

  return NextResponse.json({ items });
}
