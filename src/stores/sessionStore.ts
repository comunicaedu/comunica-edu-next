import { create } from "zustand";

const STORAGE_KEY = "edu-jwt-session";

export interface EduSessionUser {
  id: string;
  email: string;
  role: "admin" | "client";
  username?: string;
}

interface SessionState {
  token: string | null;
  user: EduSessionUser | null;
  hydrated: boolean;

  setSession: (token: string, user: EduSessionUser) => void;
  clearSession: () => void;
  hydrateFromSessionStorage: () => void;
  getToken: () => string | null;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  token: null,
  user: null,
  hydrated: false,

  setSession: (token, user) => {
    set({ token, user });
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    } catch {}
  },

  clearSession: () => {
    set({ token: null, user: null });
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  },

  hydrateFromSessionStorage: () => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { token?: string; user?: EduSessionUser };
        if (parsed.token && parsed.user?.id) {
          set({ token: parsed.token, user: parsed.user, hydrated: true });
          return;
        }
      }
    } catch {}
    set({ hydrated: true });
  },

  getToken: () => get().token,
}));
