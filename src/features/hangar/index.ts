export {
  MOD_CATALOG,
  MOD_BY_ID,
  MOD_GROUPS,
  WEAPON_COST,
  SURVIVAL_LIMITS,
  BASE_STATS,
  MAX_WEAPONS,
} from "./model/catalog";
export type { ModDefinition } from "./model/catalog";
export {
  DEFAULT_HANGAR,
  hangarCost,
  previewStats,
  toModifiers,
  validateHangar,
} from "./model/rules";
export type { EffectiveStats, ValidationResult } from "./model/rules";
export { computeSettlement, isSettlementClaimable } from "./model/settlement";
export {
  loadProfile,
  persistProfile,
  purchaseHangar,
  claimSettlement,
  migrateProfile,
  StorageQuotaError,
} from "./lib/profileStore";
export type {
  StorageLike,
  PurchaseResult,
  ClaimResult,
} from "./lib/profileStore";
export { HangarPanel } from "./ui/HangarPanel";
