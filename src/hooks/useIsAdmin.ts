"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

/**
 * Checks if the current authenticated user has the 'admin' role.
 */
export const useIsAdmin = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAdmin(false); setLoading(false); return; }

      const { data } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });

      setIsAdmin(data === true);
      setLoading(false);
    };
    check();
  }, []);

  return { isAdmin, loading };
};
