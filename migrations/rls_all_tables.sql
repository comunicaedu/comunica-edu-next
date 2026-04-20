-- ============================================================
-- RLS (Row Level Security) — TODAS as tabelas
-- Regra: cada cliente só vê/edita SEUS dados.
-- Admin (user_roles.role = 'admin') vê/edita TUDO.
-- ============================================================

-- Helper: verifica se o usuário é admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- PLAYLISTS — cada cliente só vê as suas
-- ============================================================
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playlists_select" ON playlists;
CREATE POLICY "playlists_select" ON playlists FOR SELECT
  USING (created_by = auth.uid() OR is_public IS DISTINCT FROM false OR is_admin());

DROP POLICY IF EXISTS "playlists_insert" ON playlists;
CREATE POLICY "playlists_insert" ON playlists FOR INSERT
  WITH CHECK (created_by = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "playlists_update" ON playlists;
CREATE POLICY "playlists_update" ON playlists FOR UPDATE
  USING (created_by = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "playlists_delete" ON playlists;
CREATE POLICY "playlists_delete" ON playlists FOR DELETE
  USING (created_by = auth.uid() OR is_admin());

-- ============================================================
-- PLAYLIST_SONGS — segue o dono da playlist
-- ============================================================
ALTER TABLE playlist_songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playlist_songs_select" ON playlist_songs;
CREATE POLICY "playlist_songs_select" ON playlist_songs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_songs.playlist_id AND (created_by = auth.uid() OR is_public IS DISTINCT FROM false OR is_admin()))
  );

DROP POLICY IF EXISTS "playlist_songs_insert" ON playlist_songs;
CREATE POLICY "playlist_songs_insert" ON playlist_songs FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_songs.playlist_id AND (created_by = auth.uid() OR is_admin()))
  );

DROP POLICY IF EXISTS "playlist_songs_update" ON playlist_songs;
CREATE POLICY "playlist_songs_update" ON playlist_songs FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_songs.playlist_id AND (created_by = auth.uid() OR is_admin()))
  );

DROP POLICY IF EXISTS "playlist_songs_delete" ON playlist_songs;
CREATE POLICY "playlist_songs_delete" ON playlist_songs FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_songs.playlist_id AND (created_by = auth.uid() OR is_admin()))
  );

-- ============================================================
-- SONGS — se tem uploaded_by, só o dono edita/deleta. Todos podem ler.
-- ============================================================
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "songs_select" ON songs;
CREATE POLICY "songs_select" ON songs FOR SELECT
  USING (true); -- catálogo compartilhado, todos leem

DROP POLICY IF EXISTS "songs_insert" ON songs;
CREATE POLICY "songs_insert" ON songs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL); -- qualquer autenticado pode fazer upload

DROP POLICY IF EXISTS "songs_update" ON songs;
CREATE POLICY "songs_update" ON songs FOR UPDATE
  USING (uploaded_by = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "songs_delete" ON songs;
CREATE POLICY "songs_delete" ON songs FOR DELETE
  USING (uploaded_by = auth.uid() OR is_admin());

-- ============================================================
-- SPOTS — cada cliente só vê os seus
-- ============================================================
ALTER TABLE spots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spots_select" ON spots;
CREATE POLICY "spots_select" ON spots FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "spots_insert" ON spots;
CREATE POLICY "spots_insert" ON spots FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "spots_update" ON spots;
CREATE POLICY "spots_update" ON spots FOR UPDATE
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "spots_delete" ON spots;
CREATE POLICY "spots_delete" ON spots FOR DELETE
  USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- SPOT_CONFIGS — cada cliente só vê as suas
-- ============================================================
ALTER TABLE spot_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spot_configs_select" ON spot_configs;
CREATE POLICY "spot_configs_select" ON spot_configs FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "spot_configs_insert" ON spot_configs;
CREATE POLICY "spot_configs_insert" ON spot_configs FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "spot_configs_update" ON spot_configs;
CREATE POLICY "spot_configs_update" ON spot_configs FOR UPDATE
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "spot_configs_delete" ON spot_configs;
CREATE POLICY "spot_configs_delete" ON spot_configs FOR DELETE
  USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- SPOT_SETTINGS — cada cliente só vê as suas
-- ============================================================
ALTER TABLE spot_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spot_settings_select" ON spot_settings;
CREATE POLICY "spot_settings_select" ON spot_settings FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "spot_settings_insert" ON spot_settings;
CREATE POLICY "spot_settings_insert" ON spot_settings FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "spot_settings_update" ON spot_settings;
CREATE POLICY "spot_settings_update" ON spot_settings FOR UPDATE
  USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- RADIO_STATE — cada cliente só vê o seu
-- ============================================================
ALTER TABLE radio_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "radio_state_select" ON radio_state;
CREATE POLICY "radio_state_select" ON radio_state FOR SELECT
  USING (owner_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "radio_state_insert" ON radio_state;
CREATE POLICY "radio_state_insert" ON radio_state FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "radio_state_update" ON radio_state;
CREATE POLICY "radio_state_update" ON radio_state FOR UPDATE
  USING (owner_id = auth.uid() OR is_admin());

-- ============================================================
-- RADIO_QUEUE — cada cliente só vê a sua fila
-- ============================================================
ALTER TABLE radio_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "radio_queue_select" ON radio_queue;
CREATE POLICY "radio_queue_select" ON radio_queue FOR SELECT
  USING (owner_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "radio_queue_insert" ON radio_queue;
CREATE POLICY "radio_queue_insert" ON radio_queue FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "radio_queue_update" ON radio_queue;
CREATE POLICY "radio_queue_update" ON radio_queue FOR UPDATE
  USING (owner_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "radio_queue_delete" ON radio_queue;
CREATE POLICY "radio_queue_delete" ON radio_queue FOR DELETE
  USING (owner_id = auth.uid() OR is_admin());

-- ============================================================
-- PROFILES — cada um vê o seu, admin vê todos
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- CLIENT_FEATURES — cada cliente vê as suas, admin vê todas
-- ============================================================
ALTER TABLE client_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_features_select" ON client_features;
CREATE POLICY "client_features_select" ON client_features FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "client_features_insert" ON client_features;
CREATE POLICY "client_features_insert" ON client_features FOR INSERT
  WITH CHECK (is_admin()); -- só admin cria features para clientes

DROP POLICY IF EXISTS "client_features_update" ON client_features;
CREATE POLICY "client_features_update" ON client_features FOR UPDATE
  USING (is_admin()); -- só admin altera features

DROP POLICY IF EXISTS "client_features_delete" ON client_features;
CREATE POLICY "client_features_delete" ON client_features FOR DELETE
  USING (is_admin()); -- só admin deleta features

-- ============================================================
-- USER_FAVORITES — cada cliente só vê os seus
-- ============================================================
ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_favorites_select" ON user_favorites;
CREATE POLICY "user_favorites_select" ON user_favorites FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "user_favorites_insert" ON user_favorites;
CREATE POLICY "user_favorites_insert" ON user_favorites FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "user_favorites_delete" ON user_favorites;
CREATE POLICY "user_favorites_delete" ON user_favorites FOR DELETE
  USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- LOCUTOR_USAGE — cada cliente só vê o seu uso
-- ============================================================
ALTER TABLE locutor_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "locutor_usage_select" ON locutor_usage;
CREATE POLICY "locutor_usage_select" ON locutor_usage FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "locutor_usage_insert" ON locutor_usage;
CREATE POLICY "locutor_usage_insert" ON locutor_usage FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "locutor_usage_update" ON locutor_usage;
CREATE POLICY "locutor_usage_update" ON locutor_usage FOR UPDATE
  USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- PLAYLIST_SCHEDULES — segue o dono da playlist
-- ============================================================
ALTER TABLE playlist_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "playlist_schedules_select" ON playlist_schedules;
CREATE POLICY "playlist_schedules_select" ON playlist_schedules FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_schedules.playlist_id AND (created_by = auth.uid() OR is_admin()))
  );

DROP POLICY IF EXISTS "playlist_schedules_insert" ON playlist_schedules;
CREATE POLICY "playlist_schedules_insert" ON playlist_schedules FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_schedules.playlist_id AND (created_by = auth.uid() OR is_admin()))
  );

DROP POLICY IF EXISTS "playlist_schedules_update" ON playlist_schedules;
CREATE POLICY "playlist_schedules_update" ON playlist_schedules FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_schedules.playlist_id AND (created_by = auth.uid() OR is_admin()))
  );

DROP POLICY IF EXISTS "playlist_schedules_delete" ON playlist_schedules;
CREATE POLICY "playlist_schedules_delete" ON playlist_schedules FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_schedules.playlist_id AND (created_by = auth.uid() OR is_admin()))
  );

-- ============================================================
-- USER_ACTIVITY — cada cliente só vê a sua atividade
-- ============================================================
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_activity_select" ON user_activity;
CREATE POLICY "user_activity_select" ON user_activity FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "user_activity_insert" ON user_activity;
CREATE POLICY "user_activity_insert" ON user_activity FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- SMART_PLAYLISTS — cada cliente só vê as suas
-- ============================================================
ALTER TABLE smart_playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_playlists_select" ON smart_playlists;
CREATE POLICY "smart_playlists_select" ON smart_playlists FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "smart_playlists_insert" ON smart_playlists;
CREATE POLICY "smart_playlists_insert" ON smart_playlists FOR INSERT
  WITH CHECK (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "smart_playlists_delete" ON smart_playlists;
CREATE POLICY "smart_playlists_delete" ON smart_playlists FOR DELETE
  USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- USER_ROLES — cada um vê o seu, admin vê todos
-- ============================================================
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_select" ON user_roles;
CREATE POLICY "user_roles_select" ON user_roles FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

-- ============================================================
-- THEME_SETTINGS — público para leitura (usado pela tela do ouvinte)
-- ============================================================
ALTER TABLE theme_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "theme_settings_select" ON theme_settings;
CREATE POLICY "theme_settings_select" ON theme_settings FOR SELECT
  USING (true); -- público

DROP POLICY IF EXISTS "theme_settings_insert" ON theme_settings;
CREATE POLICY "theme_settings_insert" ON theme_settings FOR INSERT
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "theme_settings_update" ON theme_settings;
CREATE POLICY "theme_settings_update" ON theme_settings FOR UPDATE
  USING (is_admin());

-- ============================================================
-- TABELAS GLOBAIS (sem user_id — acessíveis por todos autenticados)
-- ============================================================

-- GENRE_STANDARDS — catálogo global de gêneros
ALTER TABLE genre_standards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "genre_standards_select" ON genre_standards;
CREATE POLICY "genre_standards_select" ON genre_standards FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "genre_standards_modify" ON genre_standards;
CREATE POLICY "genre_standards_modify" ON genre_standards FOR ALL
  USING (is_admin());

-- SERVICE_PLANS — planos de serviço (público para leitura)
ALTER TABLE service_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_plans_select" ON service_plans;
CREATE POLICY "service_plans_select" ON service_plans FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "service_plans_modify" ON service_plans;
CREATE POLICY "service_plans_modify" ON service_plans FOR ALL
  USING (is_admin());

-- NEWS_ITEMS — boletins (público para leitura)
ALTER TABLE news_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "news_items_select" ON news_items;
CREATE POLICY "news_items_select" ON news_items FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "news_items_modify" ON news_items;
CREATE POLICY "news_items_modify" ON news_items FOR ALL
  USING (is_admin());

-- APP_SETTINGS — configurações globais do sistema
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_select" ON app_settings;
CREATE POLICY "app_settings_select" ON app_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "app_settings_modify" ON app_settings;
CREATE POLICY "app_settings_modify" ON app_settings FOR ALL
  USING (is_admin());
