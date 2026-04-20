-- Tabela global de notícias EBC (compartilhada entre todos os usuários)
-- Execute este script no SQL Editor do Supabase (uma única vez)

CREATE TABLE IF NOT EXISTS news_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT        NOT NULL,
  file_path     TEXT        NOT NULL,     -- URL direta do MP3 na EBC
  category      TEXT        NOT NULL,
  fetched_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Garante que não haja duplicatas por data+categoria+título
CREATE UNIQUE INDEX IF NOT EXISTS news_items_date_cat_title_idx
  ON news_items(fetched_date, category, LEFT(title, 80));

-- RLS desabilitado pois a tabela é acessada via service_role_key
-- (sem dados de usuário — é conteúdo público reutilizável)
ALTER TABLE news_items DISABLE ROW LEVEL SECURITY;
