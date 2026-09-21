/**
 * queryClient — ตัวเดียวต่อ app (App.tsx + realtime handlers ใช้ร่วมกัน:
 * LIKES_CHANGED มาจาก WS นอก React tree ต้องแก้ cache ตรงได้)
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});
