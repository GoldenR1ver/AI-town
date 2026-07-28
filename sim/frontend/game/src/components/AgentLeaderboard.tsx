import type { AgentState, GiftRecord } from "@shared/types";
import type { ReplayWorldState } from "@shared/replay/types";
import { useMemo, useState } from "react";

export type LeaderboardSortKey =
  | "prestige"
  | "face"
  | "reputation"
  | "cash"
  | "wealth"
  | "debt"
  | "income"
  | "mood"
  | "stress"
  | "energy"
  | "valueIn"
  | "valueOut"
  | "netGift"
  | "defaults"
  | "occupation"
  | "name";

interface AgentLeaderboardProps {
  state: ReplayWorldState;
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
}

interface RankRow {
  id: string;
  name: string;
  occupation: string;
  prestige: number;
  face: number;
  reputation: number;
  cash: number;
  wealth: number;
  debt: number;
  income: number;
  mood: number;
  stress: number;
  energy: number;
  valueIn: number;
  valueOut: number;
  netGift: number;
  defaults: number;
}

const SORT_OPTIONS: { key: LeaderboardSortKey; label: string }[] = [
  { key: "prestige", label: "声望" },
  { key: "face", label: "脸面" },
  { key: "reputation", label: "声誉" },
  { key: "cash", label: "现金" },
  { key: "wealth", label: "总资产" },
  { key: "debt", label: "负债" },
  { key: "income", label: "收入" },
  { key: "mood", label: "心情" },
  { key: "stress", label: "压力" },
  { key: "energy", label: "精力" },
  { key: "valueIn", label: "收礼额" },
  { key: "valueOut", label: "送礼额" },
  { key: "netGift", label: "净收礼" },
  { key: "defaults", label: "违约次数" },
  { key: "occupation", label: "职业" },
  { key: "name", label: "姓名" },
];

function buildRows(
  agents: Record<string, AgentState>,
  gifts: GiftRecord[],
): RankRow[] {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  const defaults = new Map<string, number>();
  for (const gift of gifts) {
    inflow.set(gift.to, (inflow.get(gift.to) ?? 0) + gift.value);
    outflow.set(gift.from, (outflow.get(gift.from) ?? 0) + gift.value);
    if (gift.status === "defaulted") {
      defaults.set(gift.to, (defaults.get(gift.to) ?? 0) + 1);
    }
  }
  return Object.values(agents).map((agent) => {
    const id = agent.public.id;
    const cash = agent.economy.cash;
    const deposit = agent.economy.deposit;
    const valueIn = inflow.get(id) ?? 0;
    const valueOut = outflow.get(id) ?? 0;
    return {
      id,
      name: agent.public.name,
      occupation: agent.public.occupation,
      prestige: agent.public.prestige ?? 50,
      face: agent.public.face ?? 50,
      reputation: agent.public.reputation ?? 50,
      cash,
      wealth: cash + deposit,
      debt: agent.economy.debt,
      income: agent.economy.income,
      mood: agent.private.emotion.mood,
      stress: agent.private.emotion.stress,
      energy: agent.private.emotion.energy,
      valueIn,
      valueOut,
      netGift: valueIn - valueOut,
      defaults: defaults.get(id) ?? 0,
    };
  });
}

function sortValue(row: RankRow, key: LeaderboardSortKey): number | string {
  if (key === "occupation" || key === "name") return row[key];
  return row[key];
}

function formatSortValue(row: RankRow, key: LeaderboardSortKey): string {
  switch (key) {
    case "occupation":
      return row.occupation;
    case "name":
      return row.name;
    case "cash":
    case "wealth":
    case "debt":
    case "income":
    case "valueIn":
    case "valueOut":
    case "netGift":
      return `¥${Math.round(row[key]).toLocaleString()}`;
    case "mood":
    case "stress":
    case "energy":
      return row[key].toFixed(2);
    case "defaults":
      return String(row.defaults);
    default:
      return row[key].toFixed(1);
  }
}

export function AgentLeaderboard({
  state,
  selectedAgentId,
  onSelectAgent,
}: AgentLeaderboardProps) {
  const [sortKey, setSortKey] = useState<LeaderboardSortKey>("prestige");
  const [ascending, setAscending] = useState(false);
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () => buildRows(state.agents, state.giftLedger),
    [state.agents, state.giftLedger],
  );

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (row) =>
            row.name.toLowerCase().includes(q) ||
            row.id.toLowerCase().includes(q) ||
            row.occupation.toLowerCase().includes(q),
        )
      : rows;
    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      let cmp = 0;
      if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv, "zh");
      } else {
        cmp = Number(av) - Number(bv);
      }
      if (cmp === 0) cmp = a.id.localeCompare(b.id);
      return ascending ? cmp : -cmp;
    });
    return sorted;
  }, [rows, sortKey, ascending, query]);

  const sortLabel = SORT_OPTIONS.find((opt) => opt.key === sortKey)?.label ?? sortKey;

  return (
    <section className="leaderboard-panel pixel-panel">
      <div className="panel-heading compact">
        <div>
          <span className="eyebrow">RANKING</span>
          <h2>村民排序</h2>
        </div>
        <div className="graph-legend">
          <span>
            {ranked.length}/{rows.length}人
          </span>
          <span>
            按{sortLabel}
            {ascending ? "↑" : "↓"}
          </span>
        </div>
      </div>

      <div className="leaderboard-toolbar">
        <label className="leaderboard-sort">
          排序
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as LeaderboardSortKey)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="leaderboard-dir"
          onClick={() => setAscending((value) => !value)}
          title={ascending ? "切换为降序" : "切换为升序"}
        >
          {ascending ? "升序 ↑" : "降序 ↓"}
        </button>
        <input
          className="leaderboard-search"
          type="search"
          placeholder="搜姓名/职业/id"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="leaderboard-list" role="list">
        {ranked.map((row, index) => {
          const selected = row.id === selectedAgentId;
          return (
            <button
              type="button"
              role="listitem"
              key={row.id}
              className={`leaderboard-row ${selected ? "is-selected" : ""}`}
              onClick={() => onSelectAgent(row.id)}
            >
              <span className="leaderboard-rank">#{index + 1}</span>
              <span className="leaderboard-who">
                <strong>{row.name}</strong>
                <small>
                  {row.occupation} · {row.id}
                </small>
              </span>
              <span className="leaderboard-metric" title={sortLabel}>
                {formatSortValue(row, sortKey)}
              </span>
              <span className="leaderboard-meta">
                声望{row.prestige.toFixed(0)} · 脸{row.face.toFixed(0)}
              </span>
            </button>
          );
        })}
        {!ranked.length ? <p className="empty-state">没有匹配的村民</p> : null}
      </div>
    </section>
  );
}
