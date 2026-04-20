import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AuthUser, LoginRequest } from '@/types';
import { getPartApi } from '@/services/api/factory';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (req: LoginRequest) => Promise<boolean>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      loading: false,
      error: null,

      async login(req) {
        set({ loading: true, error: null });
        try {
          const res = await getPartApi().login(req);
          set({ token: res.token, user: res.user, loading: false });
          return true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set({ loading: false, error: msg });
          return false;
        }
      },

      async logout() {
        const token = get().token;
        if (token) {
          try {
            await getPartApi().logout(token);
          } catch {
            /* ignore */
          }
        }
        set({ token: null, user: null, error: null });
      },

      async restore() {
        const token = get().token;
        if (!token) return;
        try {
          const user = await getPartApi().me(token);
          if (user) {
            set({ user });
          }
          // ★ If the server returns null we DON'T automatically clear the
          //   local token. A mismatched prefix or a temporary /me outage
          //   would otherwise boot the user straight back to the login
          //   page right after a successful login. Real sign-outs go
          //   through `logout()` which explicitly clears state.
        } catch {
          // network error — keep the cached token, user can retry.
        }
      },
    }),
    {
      name: 'bizmech.auth',
      partialize: (s) => ({ token: s.token, user: s.user }),
    },
  ),
);
