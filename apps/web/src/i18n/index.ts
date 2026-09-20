/**
 * i18n — frontend.md §6.1: react-i18next สองภาษาไทย/อังกฤษ
 * locale ที่มา: user_settings.locale (boot) → fallback 'th'; สลับใน Settings →
 * PATCH /settings { locale } → changeLanguage
 * (resources import แบบ static — ไฟล์เล็ก, lazy-load เป็น optimize ภายหลัง)
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import th from "./locales/th.json";
import en from "./locales/en.json";
import { settingsApi } from "../api";

export const LOCALES = ["th", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

// แต่ละ top-level section ของ locale JSON = 1 namespace (common/auth/home/...)
// → key ใน component อยู่ในรูป "namespace:key.to.value" เช่น t("common:logout")
function toResources(json: Record<string, object>) {
  return Object.fromEntries(Object.entries(json).map(([ns, value]) => [ns, value]));
}

void i18next.use(initReactI18next).init({
  resources: {
    th: toResources(th),
    en: toResources(en),
  },
  lng: "th",
  fallbackLng: "th",
  defaultNS: "common",
  interpolation: { escapeValue: false },
});

/**
 * boot (frontend.md §6.1) — ดึง locale จาก user_settings แล้ว apply; ยังไม่ล็อกอิน /
 * ดึงไม่สำเร็จ → คง 'th' (เรียกจาก App effect เมื่อมี session)
 */
export async function applyLocaleFromServer(): Promise<void> {
  try {
    const settings = await settingsApi.get();
    if (isLocale(settings.locale)) {
      await i18next.changeLanguage(settings.locale);
    }
  } catch {
    // ยังไม่ล็อกอิน — ใช้ default
  }
}

export default i18next;
