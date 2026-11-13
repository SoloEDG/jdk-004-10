import type { GameDoc, HangarConfig, RunRecord } from "./types";
import {
  DEFAULT_HANGAR,
  toModifiers,
  validateHangar,
} from "../features/hangar/model/rules";

export interface CreateRunOptions {
  seed?: number;
  records?: RunRecord[];
  /** 出发前锁定的机库配置；非法时回退默认配置，保证新局永远可初始化。 */
  loadout?: HangarConfig;
  runId?: string;
}

export function createRun(options: CreateRunOptions = {}): GameDoc {
  const {
    seed = 204004,
    records = [],
    loadout = DEFAULT_HANGAR,
    runId,
  } = options;
  const safeLoadout: HangarConfig = validateHangar(loadout).ok
    ? structuredClone(loadout)
    : structuredClone(DEFAULT_HANGAR);
  const modifiers = toModifiers(safeLoadout);
  const maxHp = Math.round(100 * modifiers.maxHpMul);
  return {
    version: 2,
    seed,
    initialSeed: seed,
    nextId: 1,
    phase: "ready",
    time: 0,
    runId: runId ?? `${seed}-${Date.now().toString(36)}`,
    player: {
      x: 500,
      y: 325,
      hp: maxHp,
      maxHp,
      speed: Math.round(190 * modifiers.speedMul),
      radius: 12,
      invincible: 0,
    },
    enemies: [],
    bullets: [],
    drops: [],
    // 锁定的出发武器快照，全部以 Lv.1 进入新局。
    weapons: safeLoadout.weapons.map((id) => ({
      id,
      level: 1,
      cooldown: 0,
    })),
    upgrades: {},
    modifiers,
    lockedLoadout: safeLoadout,
    choices: [],
    xp: 0,
    level: 1,
    pendingLevels: 0,
    wave: 0,
    waveTime: 0,
    spawnBudget: 0,
    stats: {
      kills: 0,
      damage: 0,
      taken: 0,
      collected: 0,
      shots: 0,
      byWeapon: { pulse: 0, orbit: 0, nova: 0 },
    },
    records,
    settlement: null,
    settlementClaimed: false,
    settlementError: null,
    notice: "等待接入战场",
    victory: false,
  };
}
