import type { ModId, ModMutexGroup, WeaponId } from "../../../shared/types";

export const PROFILE_VERSION = 2 as const;
export const LEGACY_STORAGE_KEY = "neon-survivor.records.v1";
export const PROFILE_STORAGE_KEY = "neon-survivor.profile.v2";

export const MAX_WEAPONS = 3;
export const MIN_WEAPONS = 1;
export const MAX_MODS_PER_GROUP = 1;
/** 已结算 runId 去重列表的容量上限，超出后淘汰最旧条目，避免档案无限膨胀。 */
export const MAX_CLAIMED_RUNS = 100;

/** 有效参数的生存下限：校验规则不允许机库改装把机体压到阈值以下。 */
export const SURVIVAL_LIMITS = {
  maxHp: 60,
  speed: 120,
} as const;

export const BASE_STATS = {
  maxHp: 100,
  speed: 190,
  damageMul: 1,
  cooldownMul: 1,
  armorFlat: 0,
} as const;

export const WEAPON_COST: Record<WeaponId, number> = {
  pulse: 0,
  orbit: 60,
  nova: 90,
};

export interface ModDefinition {
  id: ModId;
  name: string;
  description: string;
  group: ModMutexGroup;
  cost: number;
  /** 对有效参数的调整量，倍率为乘法叠加前的加项。 */
  effects: {
    damageMul?: number;
    maxHpMul?: number;
    speedMul?: number;
    armorFlat?: number;
    cooldownMul?: number;
  };
}

/**
 * 机体改装分两个互斥槽位组（机架 / 核心），每组至多选择一个。
 * 互斥关系由 group 字段驱动，新增同组改装自动互斥。
 */
export const MOD_CATALOG: ModDefinition[] = [
  {
    id: "reinforced-frame",
    name: "加固机架",
    description: "生命上限 +25%，移动速度 -8%",
    group: "frame",
    cost: 50,
    effects: { maxHpMul: 0.25, speedMul: -0.08 },
  },
  {
    id: "stripped-frame",
    name: "轻量化机架",
    description: "移动速度 +15%，生命上限 -15%",
    group: "frame",
    cost: 50,
    effects: { speedMul: 0.15, maxHpMul: -0.15 },
  },
  {
    id: "overdrive-frame",
    name: "超载机架",
    description: "武器伤害 +20%，生命上限 -20%",
    group: "frame",
    cost: 70,
    effects: { damageMul: 0.2, maxHpMul: -0.2 },
  },
  {
    id: "shield-core",
    name: "护盾核心",
    description: "获得 1 级纳米装甲（受伤 -12%）",
    group: "core",
    cost: 65,
    effects: { armorFlat: 1 },
  },
  {
    id: "ammo-core",
    name: "强袭核心",
    description: "武器伤害 +15%，射速 -10%",
    group: "core",
    cost: 65,
    effects: { damageMul: 0.15, cooldownMul: 0.1 },
  },
  {
    id: "cooling-core",
    name: "散热核心",
    description: "武器射速 +15%，生命上限 -10%",
    group: "core",
    cost: 65,
    effects: { cooldownMul: -0.15, maxHpMul: -0.1 },
  },
];

export const MOD_BY_ID: Record<ModId, ModDefinition> = Object.fromEntries(
  MOD_CATALOG.map((m) => [m.id, m]),
) as Record<ModId, ModDefinition>;

export const MOD_GROUPS: ModMutexGroup[] = ["frame", "core"];
