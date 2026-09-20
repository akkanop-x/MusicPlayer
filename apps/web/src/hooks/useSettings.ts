/**
 * useSettings — TanStack Query สำหรับ /settings (server state — frontend.md §3.1);
 * สลับภาษา → PATCH /settings {locale} + i18n.changeLanguage (frontend.md §6.1)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "../api";
import i18next, { isLocale, type Locale } from "../i18n";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
    staleTime: 30_000,
  });
}

export function useSetLocale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (locale: Locale) => {
      const settings = await settingsApi.patch({ locale });
      await i18next.changeLanguage(settings.locale);
      return settings;
    },
    onSuccess: (settings) => {
      // ทุกอุปกรณ์ sync ผ่านการ invalidate — ค่าใน cache อัปเดตทันที
      queryClient.setQueryData(["settings"], settings);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

/** guard locale จาก server ก่อน changeLanguage (ค่าควรเป็น th|en เสมอ) */
export function applyLocale(locale: string): void {
  if (isLocale(locale)) void i18next.changeLanguage(locale);
}
