"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
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

  return { user, userId: user?.id ?? null, isAdmin, isLoading };
}
