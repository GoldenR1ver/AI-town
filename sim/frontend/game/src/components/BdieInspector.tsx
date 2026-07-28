import type { AgentState, IntentionRecord } from "@shared/types";
import type { ReplayStep, ReplayWorldState } from "@shared/replay/types";

interface BdieInspectorProps {
  state: ReplayWorldState;
  previousState: ReplayWorldState;
  step: ReplayStep;
  selectedAgentId: string;
  pinned: boolean;
  onSelectAgent: (agentId: string) => void;
  onTogglePin: () => void;
}

function compactKey(key: string): string {
  return key
    .replace(/^event:/, "事件 ")
    .replace(/^goal:/, "目标 ")
    .replace(/^desire:/, "")
    .replace(/^repay:/, "回礼 ")
    .replace(/^gift_defaulted:/, "违约 ")
    .replace(/^untrustworthy:/, "不信任 ");
}

function changedNumericKeys(
  current: Record<string, number>,
  previous: Record<string, number>,
): Set<string> {
  return new Set(
    uniqueKeys(current, previous).filter(
      (key) => Math.abs((current[key] ?? 0) - (previous[key] ?? 0)) > 1e-9,
    ),
  );
}

function uniqueKeys(...records: Array<Record<string, unknown>>): string[] {
  return [
    ...new Set(
      records
        .flatMap((record) => Object.keys(record))
        .filter((key) => !key.startsWith("__")),
    ),
  ];
}

function bagSize(record: Record<string, unknown>): number {
  const meta = record.__count;
  if (typeof meta === "number") return meta;
  return Object.keys(record).filter((key) => !key.startsWith("__")).length;
}

function deltaLabel(current: number, previous: number): string {
  const delta = current - previous;
  if (Math.abs(delta) < 1e-9) return "";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(Math.abs(delta) < 1 ? 3 : 1)}`;
}

function NumericStateList({
  values,
  previous,
  emptyText,
}: {
  values: Record<string, number>;
  previous: Record<string, number>;
  emptyText: string;
}) {
  const changed = changedNumericKeys(values, previous);
  const entries = Object.entries(values)
    .filter(([key]) => !key.startsWith("__"))
    .sort((left, right) => {
      const changedOrder = Number(changed.has(right[0])) - Number(changed.has(left[0]));
      return changedOrder || right[1] - left[1];
    })
    .slice(0, 7);
  if (!entries.length) {
    const size = bagSize(values);
    if (size > 0) {
      return <p className="empty-state">详情已精简（共 {size} 项）</p>;
    }
    return <p className="empty-state">{emptyText}</p>;
  }
  return (
    <div className="state-bars">
      {entries.map(([key, value]) => {
        const delta = deltaLabel(value, previous[key] ?? 0);
        return (
          <div className={`state-bar ${changed.has(key) ? "is-changed" : ""}`} key={key}>
            <div>
              <span title={key}>{compactKey(key)}</span>
              <strong>
                {value.toFixed(2)}
                {delta && <em className={delta.startsWith("+") ? "positive" : "negative"}>{delta}</em>}
              </strong>
            </div>
            <i>
              <b style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
            </i>
          </div>
        );
      })}
    </div>
  );
}

function IntentionsList({
  intentions,
  previous,
}: {
  intentions: Record<string, IntentionRecord>;
  previous: Record<string, IntentionRecord>;
}) {
  const entries = Object.entries(intentions)
    .sort((left, right) => (right[1].priority ?? 0) - (left[1].priority ?? 0))
    .slice(0, 6);
  if (!entries.length) return <p className="empty-state">当前没有可执行意图</p>;
  return (
    <div className="intentions-list">
      {entries.map(([key, intention]) => {
        const changed =
          !previous[key] ||
          JSON.stringify(previous[key]) !== JSON.stringify(intention);
        return (
          <div className={changed ? "is-changed" : ""} key={key}>
            <span>{compactKey(key)}</span>
            <strong>P{intention.priority ?? "—"}</strong>
            <small>
              {intention.actionType ?? "custom"}
              {intention.slotDue
                ? ` · D${intention.slotDue.day}-${intention.slotDue.slot}`
                : ""}
            </small>
          </div>
        );
      })}
    </div>
  );
}

function EmotionMeters({
  current,
  previous,
}: {
  current: AgentState["private"]["emotion"];
  previous: AgentState["private"]["emotion"];
}) {
  const labels: Record<keyof typeof current, string> = {
    mood: "心境",
    arousal: "唤醒",
    stress: "压力",
    energy: "精力",
  };
  return (
    <div className="emotion-grid">
      {(Object.keys(labels) as Array<keyof typeof current>).map((key) => {
        const delta = deltaLabel(current[key], previous[key]);
        return (
          <div className={delta ? "is-changed" : ""} key={key}>
            <span>{labels[key]}</span>
            <strong>{Math.round(current[key] * 100)}</strong>
            <i>
              <b style={{ width: `${Math.max(0, Math.min(1, current[key])) * 100}%` }} />
            </i>
            {delta && (
              <em className={delta.startsWith("+") ? "positive" : "negative"}>{delta}</em>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  previous,
  currency = false,
}: {
  label: string;
  value: number;
  previous: number;
  currency?: boolean;
}) {
  const delta = deltaLabel(value, previous);
  return (
    <div className={delta ? "profile-stat is-changed" : "profile-stat"}>
      <span>{label}</span>
      <strong>
        {currency ? "¥" : ""}
        {Number.isInteger(value) ? value : value.toFixed(1)}
      </strong>
      {delta && <em className={delta.startsWith("+") ? "positive" : "negative"}>{delta}</em>}
    </div>
  );
}

export function BdieInspector({
  state,
  previousState,
  selectedAgentId,
  pinned,
  onSelectAgent,
  onTogglePin,
}: BdieInspectorProps) {
  const fallbackId = Object.keys(state.agents)[0] ?? "";
  const agentId = selectedAgentId || fallbackId;
  const agent = state.agents[agentId];
  const previousAgent = previousState.agents[agentId] ?? agent;
  if (!agent || !previousAgent) return null;
  const gifts = state.giftLedger
    .filter((gift) => gift.from === agentId || gift.to === agentId)
    .slice(-5)
    .reverse();
  const cognitive = state.cognitiveSummary[agentId];

  return (
    <section className="bdie-panel pixel-panel">
      <div className="inspector-select">
        <label>
          <span className="eyebrow">AGENT INSPECTOR</span>
          <select
            value={agentId}
            onChange={(event) => onSelectAgent(event.target.value)}
          >
            {Object.values(state.agents).map((candidate) => (
              <option key={candidate.public.id} value={candidate.public.id}>
                {candidate.public.id} · {candidate.public.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`pin-button ${pinned ? "is-pinned" : ""}`}
          onClick={onTogglePin}
          title={pinned ? "取消固定，跟随当前事件" : "固定此 Agent"}
          aria-pressed={pinned}
        >
          {pinned ? "已固定" : "跟随事件"}
        </button>
      </div>

      <div className="profile-card">
        <div className="profile-avatar">{agent.public.name.slice(0, 1)}</div>
        <div>
          <h2>{agent.public.name}</h2>
          <p>
            {agent.public.occupation} · {agent.public.age ?? "?"} 岁 · {agentId}
          </p>
          <small>{agent.public.socialTags?.join(" / ") || "村民"}</small>
        </div>
      </div>

      <div className="profile-stats">
        <Stat
          label="现金"
          value={agent.economy.cash}
          previous={previousAgent.economy.cash}
          currency
        />
        <Stat
          label="脸面"
          value={agent.public.face ?? 50}
          previous={previousAgent.public.face ?? 50}
        />
        <Stat
          label="声望"
          value={agent.public.prestige ?? agent.public.face ?? 50}
          previous={previousAgent.public.prestige ?? previousAgent.public.face ?? 50}
        />
        <Stat
          label="礼债"
          value={state.relationships
            .filter((edge) => edge.from === agentId)
            .reduce((sum, edge) => sum + edge.giftDebt, 0)}
          previous={previousState.relationships
            .filter((edge) => edge.from === agentId)
            .reduce((sum, edge) => sum + edge.giftDebt, 0)}
        />
      </div>

      <div className="bdie-section emotion-section">
        <div className="section-title">
          <h3>E · Emotion</h3>
          <span>本步变化会闪烁</span>
        </div>
        <EmotionMeters
          current={agent.private.emotion}
          previous={previousAgent.private.emotion}
        />
      </div>

      <div className="bdie-columns">
        <div className="bdie-section">
          <div className="section-title">
            <h3>B · Beliefs</h3>
            <span>{bagSize(agent.private.beliefs)}</span>
          </div>
          <NumericStateList
            values={agent.private.beliefs}
            previous={previousAgent.private.beliefs}
            emptyText="尚未形成事件信念"
          />
        </div>
        <div className="bdie-section">
          <div className="section-title">
            <h3>D · Desires</h3>
            <span>{bagSize(agent.private.desires)}</span>
          </div>
          <NumericStateList
            values={agent.private.desires}
            previous={previousAgent.private.desires}
            emptyText="当前没有显式欲望"
          />
        </div>
      </div>

      <div className="bdie-section">
        <div className="section-title">
          <h3>I · Intentions</h3>
          <span>{Object.keys(agent.private.intentions).length}</span>
        </div>
        <IntentionsList
          intentions={agent.private.intentions}
          previous={previousAgent.private.intentions}
        />
      </div>

      <div className="inspector-foot">
        <div>
          <span>PET</span>
          <strong>{state.petCounts[agentId] ?? 0}</strong>
        </div>
        <div>
          <span>认知节点</span>
          <strong>{cognitive?.active ?? 0}</strong>
        </div>
        <div>
          <span>关系层</span>
          <strong>{cognitive?.relation ?? 0}</strong>
        </div>
        <div>
          <span>相关礼物</span>
          <strong>{gifts.length}</strong>
        </div>
      </div>

      <div className="gift-mini-list">
        {gifts.length ? (
          gifts.map((gift) => (
            <div key={gift.gid}>
              <span>
                {gift.from} → {gift.to}
              </span>
              <strong>¥{gift.value}</strong>
              <i className={`gift-status status-${gift.status}`}>{gift.status}</i>
            </div>
          ))
        ) : (
          <p className="empty-state">暂无相关礼单</p>
        )}
      </div>
    </section>
  );
}
