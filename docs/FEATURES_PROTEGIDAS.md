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
