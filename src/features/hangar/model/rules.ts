import type {
  HangarConfig,
  ModifierState,
  ModId,
  WeaponId,
} from "../../../shared/types";
import {
  BASE_STATS,
  MAX_MODS_PER_GROUP,
  MAX_WEAPONS,
  MIN_WEAPONS,
  MOD_BY_ID,
  MOD_GROUPS,
  SURVIVAL_LIMITS,
  WEAPON_COST,
} from "./catalog";

export const DEFAULT_HANGAR: HangarConfig = {
  weapons: ["pulse"],
  modIds: [],
};

const ALL_WEAPONS: WeaponId[] = ["pulse", "orbit", "nova"];
const ALL_MODS = Object.values(MOD_BY_ID).map((m) => m.id);

export interface EffectiveStats {
  maxHp: number;
  speed: number;
  damageMul: number;
  cooldownMul: number;
  armorFlat: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 把机库改装折算为引擎使用的修正量（倍率以 1 为基准）。 */
export function toModifiers(config: HangarConfig): ModifierState {
  const sum = (pick: (m: (typeof MOD_BY_ID)[ModId]) => number | undefined) =>
    config.modIds.reduce((acc, id) => acc + (pick(MOD_BY_ID[id]) ?? 0), 0);
  return {
    damageMul: 1 + sum((m) => m.effects.damageMul),
    maxHpMul: 1 + sum((m) => m.effects.maxHpMul),
    speedMul: 1 + sum((m) => m.effects.speedMul),
    armorFlat: sum((m) => m.effects.armorFlat),
    cooldownMul: 1 + sum((m) => m.effects.cooldownMul),
  };
}

/** 预览该配置在新局开始时的有效参数。 */
export function previewStats(config: HangarConfig): EffectiveStats {
  const m = toModifiers(config);
  return {
    maxHp: Math.round(BASE_STATS.maxHp * m.maxHpMul),
    speed: Math.round(BASE_STATS.speed * m.speedMul),
    damageMul: m.damageMul,
    cooldownMul: m.cooldownMul,
    armorFlat: m.armorFlat,
  };
}

/** 配置的一次性装配费用（材料）。 */
export function hangarCost(config: HangarConfig): number {
  const weaponCost = config.weapons.reduce(
    (acc, id) => acc + WEAPON_COST[id],
    0,
  );
  const modCost = config.modIds.reduce(
    (acc, id) => acc + MOD_BY_ID[id].cost,
    0,
  );
  return weaponCost + modCost;
}

/**
 * 武器与生存规则校验。
 * 仅做纯函数判断，不触碰余额与存储，便于单测与 UI 复用。
 */
export function validateHangar(config: unknown): ValidationResult {
  const errors: string[] = [];
  if (!config || typeof config !== "object") {
    return { ok: false, errors: ["机库配置格式无效"] };
  }
  const { weapons, modIds } = config as Partial<HangarConfig>;

  if (!Array.isArray(weapons)) {
    errors.push("武器清单格式无效");
  } else {
    const seen = new Set<WeaponId>();
    for (const id of weapons) {
      if (!ALL_WEAPONS.includes(id)) {
        errors.push(`未知武器：${String(id)}`);
        continue;
      }
      if (seen.has(id)) errors.push(`武器重复装配：${id}`);
      seen.add(id);
    }
    if (seen.size < MIN_WEAPONS) errors.push("至少需要装配 1 件武器");
    if (seen.size > MAX_WEAPONS)
      errors.push(`最多同时装配 ${MAX_WEAPONS} 件武器`);
  }

  if (!Array.isArray(modIds)) {
    errors.push("改装清单格式无效");
  } else {
    const seenMods = new Set<ModId>();
    for (const id of modIds) {
      if (!ALL_MODS.includes(id)) {
        errors.push(`未知机体改装：${String(id)}`);
        continue;
      }
      if (seenMods.has(id)) errors.push(`改装重复选择：${id}`);
      seenMods.add(id);
    }
    for (const group of MOD_GROUPS) {
      const count = modIds.filter(
        (id) => ALL_MODS.includes(id) && MOD_BY_ID[id].group === group,
      ).length;
      if (count > MAX_MODS_PER_GROUP) {
        errors.push(
          `${group === "frame" ? "机架" : "核心"}槽位互斥，至多选择 ${MAX_MODS_PER_GROUP} 项改装`,
        );
      }
    }
  }

  // 结构合法后才做生存规则校验，避免脏数据触发次生报错。
  if (!errors.length) {
    const stats = previewStats(config as HangarConfig);
    if (stats.maxHp < SURVIVAL_LIMITS.maxHp)
      errors.push(
        `有效生命上限 ${stats.maxHp} 低于生存下限 ${SURVIVAL_LIMITS.maxHp}`,
      );
    if (stats.speed < SURVIVAL_LIMITS.speed)
      errors.push(
        `有效移速 ${stats.speed} 低于生存下限 ${SURVIVAL_LIMITS.speed}`,
      );
  }
  return { ok: errors.length === 0, errors };
}
