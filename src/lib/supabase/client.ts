import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client do frontend.
 *
 * IMPORTANTE: persistSession e autoRefreshToken estão DESLIGADOS.
 * A autenticação verdadeira vem do sessionStore (JWT próprio).
 * Este client é usado apenas para:
 *  - Executar queries (Supabase client enviará anon key;
 *    o backend valida o JWT próprio via /api/auth/jwt-verify).
 *  - Fluxos pontuais que ainda usam supabase.auth (login via
 *    signInWithPassword, verifyOtp, signOut, etc).
 */
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);

// Legacy: alguns lugares ainda chamam createClient().
// Mantemos uma função compatível que retorna o singleton.
export const createClient = () => supabase;
