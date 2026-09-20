/**
 * E2E journeys — testing.md §3.6 (roadmap Phase 9 DoD) บน chromium
 * ทุก journey ใช้ YouTube จริงผ่าน compose stack (ยังไม่มี seed เสียงสังเคราะห์ — testing.md §4)
 * J7 (like) / J8 (playlist) / J9 (autoplay) = test.skip — backend เป็น Phase 10/11
 */
import { expect, test, type Page } from "@playwright/test";

const QUERY = "daft punk one more time";

async function register(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "ยังไม่มีบัญชี? สมัครเลย" }).click();
  await page.getByLabel("ชื่อที่แสดง").fill("E2E Runner");
  await page.getByLabel("Email").fill(`e2e-${Date.now()}@journeys.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สมัครบัญชี" }).click();
  await expect(page.getByTestId("player-bar")).toBeVisible();
}

async function search(page: Page, query: string): Promise<void> {
  await page.goto("/search");
  await page.getByTestId("search-input").fill(query);
  await page
    .locator('[data-testid^="play-"]')
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
}

async function playFirst(page: Page): Promise<void> {
  await page.locator('[data-testid^="play-"]').first().click();
}

/** audio element state — testing.md: ตรวจ "มีเสียงจริง" ด้วยสถานะ audio element */
function audioState(
  page: Page,
): Promise<{ found: boolean; paused: boolean; t: number }> {
  return page.evaluate(
    `(() => { const a = document.querySelector('audio'); return { found: !!a, paused: !!a?.paused, t: a?.currentTime ?? 0 }; })()`,
  );
}

/** testing.md: ตรวจ "มีเสียงจริง" ด้วยสถานะ audio element */
async function expectAudible(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(
          `(() => { const a = document.querySelector('audio'); return !!(a && !a.paused && a.currentTime > 0); })()`,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

test.describe.serial("journeys 1-6 + 10-11 (testing.md §3.6)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    // J1 (ครึ่งแรก): สมัคร → ล็อกอินอัตโนมัติ
    await register(page);
  });

  test.afterAll(async ({ browser }) => {
    await page.close();
    await browser.close();
  });

  test("J1 ค้นหา → เล่น → ได้ยินเสียง", async () => {
    await search(page, QUERY);
    await playFirst(page);
    await expectAudible(page);
  });

  test("J2 play → pause → resume → position ต่อเนื่อง", async () => {
    await page.getByTestId("btn-toggle").click();
    await expect
      .poll(
        async () => page.evaluate(`(() => document.querySelector('audio')?.paused)()`),
        {
          timeout: 10_000,
        },
      )
      .toBe(true);
    const t0 = (await page.evaluate(
      `(() => document.querySelector('audio').currentTime)()`,
    )) as number;
    await page.getByTestId("btn-toggle").click();
    await expect
      .poll(
        async () => page.evaluate(`(() => document.querySelector('audio')?.paused)()`),
        {
          timeout: 10_000,
        },
      )
      .toBe(false);
    const t1 = (await page.evaluate(
      `(() => document.querySelector('audio').currentTime)()`,
    )) as number;
    // resume แล้ว position ต้องต่อเนื่อง (ไม่ reset กลับ 0)
    expect(Math.abs(t1 - t0)).toBeLessThan(3);
  });

  test("J3 คิว 3 เพลง → skip ×2 → previous → เพลงถูกต้อง", async () => {
    await search(page, QUERY);
    // ชื่อ 3 เพลงแรกของผลค้นหา (แถวเรียงตาม response)
    const titles = (await page.evaluate(
      `(() => [...document.querySelectorAll('[data-testid^=play-]')].slice(0, 3).map((b) => b.querySelector('.font-medium')?.textContent ?? ''))()`,
    )) as string[];
    const ids = (await page.evaluate(
      `(() => [...document.querySelectorAll('[data-testid^=add-queue-]')].slice(0, 3).map((b) => b.getAttribute('data-testid').replace('add-queue-', '')))()`,
    )) as string[];
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      await page.getByTestId(`add-queue-${id}`).click();
    }
    await page.getByTestId("btn-skip").click();
    await page.getByTestId("btn-skip").click();
    await page.getByTestId("btn-previous").click();
    await expectAudible(page);
    // current เดิม (จาก J1) → skip: t1 → skip: t2 (history: J1track, t1) →
    // previous = pop history ล่าสุด → current = t1 (เพลงแรกที่เพิ่ม — queue.md §previous)
    await expect
      .poll(async () =>
        page.evaluate(
          `(() => document.querySelector('[data-testid=queue-current]')?.textContent ?? '')()`,
        ),
      )
      .toContain(titles[0]!);
  });

  test("J4 shuffle on → skip/previous ทำงาน + state mirror", async () => {
    await page.getByTestId("btn-shuffle").click();
    await expect
      .poll(async () =>
        page.evaluate(
          `(() => document.querySelector('[data-testid=btn-shuffle]')?.className.includes('text-emerald-400'))()`,
        ),
      )
      .toBe(true);
    await page.getByTestId("btn-skip").click();
    await expectAudible(page);
    await page.getByTestId("btn-previous").click();
    await expectAudible(page);
  });

  test("J5 seek กลางเพลง → UI + audio ตรงกัน", async () => {
    await search(page, QUERY);
    await playFirst(page);
    await expectAudible(page);
    await page.evaluate(
      `(() => { const s = document.querySelector('[data-testid=seek-bar]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(s, '60000'); s.dispatchEvent(new Event('input', {bubbles:true})); s.dispatchEvent(new Event('pointerup', {bubbles:true})); })()`,
    );
    await expect
      .poll(
        async () =>
          page.evaluate(
            `(() => Math.round(document.querySelector('audio').currentTime))()`,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(45);
  });

  test("J6 EQ Bass Boost → เล่นต่อได้ ไม่ error", async () => {
    // กลางการเล่น เข้าหน้า settings (full reload → restore PAUSED ตาม player.md #7)
    // → เลือก Bass Boost → resume → ต้องเล่นได้ต่อเนื่อง ไม่มี error (testing.md §3.6 #6)
    await expectAudible(page);
    await page.goto("/settings");
    await page.getByTestId("eq-preset-select").selectOption({ label: "Bass Boost" });
    expect(
      await page.evaluate(
        `(() => document.querySelector('[data-testid=eq-preset-select]').value === '00000000-0000-4000-8000-000000000007')()`,
      ),
    ).toBe(true);
    // resume เพลงเดิมที่ restore ไว้ — EQ ใหม่ต้องไม่ทำให้เสียงพัง
    await page.getByTestId("btn-toggle").click();
    await expectAudible(page);
    const s = await audioState(page);
    expect(s.found && !s.paused && s.t > 0).toBe(true);
  });

  test("J10 refresh กลางเพลง → เล่นต่อ ±5 s", async () => {
    await search(page, QUERY);
    await playFirst(page);
    await expectAudible(page);
    await page.waitForTimeout(8_000);
    const before = (await page.evaluate(
      `(() => Math.round(document.querySelector('audio').currentTime))()`,
    )) as number;
    await page.reload();
    await page.getByTestId("player-bar").waitFor({ state: "visible", timeout: 20_000 });
    // restore เป็น PAUSED ที่ตำแหน่งเดิม (player.md #7) → กดเล่นต่อ ตำแหน่งใกล้เดิม ±5 s
    await page.getByTestId("btn-toggle").click();
    await expectAudible(page);
    await expect
      .poll(
        async () =>
          page.evaluate(
            `(() => Math.round(document.querySelector('audio').currentTime))()`,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(before - 5);
  });

  test("J11 WS หลุด → เสียงเล่นต่อ → reconnect + resync", async () => {
    await expectAudible(page);
    await page.evaluate(`(() => window.__rt.simulateNetworkDrop())()`);
    await page.waitForTimeout(1_500);
    const stillPlaying = await page.evaluate(
      `(() => !document.querySelector('audio').paused)()`,
    );
    expect(stillPlaying).toBe(true);
    await expect
      .poll(async () => page.evaluate(`(() => window.__rt.connected)()`), {
        timeout: 30_000,
      })
      .toBe(true);
  });
});

test.describe("journeys 7-9 (test.skip — backend เป็น Phase 10/11 ตาม roadmap)", () => {
  test.skip("J7 like → refresh → ยัง liked; หน้า liked แสดง (Phase 10: LikeService)", () => {});
  test.skip("J8 playlist สร้าง → เพิ่มเพลง → เล่นทั้ง playlist ตามลำดับ (Phase 10: PlaylistService)", () => {});
  test.skip("J9 autoplay: คิวหมด → เพลงใหม่เข้า (Phase 11: Autoplay)", () => {});
});
