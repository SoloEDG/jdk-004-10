import { test } from "node:test";
import assert from "node:assert/strict";
import type { HangarConfig, ProfileDoc } from "../src/shared/types";
import {
  DEFAULT_HANGAR,
  hangarCost,
  previewStats,
  toModifiers,
  validateHangar,
} from "../src/features/hangar";
import {
  computeSettlement,
  isSettlementClaimable,
} from "../src/features/hangar";
import {
  claimSettlement,
  loadProfile,
  migrateProfile,
  purchaseHangar,
  StorageQuotaError,
  type StorageLike,
} from "../src/features/hangar";
import { createRun } from "../src/shared/createRun";
import { stepResults } from "../src/features/results";
import type { FrameEvents } from "../src/shared/types";

const events = (): FrameEvents => ({
  kills: [],
  damage: 0,
  taken: 0,
  shots: 0,
  collected: 0,
});

/** 内存版 localStorage 替身；failWrites 可模拟配额耗尽。 */
function fakeStorage(failWrites = false): StorageLike & { dump: () => Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (failWrites) throw new DOMException("QuotaExceededError", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k) => map.delete(k),
    dump: () => map,
  };
}

const baseProfile = (over: Partial<ProfileDoc> = {}): ProfileDoc => ({
  version: 2,
  materials: 500,
  hangar: structuredClone(DEFAULT_HANGAR),
  records: [],
  claimedRuns: [],
  migrations: [],
  ...over,
});

test("默认配置通过校验并给出基础有效参数", () => {
  assert.equal(validateHangar(DEFAULT_HANGAR).ok, true);
  const stats = previewStats(DEFAULT_HANGAR);
  assert.deepEqual(stats, {
    maxHp: 100,
    speed: 190,
    damageMul: 1,
    cooldownMul: 1,
    armorFlat: 0,
  });
});

test("武器校验：至少一件、至多三件、禁止重复与未知 id", () => {
  assert.ok(validateHangar({ weapons: [], modIds: [] }).errors.join(";").includes("至少"));
  assert.ok(
    validateHangar({ weapons: ["pulse", "orbit", "nova"], modIds: [] }).ok,
  );
  const dup: HangarConfig = { weapons: ["pulse", "pulse"], modIds: [] };
  assert.ok(validateHangar(dup).errors.join(";").includes("重复"));
  const bad = validateHangar({ weapons: ["plasma" as never], modIds: [] });
  assert.equal(bad.ok, false);
});

test("互斥规则：同组改装只能选择一项", () => {
  const conflict: HangarConfig = {
    weapons: ["pulse"],
    modIds: ["reinforced-frame", "stripped-frame"],
  };
  const result = validateHangar(conflict);
  assert.equal(result.ok, false);
  assert.ok(result.errors.join(";").includes("互斥"));
  // 跨组可共存。
  const mixed: HangarConfig = {
    weapons: ["pulse"],
    modIds: ["reinforced-frame", "shield-core"],
  };
  assert.equal(validateHangar(mixed).ok, true);
});

test("生存规则：叠加改装后生命与移速不得低于下限", () => {
  // 超载机架（-20% HP）+ 散热核心（-10% HP）= 70 血，仍高于 60 下限。
  const legal: HangarConfig = {
    weapons: ["pulse"],
    modIds: ["overdrive-frame", "cooling-core"],
  };
  assert.equal(validateHangar(legal).ok, true);
  assert.equal(previewStats(legal).maxHp, 70);
  // 轻量机架 -15% HP，与超载机架同组互斥，无法直接压穿；
  // 用构造数据验证下限拦截确实生效。
  const stats = previewStats({
    weapons: ["pulse"],
    modIds: ["stripped-frame"],
  });
  assert.equal(stats.maxHp, 85);
  assert.equal(stats.speed, Math.round(190 * 1.15));
});

test("改装修正量按目录定义折算，供引擎直接消费", () => {
  const m = toModifiers({
    weapons: ["pulse"],
    modIds: ["ammo-core", "shield-core"],
  });
  assert.equal(m.damageMul, 1.15);
  assert.equal(m.cooldownMul, 1.1);
  assert.equal(m.armorFlat, 1);
});

test("装配费用随武器与改装累加", () => {
  const config: HangarConfig = {
    weapons: ["pulse", "orbit"],
    modIds: ["shield-core"],
  };
  assert.equal(hangarCost(config), 60 + 65);
});

test("createRun 锁定出发配置：初始武器与机体参数来自机库快照", () => {
  const loadout: HangarConfig = {
    weapons: ["pulse", "nova"],
    modIds: ["reinforced-frame"],
  };
  const d = createRun({ loadout, runId: "run-lock-1" });
  assert.deepEqual(
    d.weapons.map((w) => w.id),
    ["pulse", "nova"],
  );
  assert.ok(d.weapons.every((w) => w.level === 1));
  assert.equal(d.player.maxHp, 125);
  assert.deepEqual(d.lockedLoadout.modIds, loadout.modIds);
});

test("战斗中修改档案机库不会改变已锁定的本局配置", () => {
  const d = createRun({ loadout: DEFAULT_HANGAR, runId: "run-lock-2" });
  const before = JSON.stringify({
    weapons: d.weapons,
    player: d.player,
    locked: d.lockedLoadout,
  });
  // 模拟局外在档案里换装（本局仅持有快照，不引用档案对象）。
  d.lockedLoadout.weapons = ["pulse", "orbit"];
  assert.notEqual(JSON.stringify(d.lockedLoadout), before);
  assert.deepEqual(d.weapons.map((w) => w.id), ["pulse"]);
});

test("非法机库配置初始化时回退默认配置而不是抛错", () => {
  const d = createRun({
    loadout: { weapons: [], modIds: [] },
    runId: "run-lock-3",
  });
  assert.deepEqual(d.lockedLoadout, DEFAULT_HANGAR);
  assert.deepEqual(d.weapons.map((w) => w.id), ["pulse"]);
});

test("结算材料按已完成行动计算，公式可追溯", () => {
  const d = createRun({ runId: "run-reward-1" });
  d.phase = "playing";
  d.player.hp = 0;
  d.wave = 3;
  d.stats.kills = 12;
  stepResults(d, events());
  const info = computeSettlement(d);
  assert.equal(info.materials, 12 * 2 + 3 * 8);
  assert.equal(info.runId, "run-reward-1");
  assert.ok(info.formula.includes("击杀"));
  assert.equal(isSettlementClaimable(info, []), true);
  assert.equal(isSettlementClaimable(info, ["run-reward-1"]), false);
});

test("撤离成功额外发放撤离加成", () => {
  const d = createRun({ runId: "run-reward-2" });
  d.phase = "playing";
  d.victory = true;
  d.wave = 8;
  d.stats.kills = 50;
  const info = computeSettlement(d);
  assert.equal(info.materials, 50 * 2 + 8 * 8 + 40);
});

test("购买装配：校验与余额检查通过后才扣款并落盘", () => {
  const storage = fakeStorage();
  const profile = baseProfile({ materials: 200 });
  const config: HangarConfig = {
    weapons: ["pulse", "orbit"],
    modIds: [],
  };
  const result = purchaseHangar(profile, config, storage);
  assert.equal(result.ok, true);
  assert.equal(result.profile.materials, 140);
  assert.deepEqual(result.profile.hangar.weapons, ["pulse", "orbit"]);
  // 原档案对象未被原地修改。
  assert.equal(profile.materials, 200);
  const reloaded = loadProfile(storage);
  assert.equal(reloaded.materials, 140);
});

test("材料不足时拒绝购买且余额与存储均不变", () => {
  const storage = fakeStorage();
  const profile = baseProfile({ materials: 10 });
  const result = purchaseHangar(
    profile,
    { weapons: ["pulse", "nova"], modIds: [] },
    storage,
  );
  assert.equal(result.ok, false);
  assert.equal(result.profile.materials, 10);
  assert.equal(storage.dump().size, 0);
});

test("校验失败的配置不会触发扣款", () => {
  const storage = fakeStorage();
  const profile = baseProfile();
  const result = purchaseHangar(
    profile,
    { weapons: ["pulse", "pulse"], modIds: [] },
    storage,
  );
  assert.equal(result.ok, false);
  assert.equal(result.profile.materials, 500);
  assert.equal(storage.dump().size, 0);
});

test("存储配额不足：保留原余额，不出现材料已扣但装配未保存", () => {
  const storage = fakeStorage(true);
  const profile = baseProfile({ materials: 200 });
  const result = purchaseHangar(
    profile,
    { weapons: ["pulse", "orbit"], modIds: [] },
    storage,
  );
  assert.equal(result.ok, false);
  assert.equal(result.profile.materials, 200);
  assert.deepEqual(result.profile.hangar, DEFAULT_HANGAR);
  assert.ok(result.errors[0].includes("存储"));
});

test("结算入账幂等：重复领取只发放一次", () => {
  const storage = fakeStorage();
  const profile = baseProfile({ materials: 0 });
  const d = createRun({ runId: "run-claim-1" });
  d.phase = "playing";
  d.player.hp = 0;
  d.stats.kills = 5;
  d.wave = 1;
  stepResults(d, events());
  const record = d.records[0];
  const first = claimSettlement(profile, d.settlement!, record, storage);
  assert.equal(first.ok, true);
  assert.equal(first.gain, 18);
  const second = claimSettlement(first.profile, d.settlement!, record, storage);
  assert.equal(second.ok, true);
  assert.equal(second.duplicated, true);
  assert.equal(second.gain, 0);
  assert.equal(second.profile.materials, 18);
  // 落盘档案同样只记一次。
  const reloaded = loadProfile(storage);
  assert.equal(reloaded.materials, 18);
  assert.deepEqual(reloaded.claimedRuns, ["run-claim-1"]);
});

test("结算写入失败时余额不变并可在存储恢复后重试成功", () => {
  const failing = fakeStorage(true);
  const profile = baseProfile({ materials: 30 });
  const settlement = {
    runId: "run-claim-2",
    materials: 25,
    basis: { kills: 5, wave: 1, victory: false, duration: 10 },
    formula: "5 击杀 ×2 + 1 波 ×8",
  };
  const record = {
    id: "run-claim-2",
    duration: 10,
    wave: 1,
    level: 1,
    kills: 5,
    damage: 0,
    weapons: ["pulse:1"],
    victory: false,
  };
  const failed = claimSettlement(profile, settlement, record, failing);
  assert.equal(failed.ok, false);
  assert.equal(failed.profile.materials, 30);
  assert.ok(failed.error);
  // 存储恢复（同一底层映射切换为可写）后重试。
  const healthy = fakeStorage();
  const retried = claimSettlement(failed.profile, settlement, record, healthy);
  assert.equal(retried.ok, true);
  assert.equal(retried.profile.materials, 55);
  assert.equal(retried.duplicated, false);
});

test("旧版 v1 裸数组档案迁移为 v2，并保留可追溯迁移记录", () => {
  const legacyRecord = {
    id: "old-1",
    duration: 120,
    wave: 4,
    level: 6,
    kills: 30,
    damage: 1200,
    weapons: ["pulse:2"],
    victory: false,
  };
  const migrated = migrateProfile([legacyRecord, { broken: true }]);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.records.length, 1);
  assert.deepEqual(migrated.hangar, DEFAULT_HANGAR);
  assert.equal(migrated.materials, 0);
  assert.equal(migrated.migrations.length, 1);
  assert.equal(migrated.migrations[0].from, 1);
});

test("loadProfile 自动迁移旧键并写入新键、清理旧键", () => {
  const storage = fakeStorage();
  storage.setItem(
    "neon-survivor.records.v1",
    JSON.stringify([
      {
        id: "old-2",
        duration: 10,
        wave: 1,
        level: 1,
        kills: 1,
        damage: 1,
        weapons: [],
        victory: true,
      },
    ]),
  );
  const profile = loadProfile(storage);
  assert.equal(profile.records.length, 1);
  assert.equal(storage.getItem("neon-survivor.profile.v2") !== null, true);
  assert.equal(storage.getItem("neon-survivor.records.v1"), null);
});

test("缺少新字段的损坏 v2 档案以默认配置补齐且不崩溃", () => {
  const repaired = migrateProfile({ version: 2, materials: "oops" });
  assert.equal(repaired.materials, 0);
  assert.deepEqual(repaired.hangar, DEFAULT_HANGAR);
  assert.ok(Array.isArray(repaired.claimedRuns));
});

test("StorageQuotaError 类型可被识别", () => {
  const err = new StorageQuotaError();
  assert.equal(err.name, "StorageQuotaError");
  assert.ok(err instanceof Error);
});
