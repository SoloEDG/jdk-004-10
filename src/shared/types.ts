export type Vec = { x: number; y: number };
export type Phase = "ready" | "playing" | "paused" | "upgrade" | "ended";
export type WeaponId = "pulse" | "orbit" | "nova";
export type ModId =
  | "reinforced-frame"
  | "stripped-frame"
  | "overdrive-frame"
  | "shield-core"
  | "ammo-core"
  | "cooling-core";
export type ModMutexGroup = "frame" | "core";
export interface HangarConfig {
  weapons: WeaponId[];
  modIds: ModId[];
}
export interface ModifierState {
  damageMul: number;
  maxHpMul: number;
  speedMul: number;
  armorFlat: number;
  cooldownMul: number;
}
export interface SettlementInfo {
  runId: string;
  materials: number;
  basis: { kills: number; wave: number; victory: boolean; duration: number };
  formula: string;
}
export interface MigrationEntry {
  at: number;
  from: number;
  reason: string;
}
export interface ProfileDoc {
  version: 2;
  materials: number;
  hangar: HangarConfig;
  records: RunRecord[];
  claimedRuns: string[];
  migrations: MigrationEntry[];
}
export interface Player extends Vec {
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  invincible: number;
}
export interface Enemy extends Vec {
  id: number;
  kind: "chaser" | "shooter" | "elite";
  hp: number;
  maxHp: number;
  radius: number;
  cooldown: number;
}
export interface Bullet extends Vec {
  id: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  owner: "player" | "enemy";
  weapon: WeaponId | "enemy";
  pierce: number;
  hit: number[];
}
export interface Drop extends Vec {
  id: number;
  kind: "xp" | "heal" | "magnet";
  value: number;
  life: number;
}
export interface Weapon {
  id: WeaponId;
  level: number;
  cooldown: number;
}
export interface Upgrade {
  id: string;
  name: string;
  description: string;
  category: string;
  max: number;
}
export interface RunStats {
  kills: number;
  damage: number;
  taken: number;
  collected: number;
  shots: number;
  byWeapon: Record<WeaponId, number>;
}
export interface RunRecord {
  id: string;
  duration: number;
  wave: number;
  level: number;
  kills: number;
  damage: number;
  weapons: string[];
  victory: boolean;
  materials?: number;
}
export interface GameDoc {
  version: 2;
  seed: number;
  initialSeed: number;
  nextId: number;
  phase: Phase;
  time: number;
  runId: string;
  player: Player;
  enemies: Enemy[];
  bullets: Bullet[];
  drops: Drop[];
  weapons: Weapon[];
  upgrades: Record<string, number>;
  modifiers: ModifierState;
  lockedLoadout: HangarConfig;
  choices: string[];
  xp: number;
  level: number;
  pendingLevels: number;
  wave: number;
  waveTime: number;
  spawnBudget: number;
  stats: RunStats;
  records: RunRecord[];
  settlement: SettlementInfo | null;
  settlementClaimed: boolean;
  settlementError: string | null;
  notice: string;
  victory: boolean;
}
export interface Input {
  x: number;
  y: number;
  aim: Vec;
  firing: boolean;
}
export interface KillEvent {
  enemy: Enemy;
  weapon: WeaponId;
}
export interface FrameEvents {
  weaponDamage?: Partial<Record<WeaponId, number>>;
  kills: KillEvent[];
  damage: number;
  taken: number;
  shots: number;
  collected: number;
}
export const WIDTH = 1000;
export const HEIGHT = 650;
