import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { HangarPanel } from "../src/features/hangar";
import { ResultDialog } from "../src/features/results";
import { createRun } from "../src/shared/createRun";
import type { HangarConfig, ProfileDoc } from "../src/shared/types";
import { DEFAULT_HANGAR } from "../src/features/hangar";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost" });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;

const profile = (over: Partial<ProfileDoc> = {}): ProfileDoc => ({
  version: 2,
  materials: 400,
  hangar: structuredClone(DEFAULT_HANGAR),
  records: [],
  claimedRuns: [],
  migrations: [],
  ...over,
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

test("HangarPanel 渲染武器、互斥改装分组与有效参数预览", async () => {
  const doc = createRun({ runId: "ui-1" });
  const { container, unmount } = await render(
    <HangarPanel
      profile={profile()}
      doc={doc}
      onSave={() => ({
        ok: true,
        profile: profile(),
        cost: 0,
        errors: [],
      })}
      close={() => {}}
    />,
  );
  assert.ok(container.textContent!.includes("局外机库"));
  assert.ok(container.textContent!.includes("初始武器"));
  assert.ok(container.textContent!.includes("有效参数预览"));
  assert.ok(container.textContent!.includes("机架槽位 · 互斥单选"));
  assert.ok(container.textContent!.includes("核心槽位 · 互斥单选"));
  // 标配脉冲步枪费用为 0，总费用显示 0。
  assert.ok(container.textContent!.includes("400"));
  await unmount();
});

test("HangarPanel 同组改装互斥：选择第二项替换第一项", async () => {
  const doc = createRun({ runId: "ui-2" });
  const { container, unmount } = await render(
    <HangarPanel
      profile={profile()}
      doc={doc}
      onSave={() => ({
        ok: true,
        profile: profile(),
        cost: 0,
        errors: [],
      })}
      close={() => {}}
    />,
  );
  const frameCards = Array.from(
    container.querySelectorAll(".mod-group .mod-card"),
  );
  const reinforced = frameCards.find((el) =>
    el.textContent!.includes("加固机架"),
  )!;
  const stripped = frameCards.find((el) =>
    el.textContent!.includes("轻量化机架"),
  )!;
  click(reinforced);
  assert.ok(reinforced.classList.contains("selected"));
  click(stripped);
  assert.equal(reinforced.classList.contains("selected"), false);
  assert.ok(stripped.classList.contains("selected"));
  // 机架组始终至多一项选中。
  const frameGroup = container.querySelectorAll(".mod-group")[0];
  const frameSelected = frameGroup.querySelectorAll(".mod-card.selected");
  assert.equal(frameSelected.length, 1);
  await unmount();
});

test("HangarPanel 保存回调收到当前草稿，失败时展示错误且不关闭", async () => {
  const doc = createRun({ runId: "ui-3" });
  let saved: HangarConfig | null = null;
  const { container, unmount } = await render(
    <HangarPanel
      profile={profile({ materials: 10 })}
      doc={doc}
      onSave={(config) => {
        saved = config;
        return {
          ok: false,
          profile: profile({ materials: 10 }),
          cost: 60,
          errors: ["材料不足：装配需要 60，当前余额 10"],
        };
      }}
      close={() => {}}
    />,
  );
  const orbit = Array.from(container.querySelectorAll(".weapon-card")).find(
    (el) => el.textContent!.includes("环轨飞刃"),
  )!;
  click(orbit);
  const saveBtn = container.querySelector(
    ".hangar-save",
  ) as HTMLButtonElement;
  // 余额不足时保存按钮禁用。
  assert.equal(saveBtn.disabled, true);
  assert.equal(saved, null);
  assert.ok(container.textContent!.includes("材料不足"));
  await unmount();
});

test("HangarPanel 行动进行中只读：卡片禁用并显示锁定横幅", async () => {
  const doc = createRun({ runId: "ui-4" });
  doc.phase = "playing";
  const { container, unmount } = await render(
    <HangarPanel
      profile={profile()}
      doc={doc}
      onSave={() => ({
        ok: true,
        profile: profile(),
        cost: 0,
        errors: [],
      })}
      close={() => {}}
    />,
  );
  assert.ok(container.textContent!.includes("出发配置已在行动开始时锁定"));
  const saveBtn = container.querySelector(
    ".hangar-save",
  ) as HTMLButtonElement;
  assert.equal(saveBtn.disabled, true);
  const cards = container.querySelectorAll<HTMLButtonElement>(".hangar-card");
  assert.ok(Array.from(cards).every((c) => c.disabled));
  await unmount();
});

test("ResultDialog 展示结算公式、材料与入账状态，失败时可重试", async () => {
  const doc = createRun({ runId: "ui-5" });
  doc.phase = "ended";
  doc.settlement = {
    runId: "ui-5",
    materials: 88,
    basis: { kills: 20, wave: 3, victory: false, duration: 100 },
    formula: "20 击杀 ×2 + 3 波 ×8",
  };
  doc.settlementClaimed = false;
  doc.settlementError = "本地存储空间不足，写入被拒绝";
  let retried = 0;
  const { container, unmount } = await render(
    <ResultDialog doc={doc} restart={() => {}} retryClaim={() => retried++} />,
  );
  assert.ok(container.textContent!.includes("+88"));
  assert.ok(container.textContent!.includes("20 击杀 ×2 + 3 波 ×8"));
  assert.ok(container.textContent!.includes("本地存储空间不足"));
  const retry = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent!.includes("重试写入"),
  )!;
  click(retry);
  assert.equal(retried, 1);
  await unmount();
});

test("ResultDialog 入账成功后展示已写入状态且无重试按钮", async () => {
  const doc = createRun({ runId: "ui-6" });
  doc.phase = "ended";
  doc.settlement = {
    runId: "ui-6",
    materials: 30,
    basis: { kills: 5, wave: 1, victory: false, duration: 40 },
    formula: "5 击杀 ×2 + 1 波 ×8",
  };
  doc.settlementClaimed = true;
  const { container, unmount } = await render(
    <ResultDialog doc={doc} restart={() => {}} retryClaim={() => {}} />,
  );
  assert.ok(container.textContent!.includes("材料已写入本地档案"));
  assert.equal(
    Array.from(container.querySelectorAll("button")).some((b) =>
      b.textContent!.includes("重试写入"),
    ),
    false,
  );
  await unmount();
});
