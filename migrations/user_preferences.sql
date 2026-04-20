-- Preferências do usuário — tudo identificado por user_id
-- Substitui TODOS os dados que antes ficavam em localStorage
-- Cada usuário tem UMA linha com todas as suas preferências

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  fav_songs        jsonb DEFAULT '[]'::jsonb,         -- IDs de músicas favoritas
  fav_playlists    jsonb DEFAULT '[]'::jsonb,         -- IDs de playlists favoritas
  fav_genres       jsonb DEFAULT '[]'::jsonb,         -- Gêneros favoritos
  hidden_playlists jsonb DEFAULT '[]'::jsonb,         -- IDs de playlists ocultas
  playlist_song_favs jsonb DEFAULT '{}'::jsonb,       -- { playlistId: [songIds] }
  boletins_categories jsonb DEFAULT '[]'::jsonb,      -- Categorias de boletins selecionadas
  news_interval    integer DEFAULT 30,                -- Intervalo de notícias em minutos
  avatar_styles    jsonb DEFAULT '{}'::jsonb,         -- { userId: { zoom, x, y } }
  playlist_cover_styles jsonb DEFAULT '{}'::jsonb,    -- Estilos de capa de playlist
  random_playlists jsonb DEFAULT '[]'::jsonb,         -- IDs de playlists selecionadas para random
  shuffle_history  jsonb DEFAULT '[]'::jsonb,         -- Histórico de shuffle inteligente
  player_state     jsonb DEFAULT '{}'::jsonb,         -- Estado do player (queue, currentIndex, etc.)
  player_controls  jsonb DEFAULT '{}'::jsonb,         -- Controles do player (volume, repeat, shuffle)
  last_section     text DEFAULT 'musicas',            -- Última seção ativa
  last_section_ts  bigint DEFAULT 0,                  -- Timestamp da última seção
  admin_tab        text DEFAULT 'dashboard',          -- Última aba do admin
  admin_tab_ts     bigint DEFAULT 0,                  -- Timestamp da aba admin
  offline_mode     boolean DEFAULT false,             -- Modo offline
  updated_at       timestamptz DEFAULT now()
);

-- RLS — cada usuário vê e edita só as suas preferências
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
  ON user_preferences FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
  ON user_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON user_preferences FOR UPDATE USING (auth.uid() = user_id);
