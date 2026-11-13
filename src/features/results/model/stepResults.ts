import type { GameDoc, FrameEvents } from "../../../shared/types";
import { applyEvents, makeRecord } from "./ledger";
import { computeSettlement } from "../../hangar";
export function stepResults(doc: GameDoc, events: FrameEvents): void {
  if (doc.phase === "ended") return;
  applyEvents(doc, events);
  if (doc.player.hp > 0 && !doc.victory) return;
  // End the run before persistence, making repeated animation frames idempotent.
  doc.phase = "ended";
  doc.choices = [];
  doc.notice = doc.victory ? "撤离成功 · 信号保全" : "信号中断 · 再次连接";
  const record = makeRecord(doc);
  // 结算信息在结束瞬间定格；材料入账由档案层按 runId 幂等处理。
  const settlement = computeSettlement(doc);
  record.materials = settlement.materials;
  doc.settlement = settlement;
  doc.records = [record, ...doc.records].slice(0, 20);
}
