import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/boletins
 *
 * Busca boletins de áudio da Radioagência Nacional (EBC) por categoria,
 * extrai links MP3 e salva na tabela GLOBAL `news_items` (compartilhada entre
 * todos os usuários — sem user_id). O sistema só baixa uma vez por dia por
 * categoria; chamadas subsequentes retornam o cache do banco.
 *
 * SQL necessário (rode no Supabase uma vez):
 *   CREATE TABLE IF NOT EXISTS news_items (
 *     id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
 *     title       TEXT        NOT NULL,
 *     file_path   TEXT        NOT NULL,
 *     category    TEXT        NOT NULL,
 *     fetched_date DATE       NOT NULL DEFAULT CURRENT_DATE,
 *     created_at  TIMESTAMPTZ DEFAULT NOW()
 *   );
 *   CREATE UNIQUE INDEX IF NOT EXISTS news_items_date_cat_title_idx
 *     ON news_items(fetched_date, category, LEFT(title, 80));
 *
 * EBC disponibiliza conteúdo de rádio gratuitamente:
 * "Reprodução autorizada mediante indicação da fonte."
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function resolveUser(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return null;
  const { data: { user }, error } = await adminClient().auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// Mapeia categoria → URL da página da Radioagência Nacional
const EBC_CATEGORY_URLS: Record<string, string> = {
  "saude":            "https://agenciabrasil.ebc.com.br/radioagencia-nacional/saude",
  "esportes":         "https://agenciabrasil.ebc.com.br/radioagencia-nacional/esportes",
  "cultura":          "https://agenciabrasil.ebc.com.br/radioagencia-nacional/cultura",
  "educacao":         "https://agenciabrasil.ebc.com.br/radioagencia-nacional/educacao",
  "economia":         "https://agenciabrasil.ebc.com.br/radioagencia-nacional/economia",
  "meio-ambiente":    "https://agenciabrasil.ebc.com.br/radioagencia-nacional/meio-ambiente",
  "inovacao":         "https://agenciabrasil.ebc.com.br/radioagencia-nacional/inovacao",
  "direitos-humanos": "https://agenciabrasil.ebc.com.br/radioagencia-nacional/direitos-humanos",
  "geral":            "https://agenciabrasil.ebc.com.br/radioagencia-nacional/geral",
};

// Label amigável para o nome padronizado
const EBC_CATEGORY_LABELS: Record<string, string> = {
  "saude":            "Saúde",
  "esportes":         "Esportes",
  "cultura":          "Cultura",
  "educacao":         "Educação",
  "economia":         "Economia",
  "meio-ambiente":    "Meio Ambiente",
  "inovacao":         "Inovação",
  "direitos-humanos": "Direitos Humanos",
  "geral":            "Notícias",
};

interface EBCItem {
  title: string;
  audioUrl: string;
  category: string;
}

async function fetchEBCCategory(category: string): Promise<EBCItem[]> {
  const pageUrl = EBC_CATEGORY_URLS[category];
  if (!pageUrl) return [];

  try {
    const res = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ComunicaEDU/1.0; Radio player)",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const items: EBCItem[] = [];
    const seenUrls = new Set<string>();

    // Padrão 1: links de download direto (.mp3)
    const mp3Regex = /href="(https?:\/\/[^"]*\.mp3[^"]*)"/gi;
    const titleBlockRegex = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;

    const titles: string[] = [];
    let titleMatch;
    while ((titleMatch = titleBlockRegex.exec(html)) !== null) {
      const clean = titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (clean.length > 5 && clean.length < 200) titles.push(clean);
    }

    let mp3Match;
    let idx = 0;
    while ((mp3Match = mp3Regex.exec(html)) !== null) {
      const url = mp3Match[1].split('"')[0].trim();
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const label = EBC_CATEGORY_LABELS[category] ?? category;
      const rawTitle = titles[idx] ?? "";
      // Nome padronizado: "Notícia [Categoria]" (sem duplicar o label)
      const title = rawTitle.length > 5
        ? `Notícia ${label} — ${rawTitle.substring(0, 80)}`
        : `Notícia ${label}`;

      items.push({ title: title.substring(0, 120), audioUrl: url, category });
      idx++;
      if (items.length >= 5) break;
    }

    // Padrão 2: data-src / data-file em players embutidos
    if (items.length === 0) {
      const dataSrcRegex = /data-(?:src|file)="(https?:\/\/[^"]*\.mp3[^"]*)"/gi;
      let dsMatch;
      let dsIdx = 0;
      while ((dsMatch = dataSrcRegex.exec(html)) !== null) {
        const url = dsMatch[1].trim();
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        const label = EBC_CATEGORY_LABELS[category] ?? category;
        items.push({ title: `Notícia ${label}`, audioUrl: url, category });
        dsIdx++;
        if (items.length >= 5) break;
      }
    }

    return items;
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { categories } = await req.json() as { categories: string[] };
  if (!categories?.length) {
    return NextResponse.json({ error: "categories obrigatório" }, { status: 400 });
  }

  const db = adminClient();
  const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"

  // 1. Limpa notícias mais antigas que 24h
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  await db.from("news_items").delete().lt("fetched_date", yesterday);

  let added = 0;
  let skipped = 0;

  for (const category of categories) {
    // 2. Verifica se já existe notícia desta categoria para hoje
    const { data: existing, error: checkErr } = await db
      .from("news_items")
      .select("id")
      .eq("fetched_date", today)
      .eq("category", category)
      .limit(1);

    if (!checkErr && existing && existing.length > 0) {
      skipped++;
      continue; // já tem notícia de hoje para esta categoria
    }

    // 3. Busca da EBC
    const items = await fetchEBCCategory(category);

    for (const item of items) {
      if (!item.audioUrl) continue;

      const { error } = await db.from("news_items").insert({
        title: item.title,
        file_path: item.audioUrl,
        category: item.category,
        fetched_date: today,
      });

      if (!error) added++;
    }
  }

  return NextResponse.json({ added, skipped, total: categories.length });
}
