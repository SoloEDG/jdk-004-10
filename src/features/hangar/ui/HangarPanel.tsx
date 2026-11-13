import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cog,
  Coins,
  Lock,
  Shield,
  Swords,
  X,
  Zap,
} from "lucide-react";
import type {
  GameDoc,
  HangarConfig,
  ModId,
  ProfileDoc,
  WeaponId,
} from "../../../shared/types";
import {
  MAX_WEAPONS,
  MOD_BY_ID,
  MOD_CATALOG,
  MOD_GROUPS,
  SURVIVAL_LIMITS,
  WEAPON_COST,
  hangarCost,
  previewStats,
  validateHangar,
  type PurchaseResult,
} from "../index";
import { WEAPON_CATALOG } from "../../arsenal";

const WEAPON_GLYPH: Record<WeaponId, string> = {
  pulse: "⌁",
  orbit: "◎",
  nova: "✳",
};

const GROUP_LABEL: Record<string, string> = {
  frame: "机架槽位 · 互斥单选",
  core: "核心槽位 · 互斥单选",
};

export function HangarPanel({
  profile,
  doc,
  onSave,
  close,
}: {
  profile: ProfileDoc;
  doc: GameDoc;
  onSave: (config: HangarConfig) => PurchaseResult;
  close: () => void;
}) {
  const [draft, setDraft] = useState<HangarConfig>(() =>
    structuredClone(profile.hangar),
  );
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    messages: string[];
  } | null>(null);

  // 行动进行中只允许查看：出发配置已锁定，避免战斗中无成本换装。
  const locked = doc.phase === "playing" || doc.phase === "upgrade";
  const check = useMemo(() => validateHangar(draft), [draft]);
  const stats = useMemo(() => previewStats(draft), [draft]);
  const cost = useMemo(() => hangarCost(draft), [draft]);
  const affordable = profile.materials >= cost;

  const toggleWeapon = (id: WeaponId) => {
    if (locked) return;
    setFeedback(null);
    setDraft((prev) => {
      const has = prev.weapons.includes(id);
      if (has) return { ...prev, weapons: prev.weapons.filter((w) => w !== id) };
      if (prev.weapons.length >= MAX_WEAPONS) return prev;
      return { ...prev, weapons: [...prev.weapons, id] };
    });
  };

  const toggleMod = (id: ModId) => {
    if (locked) return;
    setFeedback(null);
    const group = MOD_BY_ID[id].group;
    setDraft((prev) => {
      const has = prev.modIds.includes(id);
      const others = prev.modIds.filter((m) => MOD_BY_ID[m].group !== group);
      return { ...prev, modIds: has ? others : [...others, id] };
    });
  };

  const save = () => {
    const result = onSave(draft);
    setFeedback({
      ok: result.ok,
      messages: result.ok
        ? [`装配已保存，消耗材料 ${result.cost}`]
        : result.errors,
    });
  };

  return (
    <div className="overlay hangar-overlay">
      <div className="hangar-dialog">
        <div className="hangar-head">
          <div>
            <div className="eyebrow">HANGAR BAY / DEPLOYMENT LOADOUT</div>
            <h2>
              <Cog size={22} /> 局外机库
            </h2>
          </div>
          <div className="hangar-head-right">
            <span className="materials-pill">
              <Coins size={15} />
              <b className="mono">{profile.materials}</b> 材料
            </span>
            <button className="close" onClick={close}>
              关闭 ✕
            </button>
          </div>
        </div>

        {locked && (
          <div className="hangar-lock-banner">
            <Lock size={15} />
            出发配置已在行动开始时锁定，机库修改将在下一局生效
          </div>
        )}

        <div className="hangar-body">
          <div className="hangar-col">
            <div className="section-caption">
              <span>
                <Swords size={14} /> 初始武器
              </span>
              <span className="mono muted">
                {draft.weapons.length} / {MAX_WEAPONS}
              </span>
            </div>
            <div className="hangar-weapons">
              {(Object.keys(WEAPON_CATALOG) as WeaponId[]).map((id) => {
              const selected = draft.weapons.includes(id);
              const disabled =
                !selected && draft.weapons.length >= MAX_WEAPONS;
              return (
                <button
                  key={id}
                  className={`hangar-card weapon-card ${selected ? "selected" : ""} ${disabled ? "dimmed" : ""}`}
                  onClick={() => toggleWeapon(id)}
                  disabled={locked || disabled}
                >
                  <span className={`weapon-icon ${id}`}>
                    {WEAPON_GLYPH[id]}
                  </span>
                  <div className="hangar-card-text">
                    <strong>{WEAPON_CATALOG[id].name}</strong>
                    <small>{WEAPON_CATALOG[id].description}</small>
                  </div>
                  <span className="cost-tag mono">
                    {WEAPON_COST[id] === 0 ? "标配" : `${WEAPON_COST[id]} ◈`}
                  </span>
                  {selected && (
                    <span className="check-badge">
                      <Check size={13} />
                    </span>
                  )}
                </button>
              );
            })}
            </div>

            {MOD_GROUPS.map((group) => (
              <div key={group} className="mod-group">
                <div className="section-caption">
                  <span>
                    <Shield size={14} /> {GROUP_LABEL[group]}
                  </span>
                </div>
                <div className="hangar-mods">
                  {MOD_CATALOG.filter((m) => m.group === group).map((m) => {
                    const selected = draft.modIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        className={`hangar-card mod-card ${selected ? "selected" : ""}`}
                        onClick={() => toggleMod(m.id)}
                        disabled={locked}
                      >
                        <div className="hangar-card-text">
                          <strong>{m.name}</strong>
                          <small>{m.description}</small>
                        </div>
                        <span className="cost-tag mono">{m.cost} ◈</span>
                        {selected && (
                          <span className="check-badge">
                            <Check size={13} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <aside className="hangar-col hangar-preview">
            <div className="section-caption">
              <span>
                <Zap size={14} /> 有效参数预览
              </span>
              <span className="mono muted">下一局出发时</span>
            </div>
            <div className="preview-grid">
              <PreviewRow
                label="生命上限"
                value={`${stats.maxHp}`}
                warn={stats.maxHp < SURVIVAL_LIMITS.maxHp}
                hint={`下限 ${SURVIVAL_LIMITS.maxHp}`}
              />
              <PreviewRow
                label="移动速度"
                value={`${stats.speed}`}
                warn={stats.speed < SURVIVAL_LIMITS.speed}
                hint={`下限 ${SURVIVAL_LIMITS.speed}`}
              />
              <PreviewRow
                label="武器伤害"
                value={`×${stats.damageMul.toFixed(2)}`}
              />
              <PreviewRow
                label="武器射速"
                value={`×${(1 / stats.cooldownMul).toFixed(2)}`}
              />
              <PreviewRow
                label="装甲等级"
                value={`${stats.armorFlat} 级`}
                hint={stats.armorFlat ? "受伤 -12% / 级" : "无"}
              />
            </div>

            <div className="cost-summary">
              <span>装配费用</span>
              <strong className={`mono ${affordable ? "" : "insufficient"}`}>
                {cost} ◈
              </strong>
            </div>
            <div className="cost-summary">
              <span>保存后余额</span>
              <strong className="mono">
                {affordable ? profile.materials - cost : profile.materials} ◈
              </strong>
            </div>

            {!check.ok && (
              <ul className="hangar-errors">
                {check.errors.map((e) => (
                  <li key={e}>
                    <AlertTriangle size={13} /> {e}
                  </li>
                ))}
              </ul>
            )}
            {feedback && (
              <div
                className={`hangar-feedback ${feedback.ok ? "ok" : "fail"}`}
              >
                {feedback.messages.map((m) => (
                  <span key={m}>
                    {feedback.ok ? <Check size={13} /> : <AlertTriangle size={13} />}{" "}
                    {m}
                  </span>
                ))}
              </div>
            )}

            <button
              className="primary hangar-save"
              disabled={locked || !check.ok || !affordable}
              onClick={save}
            >
              校验并保存出发配置
            </button>
            {!affordable && check.ok && (
              <small className="insufficient-hint">
                材料不足，完成行动结算可获得材料
              </small>
            )}
            <button className="outline hangar-cancel" onClick={close}>
              <X size={14} /> 暂不保存
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  warn,
  hint,
}: {
  label: string;
  value: string;
  warn?: boolean;
  hint?: string;
}) {
  return (
    <div className={`preview-row ${warn ? "warn" : ""}`}>
      <span>{label}</span>
      <div>
        <strong className="mono">{value}</strong>
        {warn && <AlertTriangle size={13} />}
        {hint && <small>{hint}</small>}
      </div>
    </div>
  );
}
