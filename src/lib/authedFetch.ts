"use client";

import { supabase } from "@/lib/supabase/client";

/**
 * Fetch wrapper que adiciona automaticamente o Bearer token do Supabase.
 * Use sempre que chamar APIs internas que requerem autenticação.
 */
export async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
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
