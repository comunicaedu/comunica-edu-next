-- Itens ocultados pelo cliente (playlists e músicas)
-- Cliente NUNCA deleta — apenas oculta com seu user_id
-- Admin pode ver tudo

CREATE TABLE IF NOT EXISTS user_hidden_items (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_type  text NOT NULL CHECK (item_type IN ('playlist', 'song')),
  item_id    uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, item_type, item_id)
);

ALTER TABLE user_hidden_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uhi_select" ON user_hidden_items FOR SELECT
  USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "uhi_insert" ON user_hidden_items FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());
CREATE POLICY "uhi_delete" ON user_hidden_items FOR DELETE
  USING (user_id = auth.uid() OR is_admin());
