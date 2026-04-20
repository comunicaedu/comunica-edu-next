"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { authedFetch } from "@/lib/authedFetch";

/**
 * Verifica se o usuário autenticado é admin.
 * 1. Consulta user_roles diretamente
 * 2. Se não encontrar, chama /api/auth/ensure-admin-role que também inicializa
 *    o role automaticamente quando nenhum admin existe no sistema.
 */
export const useIsAdmin = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const { data: { user, }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) { setIsAdmin(false); setLoading(false); return; }

      // 1. Consulta direta na tabela user_roles
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (roleRow) {
        setIsAdmin(true);
        setLoading(false);
        return;
      }

      // 2. Fallback: chama endpoint que inicializa o role se necessário
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setIsAdmin(false); setLoading(false); return; }

        const res = await authedFetch("/api/auth/ensure-admin-role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: session.access_token }),
        });
        const json = await res.json();
        setIsAdmin(json.isAdmin === true);
      } catch {
        setIsAdmin(false);
      }
      setLoading(false);
    };
    check();
  }, []);

  return { isAdmin, loading };
};
