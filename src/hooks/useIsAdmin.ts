"use client";

import { useCurrentUser } from "./useCurrentUser";

export const useIsAdmin = () => {
  const { isAdmin, isLoading } = useCurrentUser();
  return { isAdmin, loading: isLoading };
};
