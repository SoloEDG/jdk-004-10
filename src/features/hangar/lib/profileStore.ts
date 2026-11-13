import type {
  HangarConfig,
  MigrationEntry,
  ProfileDoc,
  RunRecord,
  SettlementInfo,
} from "../../../shared/types";
import {
  LEGACY_STORAGE_KEY,
  MAX_CLAIMED_RUNS,
  PROFILE_STORAGE_KEY,
  PROFILE_VERSION,
} from "../model/catalog";
import { DEFAULT_HANGAR, hangarCost, validateHangar } from "../model/rules";

/** 存储不可写（空间配额 / 隐私模式）时抛出，调用方据此保留内存余额并提示。 */
export class StorageQuotaError extends Error {
  constructor(message = "本地存储空间不足，写入被拒绝") {
    super(message);
    this.name = "StorageQuotaError";
  }
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultProfile(migrations: MigrationEntry[] = []): ProfileDoc {
  return {
    version: PROFILE_VERSION,
    materials: 0,
    hangar: structuredClone(DEFAULT_HANGAR),
    records: [],
    claimedRuns: [],
    migrations,
  };
}

function isRecord(value: unknown): value is RunRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as RunRecord;
  return (
    typeof r.id === "string" &&
    ["duration", "wave", "level", "kills", "damage"].every(
      (k) =>
        typeof r[k as keyof RunRecord] === "number" &&
        Number.isFinite(r[k as keyof RunRecord]),
    ) &&
    Array.isArray(r.weapons) &&
    r.weapons.every((w) => typeof w === "string") &&
    typeof r.victory === "boolean"
  );
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sanitizeHangar(value: unknown): HangarConfig {
  const check = validateHangar(value);
  return check.ok ? (value as HangarConfig) : structuredClone(DEFAULT_HANGAR);
}

/**
 * 档案迁移：旧版本缺少机库字段时，回填可追溯的默认配置，
 * 并在 migrations 中保留来源记录；损坏数据同样走默认值而非崩溃。
 */
export function migrateProfile(raw: unknown): ProfileDoc {
  // v1 档案是裸 RunRecord 数组。
  if (Array.isArray(raw)) {
    return {
      ...defaultProfile([
        {
          at: Date.now(),
          from: 1,
          reason: "v1 行动记录数组迁移为 v2 机库档案，机库与材料使用默认值",
        },
      ]),
      records: raw.filter(isRecord).slice(0, 20),
    };
  }
  if (!raw || typeof raw !== "object") return defaultProfile();
  const src = raw as Partial<ProfileDoc>;
  const migrations: MigrationEntry[] = Array.isArray(src.migrations)
    ? src.migrations.filter(
        (m) =>
          m &&
          typeof m.at === "number" &&
          typeof m.from === "number" &&
          typeof m.reason === "string",
      )
    : [];
  if (src.version !== PROFILE_VERSION) {
    migrations.push({
      at: Date.now(),
      from: typeof src.version === "number" ? src.version : 0,
      reason: `档案版本补齐为 v${PROFILE_VERSION}，缺失字段以默认配置回填`,
    });
  }
  const claimedRuns = Array.isArray(src.claimedRuns)
    ? src.claimedRuns.filter((id) => typeof id === "string").slice(-MAX_CLAIMED_RUNS)
    : [];
  return {
    version: PROFILE_VERSION,
    materials: isFiniteInt(src.materials) ? Math.floor(src.materials) : 0,
    hangar: sanitizeHangar(src.hangar),
    records: Array.isArray(src.records)
      ? src.records.filter(isRecord).slice(0, 20)
      : [],
    claimedRuns,
    migrations,
  };
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

/** 读取档案；v1 键存在时就地迁移并尝试写回新键、清理旧键。 */
export function loadProfile(storage?: StorageLike | null): ProfileDoc {
  const store = resolveStorage(storage);
  if (!store) return defaultProfile();
  try {
    const current = store.getItem(PROFILE_STORAGE_KEY);
    if (current !== null) return migrateProfile(JSON.parse(current));
    const legacy = store.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      const profile = migrateProfile(JSON.parse(legacy));
      try {
        store.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
        store.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // 迁移写回失败不影响本次游玩，下一次读取仍可从旧键迁移。
      }
      return profile;
    }
    return defaultProfile();
  } catch {
    return defaultProfile();
  }
}

/** 整档写回；任何存储异常统一转成 StorageQuotaError，保证调用方不会半写。 */
export function persistProfile(
  profile: ProfileDoc,
  storage?: StorageLike | null,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // 底层原因可能是配额、隐私模式或序列化限制，统一归类为存储不可写。
    throw new StorageQuotaError();
  }
}

export interface PurchaseResult {
  ok: boolean;
  profile: ProfileDoc;
  cost: number;
  errors: string[];
}

/**
 * 机库装配购买：先校验规则与余额，再整档原子写回。
 * 写回失败时原档案（含余额）原样返回，绝不出现材料已扣但装配未保存。
 */
export function purchaseHangar(
  profile: ProfileDoc,
  config: HangarConfig,
  storage?: StorageLike | null,
): PurchaseResult {
  const check = validateHangar(config);
  if (!check.ok) return { ok: false, profile, cost: 0, errors: check.errors };
  const cost = hangarCost(config);
  if (profile.materials < cost) {
    return {
      ok: false,
      profile,
      cost,
      errors: [`材料不足：装配需要 ${cost}，当前余额 ${profile.materials}`],
    };
  }
  const next: ProfileDoc = {
    ...profile,
    materials: profile.materials - cost,
    hangar: structuredClone(config),
  };
  try {
    persistProfile(next, storage);
  } catch (err) {
    return {
      ok: false,
      profile,
      cost,
      errors: [
        err instanceof StorageQuotaError
          ? err.message
          : "档案写入失败，余额未扣除",
      ],
    };
  }
  return { ok: true, profile: next, cost, errors: [] };
}

export interface ClaimResult {
  ok: boolean;
  profile: ProfileDoc;
  gain: number;
  duplicated: boolean;
  error?: string;
}

/**
 * 结算材料写回本地档案。
 * runId 去重保证重复打开结算不会重复领取；先写存储后改内存，
 * 存储失败时余额保持不变并返回可重试的错误。
 */
export function claimSettlement(
  profile: ProfileDoc,
  settlement: SettlementInfo,
  record: RunRecord,
  storage?: StorageLike | null,
): ClaimResult {
  if (profile.claimedRuns.includes(settlement.runId)) {
    return { ok: true, profile, gain: 0, duplicated: true };
  }
  const next: ProfileDoc = {
    ...profile,
    materials: profile.materials + settlement.materials,
    claimedRuns: [...profile.claimedRuns, settlement.runId].slice(
      -MAX_CLAIMED_RUNS,
    ),
    records: mergeRecord(profile.records, {
      ...record,
      materials: settlement.materials,
    }),
  };
  try {
    persistProfile(next, storage);
  } catch (err) {
    return {
      ok: false,
      profile,
      gain: 0,
      duplicated: false,
      error:
        err instanceof StorageQuotaError
          ? err.message
          : "档案写入失败，材料未入账",
    };
  }
  return { ok: true, profile: next, gain: settlement.materials, duplicated: false };
}

function mergeRecord(records: RunRecord[], record: RunRecord): RunRecord[] {
  const rest = records.filter((r) => r.id !== record.id);
  return [record, ...rest].slice(0, 20);
}
