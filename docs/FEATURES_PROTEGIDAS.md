# Features protegidas — NAO PODEM QUEBRAR durante migracao JWT

Data: 22/04/2026
Commit de referencia: HEAD atual (v-fundacao-jwt)

## Features que precisam continuar funcionando apos cada commit:

### 1. Login admin
- Rota: /login
- Usuario: admedu
- Comportamento: apos login, redireciona para /player com sidebar incluindo "Administracao"

### 2. Login cliente
- Rota: /login
- Usuarios: youtub, entre, yuotub
- Comportamento: apos login, redireciona para /player sem "Administracao"

### 3. Impersonation (ENTRAR NO PERFIL)
- Rota: /player?section=admin&tab=clientes
- Acao: clicar "Entrar no Perfil" em um cliente
- Comportamento esperado:
  - Sessao do admin e salva em localStorage (edu-admin-return-session)
  - Nova sessao como cliente e criada via verifyOtp
  - Redireciona para /player como cliente
  - Sidebar nao mostra "Administracao"

### 4. Sair da impersonation
- Acao: clicar "Sair do Perfil" no player
- Comportamento esperado: restaura sessao do admin, volta para Administracao > Clientes

### 5. Avatar e nome da empresa
- Aparece no canto superior direito do player
- Nome vem de profiles.display_name

### 6. Playlists (Biblioteca Musical)
- Todas as playlists carregadas
- Player toca musica normalmente

### 7. Painel admin
- Dashboard, Clientes, Generos, Planos, Aparencia acessiveis

## Protocolo de teste apos CADA commit:
1. Logout completo
2. Login como admin > verifica sidebar com Administracao
3. Administracao > Clientes > Entrar no Perfil de um cliente
4. Sair do Perfil > volta para Clientes
5. Logout
6. Login como cliente direto > verifica sidebar SEM Administracao
7. Logout

## Se QUALQUER item falhar em um commit:
   git reset --hard HEAD~1
   Investigar antes de prosseguir.

---

## Sistema de duration (Fase 1 e 2 - fechado em 26/04/2026)

Arquivos PROTEGIDOS - mudancas requerem teste integral:
- src/app/api/songs/route.ts (multipart com duration)
- src/app/api/songs/[id]/route.ts (PATCH para lazy-fill)
- src/app/api/spots/route.ts (multipart com duration)
- src/app/api/import-playlist/route.ts (filtro 270s)
- src/app/api/admin/sync-playlists/route.ts (filtro 270s)
- src/app/api/admin/clean-pending/route.ts (MAX 270)
- src/app/api/admin/clean-youtube/route.ts (MAX 270)
- src/components/player/LocutorVirtualPanel.tsx (envia duration)
- src/components/player/CompactLocutorVirtual.tsx (envia duration)
- src/components/player/SpotsPanel.tsx (envia duration)
- src/components/player/PlaylistSection.tsx (tipo tracks com duration)
- src/app/player/page.tsx (lazy-fill onLoadedData + pendingScheduleRef)

Schema do banco PROTEGIDO:
- songs.duration (INT) - tempo em segundos
- spots.duration (INT) - tempo em segundos
- Limite YouTube: <= 270 segundos (4:30)

Tag de fechamento: v-duration-fechada
Rollback emergencial: git reset --hard v-duration-fechada

Em caso de regressao desta area:
1. NAO commitar mudancas que quebrem essas validacoes
2. Rodar checks:
   - songs YouTube > 270s (deve ser 0)
   - playlist_songs orfaos (deve ser 0)
   - npm run build (deve passar)
