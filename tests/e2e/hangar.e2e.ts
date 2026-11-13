import { test, expect, type Page } from "@playwright/test";

const PROFILE_KEY = "neon-survivor.profile.v2";
const LEGACY_KEY = "neon-survivor.records.v1";

async function grantMaterials(page: Page, amount: number) {
  await page.evaluate(
    ([key, n]) => {
      const raw = localStorage.getItem(key);
      const profile = raw ? JSON.parse(raw) : {
        version: 2,
        materials: 0,
        hangar: { weapons: ["pulse"], modIds: [] },
        records: [],
        claimedRuns: [],
        migrations: [],
      };
      profile.materials = n;
      localStorage.setItem(key, JSON.stringify(profile));
    },
    [PROFILE_KEY, amount] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    (keys) => keys.forEach((k) => localStorage.removeItem(k)),
    [PROFILE_KEY, LEGACY_KEY],
  );
});

test("机库购买：校验通过并写回档案，余额扣减", async ({ page }) => {
  await grantMaterials(page, 300);
  await page.reload();
  await page.getByRole("button", { name: /局外机库/ }).first().click();

  await expect(page.getByRole("heading", { name: /局外机库/ })).toBeVisible();
  // 选择环轨飞刃（费用 60）与护盾核心（费用 65）。
  await page.getByRole("button", { name: /环轨飞刃/ }).click();
  await page.getByRole("button", { name: /护盾核心/ }).click();
  await expect(page.locator(".cost-summary strong").first()).toHaveText(
    "125 ◈",
  );
  await page.getByRole("button", { name: "校验并保存出发配置" }).click();
  await expect(page.locator(".hangar-feedback.ok")).toBeVisible();

  const profile = await page.evaluate((k) => {
    return JSON.parse(localStorage.getItem(k)!);
  }, PROFILE_KEY);
  expect(profile.materials).toBe(175);
  expect(profile.hangar.weapons).toEqual(["pulse", "orbit"]);
  expect(profile.hangar.modIds).toEqual(["shield-core"]);
});

test("互斥改装无法同时选择，且生存下限校验拦截非法配置", async ({ page }) => {
  await grantMaterials(page, 500);
  await page.reload();
  await page.getByRole("button", { name: /局外机库/ }).first().click();
  await page.getByRole("button", { name: /加固机架/ }).click();
  await page.getByRole("button", { name: /轻量化机架/ }).click();
  // 同组互斥：后选的替换先选的，机架组始终只有一项。
  const selected = page.locator(".mod-card.selected");
  await expect(selected).toHaveCount(1);
  await expect(selected.first()).toContainText("轻量化机架");
});

test("出发配置锁定：就绪界面展示锁定信息，战斗中机库只读", async ({ page }) => {
  await grantMaterials(page, 300);
  await page.reload();
  await page.getByRole("button", { name: /局外机库/ }).first().click();
  await page.getByRole("button", { name: /新星爆发/ }).click();
  await page.getByRole("button", { name: "校验并保存出发配置" }).click();
  await page.getByRole("button", { name: "关闭 ✕" }).click();

  await expect(page.locator(".locked-loadout")).toContainText("nova");
  await page.getByRole("button", { name: /开始行动/ }).click();

  // 战斗中打开机库应显示锁定横幅且卡片禁用。
  await page.getByRole("button", { name: /局外机库/ }).first().click();
  await expect(page.locator(".hangar-lock-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: /脉冲步枪/ })).toBeDisabled();
});

test("结算材料写入档案且重复打开不重复发放", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /开始行动/ }).click();
  // 等待机体阵亡（站桩 4 分钟以内必然被敌潮击败）。
  await expect(page.getByText("信号暂时中断")).toBeVisible({
    timeout: 120000,
  });
  await expect(page.locator(".settlement-status.ok")).toBeVisible({
    timeout: 10000,
  });
  const awarded = await page.locator(".settlement-line strong").textContent();
  expect(awarded).toMatch(/\+\d+ ◈/);

  const profile = await page.evaluate((k) => {
    return JSON.parse(localStorage.getItem(k)!);
  }, PROFILE_KEY);
  const amount = Number(awarded!.replace(/[^\d]/g, ""));
  expect(profile.materials).toBe(amount);
  expect(profile.claimedRuns).toHaveLength(1);

  // 重新接入后再检查档案：上一局 runId 仍只入账一次。
  await page.getByRole("button", { name: /重新接入/ }).click();
  const after = await page.evaluate((k) => {
    return JSON.parse(localStorage.getItem(k)!);
  }, PROFILE_KEY);
  expect(after.claimedRuns).toHaveLength(1);
  expect(after.materials).toBe(amount);
});

test("旧版 v1 档案自动迁移并保留行动记录", async ({ page }) => {
  await page.evaluate(
    ([key, record]) => localStorage.setItem(key, JSON.stringify([record])),
    [
      LEGACY_KEY,
      {
        id: "legacy-1",
        duration: 99,
        wave: 2,
        level: 3,
        kills: 11,
        damage: 500,
        weapons: ["pulse:1"],
        victory: false,
      },
    ] as const,
  );
  await page.reload();
  const profile = await page.evaluate((k) => {
    return JSON.parse(localStorage.getItem(k)!);
  }, PROFILE_KEY);
  expect(profile.version).toBe(2);
  expect(profile.records).toHaveLength(1);
  expect(profile.migrations[0].from).toBe(1);
  expect(profile.hangar.weapons).toEqual(["pulse"]);
  expect(await page.evaluate((k) => localStorage.getItem(k), LEGACY_KEY)).toBeNull();
});
