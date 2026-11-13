import { useEffect, useRef, useState } from "react";
import { createRun } from "../shared/createRun";
import type {
  GameDoc,
  HangarConfig,
  Input,
  ProfileDoc,
  RunRecord,
  SettlementInfo,
} from "../shared/types";
import { simulate } from "./simulate";
import { chooseUpgrade } from "../features/progression";
import {
  claimSettlement,
  loadProfile,
  purchaseHangar,
} from "../features/hangar";

interface PendingClaim {
  settlement: SettlementInfo;
  record: RunRecord;
}

export function useGame() {
  const profile = useRef<ProfileDoc>(loadProfile());
  const game = useRef(
    createRun({ records: profile.current.records, loadout: profile.current.hangar }),
  );
  // 存储失败的结算进入队列，存储恢复后自动补写，跨局不丢失。
  const pendingClaims = useRef<PendingClaim[]>([]);
  const input = useRef<Input>({
    x: 0,
    y: 0,
    aim: { x: 500, y: 0 },
    firing: false,
  });
  const keys = useRef(new Set<string>());
  const [, render] = useState(0);
  const bump = () => render((n) => n + 1);

  /** 重试此前写入失败的结算；成功的出队，失败的保留余额与条目。 */
  const flushPendingClaims = () => {
    if (!pendingClaims.current.length) return;
    const remaining: PendingClaim[] = [];
    let changed = false;
    for (const claim of pendingClaims.current) {
      const result = claimSettlement(
        profile.current,
        claim.settlement,
        claim.record,
      );
      if (result.ok) {
        profile.current = result.profile;
        changed = true;
      } else remaining.push(claim);
    }
    if (changed) {
      // 补写成功后把档案记录同步回当前局，保持行动档案面板一致。
      game.current.records = profile.current.records;
      bump();
    }
    pendingClaims.current = remaining;
  };

  /**
   * 结算入账：runId 去重，存储失败保留余额并入队等待重试；
   * 重复触发不会重复发材料。
   */
  const settleIfDue = () => {
    flushPendingClaims();
    const d = game.current;
    if (d.phase !== "ended" || !d.settlement || d.settlementClaimed) return;
    const record = d.records.find((r) => r.id === d.settlement!.runId);
    if (!record) return;
    const result = claimSettlement(profile.current, d.settlement, record);
    if (result.ok) {
      profile.current = result.profile;
      d.settlementClaimed = true;
      d.settlementError = null;
    } else {
      d.settlementError = result.error ?? "材料入账失败，请重试";
      const queued = pendingClaims.current.some(
        (c) => c.settlement.runId === d.settlement!.runId,
      );
      if (!queued)
        pendingClaims.current.push({ settlement: d.settlement, record });
    }
    bump();
  };

  useEffect(() => {
    let raf = 0,
      last = 0,
      acc = 0,
      paint = 0;
    const tick = (now: number) => {
      const elapsed = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      const d = game.current;
      input.current.x =
        Number(keys.current.has("d") || keys.current.has("arrowright")) -
        Number(keys.current.has("a") || keys.current.has("arrowleft"));
      input.current.y =
        Number(keys.current.has("s") || keys.current.has("arrowdown")) -
        Number(keys.current.has("w") || keys.current.has("arrowup"));
      if (d.phase === "playing") {
        acc += elapsed;
        while (acc >= 1 / 60) {
          simulate(d, input.current, 1 / 60);
          acc -= 1 / 60;
          if (d.phase !== "playing") {
            acc = 0;
            break;
          }
        }
      } else acc = 0;
      // 每帧补写历史失败结算；行动结束的当帧尝试本局材料入账。
      flushPendingClaims();
      if (d.phase === "ended") settleIfDue();
      if (now - paint > 32) {
        bump();
        paint = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const pause = () => {
      if (game.current.phase === "playing") game.current.phase = "paused";
      keys.current.clear();
      input.current.firing = false;
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k))
        e.preventDefault();
      keys.current.add(k);
      if ((k === "escape" || k === "p") && !e.repeat) {
        const d = game.current;
        if (d.phase === "playing") d.phase = "paused";
        else if (d.phase === "paused") d.phase = "playing";
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const hidden = () => {
      if (document.hidden) pause();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", hidden);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    game,
    profile,
    input,
    start: () => {
      const d = game.current;
      if (d.phase !== "ready") return;
      // 出发即锁定：用档案中的当前机库重新生成本局快照，
      // 武器与机体参数一并定格；战斗中再改机库不影响本局。
      if (
        JSON.stringify(d.lockedLoadout) !==
        JSON.stringify(profile.current.hangar)
      ) {
        game.current = createRun({
          records: profile.current.records,
          loadout: profile.current.hangar,
        });
      }
      game.current.phase = "playing";
    },
    toggle: () => {
      const d = game.current;
      if (d.phase === "playing") d.phase = "paused";
      else if (d.phase === "paused") d.phase = "playing";
    },
    choose: (id: string) => chooseUpgrade(game.current, id),
    /** 机库装配：校验通过且写档成功后才扣款，失败返回错误信息。 */
    saveHangar: (config: HangarConfig) => {
      const result = purchaseHangar(profile.current, config);
      if (result.ok) {
        profile.current = result.profile;
        bump();
      }
      return result;
    },
    retryClaim: () => {
      settleIfDue();
    },
    restart: () => {
      // 新局重新从档案取机库与记录，确保上一局的入账结果已反映在余额里。
      settleIfDue();
      game.current = createRun({
        records: profile.current.records,
        loadout: profile.current.hangar,
      });
      keys.current.clear();
      game.current.phase = "playing";
      bump();
    },
  };
}
