import { create } from "zustand";

/**
 * access token เก็บใน memory เท่านั้น (security.md §1 — ไม่เขียน localStorage)
 * กลับมาหลัง refresh ได้เพราะ refresh cookie (httpOnly) ถูกแนบอัตโนมัติ same-origin
 */
interface AuthState {
  accessToken: string | null;
  /** boot ครั้งแรก: ลอง refresh เงียบ ๆ เพื่อฟื้นเซสชันเดิม */
  hydrated: boolean;
  setAccessToken: (token: string) => void;
  clear: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  hydrated: false,
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null }),
  setHydrated: () => set({ hydrated: true }),
}));
