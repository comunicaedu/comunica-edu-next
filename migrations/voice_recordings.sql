-- Gravações de voz ao vivo (30s) — cada usuário tem as suas
-- Salvas no Supabase Storage para poder reproduzir, programar ou tocar imediatamente

CREATE TABLE IF NOT EXISTS voice_recordings (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  storage_path text NOT NULL,
  duration     integer DEFAULT 0,
  mime_type    text DEFAULT 'audio/webm',
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_recordings_user_id_idx ON voice_recordings (user_id, created_at DESC);

ALTER TABLE voice_recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vr_select" ON voice_recordings FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "vr_insert" ON voice_recordings FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());

CREATE POLICY "vr_update" ON voice_recordings FOR UPDATE
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "vr_delete" ON voice_recordings FOR DELETE
  USING (user_id = auth.uid() OR is_admin());
