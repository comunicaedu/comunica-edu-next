-- ============================================================
-- FIXES 2026-04-16 — auditoria de conformidade (v2)
-- 0. colunas faltantes em songs / playlists
-- 1. spots.type (distinguir MP3 x IA)
-- 2. songs.youtube_video_id UNIQUE (deduplicação no banco)
-- 3. playlists RLS — playlists públicas visíveis a todos
-- 4. playlists UNIQUE (created_by, lower(name)) — sem duplicata por usuário
-- ============================================================

-- ------------------------------------------------------------
-- 0. COLUNAS FALTANTES (garantir que existem antes dos índices)
-- ------------------------------------------------------------
ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS youtube_video_id TEXT;

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id);

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS artist TEXT;

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS duration INTEGER;

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;

-- ------------------------------------------------------------
-- 1. SPOTS: coluna type = 'mp3' | 'ia'
-- ------------------------------------------------------------
ALTER TABLE spots
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'mp3';

ALTER TABLE spots
  DROP CONSTRAINT IF EXISTS spots_type_check;

ALTER TABLE spots
  ADD CONSTRAINT spots_type_check
  CHECK (type IN ('mp3', 'ia'));

CREATE INDEX IF NOT EXISTS idx_spots_type ON spots(type);

-- ------------------------------------------------------------
-- 2. SONGS: UNIQUE parcial para youtube_video_id
--    (partial index permite múltiplos NULL e garante 1 única por video_id)
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS songs_youtube_video_id_unique
  ON songs(youtube_video_id)
  WHERE youtube_video_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. PLAYLISTS: SELECT permite ver públicas de outros usuários
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "playlists_select" ON playlists;
CREATE POLICY "playlists_select" ON playlists FOR SELECT
  USING (
    created_by = auth.uid()
    OR is_public = true
    OR is_admin()
  );

-- PLAYLIST_SONGS: SELECT segue a visibilidade da playlist-pai
DROP POLICY IF EXISTS "playlist_songs_select" ON playlist_songs;
CREATE POLICY "playlist_songs_select" ON playlist_songs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM playlists p
      WHERE p.id = playlist_songs.playlist_id
        AND (p.created_by = auth.uid() OR p.is_public = true OR is_admin())
    )
  );

-- ------------------------------------------------------------
-- 4. PLAYLISTS: UNIQUE(created_by, lower(name))
--    Um usuário não cria duas playlists com o mesmo nome (case-insensitive).
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS playlists_owner_name_unique
  ON playlists(created_by, lower(name));
