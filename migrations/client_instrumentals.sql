-- Trilhas sonoras customizadas por cliente
-- Cada cliente pode ter até 3 trilhas (uma por categoria)
-- Ao "voltar ao padrão", a linha é deletada e o cliente ouve a trilha do admin

CREATE TABLE IF NOT EXISTS client_instrumentals (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN ('campanha', 'sofisticado', 'animado')),
  storage_path text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, category)
);

-- RLS
ALTER TABLE client_instrumentals ENABLE ROW LEVEL SECURITY;

-- Cliente vê e gerencia só as suas trilhas
CREATE POLICY "Users can view own instrumentals"
  ON client_instrumentals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own instrumentals"
  ON client_instrumentals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own instrumentals"
  ON client_instrumentals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own instrumentals"
  ON client_instrumentals FOR DELETE
  USING (auth.uid() = user_id);

-- Admin (service_role) bypassa RLS automaticamente
