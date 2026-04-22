"use client";

import { supabase } from "@/lib/supabase/client";
import { useSessionStore } from "@/stores/sessionStore";

/**
 * Fetch wrapper que adiciona automaticamente o Bearer token.
 * Prioriza JWT próprio do sessionStore; fallback para Supabase.
 */
export async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Prioridade: JWT próprio do store (isolado por aba)
  const storeToken = useSessionStore.getState().token;
  if (storeToken) {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${storeToken}`);
    return fetch(url, { ...options, headers });
  }

  // Fallback: Supabase session (cookies compartilhados)
  let { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed.session;
  }

  const headers = new Headers(options.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  return fetch(url, { ...options, headers });
}
