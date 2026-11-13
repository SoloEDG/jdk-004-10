import type { GameDoc, SettlementInfo } from "../../../shared/types";

/**
 * 按已完成的行动结算可消费材料。
 * 基础击杀产出 + 波次推进奖励 + 撤离加成，只依赖本局快照数据。
 */
export function computeSettlement(doc: GameDoc): SettlementInfo {
  const kills = doc.stats.kills;
  const wave = Math.max(0, doc.wave);
  const victoryBonus = doc.victory ? 40 : 0;
  const materials = kills * 2 + wave * 8 + victoryBonus;
  return {
    runId: doc.runId,
    materials,
    basis: {
      kills,
      wave,
      victory: doc.victory,
      duration: Math.round(doc.time),
    },
    formula: `${kills} 击杀 ×2 + ${wave} 波 ×8${doc.victory ? " + 撤离 40" : ""}`,
  };
}

/** 该结算是否尚未写入本地档案（重复打开结算弹窗时据此幂等处理）。 */
export function isSettlementClaimable(
  info: SettlementInfo,
  claimedRuns: string[],
): boolean {
  return !claimedRuns.includes(info.runId);
}
