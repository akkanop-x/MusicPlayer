/**
 * i18n — frontend.md §6.1: locale จาก user_settings → changeLanguage; fallback th;
 * สลับภาษาทำงานทันที (t() ทุก string ผ่าน key ตรวจที่ component tests อื่น)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18next from "./index";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("../api", () => ({ settingsApi: apiMock }));

// ดึงตัวจริงจาก index (applyLocaleFromServer อยู่ที่นั่น)
const { applyLocaleFromServer } = await import("./index");

beforeEach(() => {
  apiMock.get.mockReset();
  void i18next.changeLanguage("th");
});

describe("applyLocaleFromServer (boot)", () => {
  it("locale จาก settings → changeLanguage", async () => {
    apiMock.get.mockResolvedValue({
      locale: "en",
      volume: 80,
      muted: false,
      autoplay: true,
      repeatMode: "off",
      shuffle: false,
      activeEqPresetId: null,
    });
    await applyLocaleFromServer();
    expect(i18next.language).toBe("en");
    // คำแปลใช้งานได้จริง
    expect(i18next.t("common:nav.library")).toBe("Library");
  });

  it("locale แปลกปลอม → คง th", async () => {
    apiMock.get.mockResolvedValue({ locale: "jp" });
    await applyLocaleFromServer();
    expect(i18next.language).toBe("th");
  });

  it("API ล้มเหลว → คง default ไม่ throw", async () => {
    apiMock.get.mockRejectedValue(new Error("401"));
    await expect(applyLocaleFromServer()).resolves.toBeUndefined();
    expect(i18next.language).toBe("th");
  });

  it("key ไทย/อังกฤษครบคู่กัน (ทุก key ใน th ต้องมีใน en)", async () => {
    const namespaces = Object.keys(i18next.store.data.th ?? {});
    expect(namespaces).toContain("common");
    for (const ns of namespaces) {
      const flatten = (obj: object, prefix = ""): string[] =>
        Object.entries(obj).flatMap(([k, v]) =>
          typeof v === "string" ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
        );
      const th = i18next.getResourceBundle("th", ns);
      const en = i18next.getResourceBundle("en", ns);
      if (!th || !en) continue; // ns หายทั้งฝั่ง — จับด้วย test อื่น
      const thKeys = flatten(th).sort();
      const enKeys = flatten(en).sort();
      expect(thKeys).toEqual(enKeys);
    }
  });
});
