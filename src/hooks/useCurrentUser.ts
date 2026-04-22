"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { useSessionStore } from "@/stores/sessionStore";
import type { User } from "@supabase/supabase-js";

export function useCurrentUser(): {
  user: User | null;
  userId: string | null;
  isAdmin: boolean;
  isLoading: boolean;
} {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadUser = async () => {
      try {
        // Prioridade: JWT próprio do sessionStore (isolado por aba)
        const sessionStore = useSessionStore.getState();
        if (!sessionStore.hydrated) {
          sessionStore.hydrateFromSessionStorage();
        }
        const storeUser = useSessionStore.getState().user;

        if (storeUser?.id) {
          if (!mounted) return;
          setUser({ id: storeUser.id, email: storeUser.email } as User);
          setIsAdmin(storeUser.role === "admin");
          setIsLoading(false);
          return;
        }

        // Fallback: Supabase auth
        const { data: { user: u }, error } = await supabase.auth.getUser();
        if (!mounted) return;

        if (error || !u) {
          setUser(null);
          setIsAdmin(false);
          setIsLoading(false);
          return;
        }

        setUser(u);

        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", u.id)
          .eq("role", "admin")
          .maybeSingle();

        if (!mounted) return;
        setIsAdmin(!!roleRow);
      } catch {
        // Keep previous values on error
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return;

      if (event === "SIGNED_OUT") {
        setUser(null);
        setIsAdmin(false);
        setIsLoading(false);
        return;
      }

      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        loadUser();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const storeUserId = useSessionStore(s => s.user?.id);
  return { user, userId: storeUserId ?? user?.id ?? null, isAdmin, isLoading };
}
