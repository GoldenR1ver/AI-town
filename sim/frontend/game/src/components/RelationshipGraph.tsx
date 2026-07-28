import type {
  AgentState,
  LogEntry,
  RelationshipEdge,
} from "@shared/types";
import type { ReplayStep, ReplayWorldState } from "@shared/replay/types";
import { useMemo, useState } from "react";

interface RelationshipGraphProps {
  state: ReplayWorldState;
  step: ReplayStep;
  stepLogs: LogEntry[];
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
}

interface NodePosition {
  x: number;
  y: number;
  agent: AgentState;
}

interface RelationshipDelta {
  from: string;
  to: string;
  before: Partial<RelationshipEdge>;
  after: Partial<RelationshipEdge>;
  reason?: string;
}

type GraphMode = "ego" | "overview";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function edgeStrength(edge: RelationshipEdge): number {
  return edge.intimacy * 0.45 + edge.trust * 0.35 + edge.affection * 0.2 + edge.giftDebt * 0.05;
}

function outgoing(edges: RelationshipEdge[], fromId: string): RelationshipEdge[] {
  return edges.filter((e) => e.from === fromId);
}

function neighborsOf(
  edges: RelationshipEdge[],
  agentId: string,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const edge of edges) {
    if (edge.from === agentId) {
      scores.set(edge.to, Math.max(scores.get(edge.to) ?? 0, edgeStrength(edge)));
    } else if (edge.to === agentId) {
      scores.set(edge.from, Math.max(scores.get(edge.from) ?? 0, edgeStrength(edge)));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/** Ego layout: focus in center, neighbors on a ring (stronger closer to top). */
function layoutEgo(
  agents: Record<string, AgentState>,
  focusId: string,
  neighborIds: string[],
  width: number,
  height: number,
): Map<string, NodePosition> {
  const map = new Map<string, NodePosition>();
  const focus = agents[focusId];
  if (!focus) return map;
  const cx = width / 2;
  const cy = height / 2;
  map.set(focusId, { x: cx, y: cy, agent: focus });
  const n = neighborIds.length;
  const rx = width * 0.38;
  const ry = height * 0.36;
  neighborIds.forEach((id, index) => {
    const agent = agents[id];
    if (!agent) return;
    const angle = (Math.PI * 2 * index) / Math.max(n, 1) - Math.PI / 2;
    map.set(id, {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      agent,
    });
  });
  return map;
}

/** Overview: concentric rings by prestige; readable for 50–100 agents. */
function layoutOverview(
  agents: Record<string, AgentState>,
  width: number,
  height: number,
): Map<string, NodePosition> {
  const entries = Object.entries(agents).sort(
    (a, b) => (b[1].public.prestige ?? 50) - (a[1].public.prestige ?? 50),
  );
  const map = new Map<string, NodePosition>();
  const cx = width / 2;
  const cy = height / 2;
  const rings = [
    { count: Math.min(8, entries.length), rx: width * 0.16, ry: height * 0.14 },
    { count: Math.min(24, Math.max(0, entries.length - 8)), rx: width * 0.3, ry: height * 0.28 },
    {
      count: Math.max(0, entries.length - 32),
      rx: width * 0.42,
      ry: height * 0.38,
    },
  ];
  let offset = 0;
  for (const ring of rings) {
    const slice = entries.slice(offset, offset + ring.count);
    slice.forEach(([id, agent], index) => {
      const angle =
        (Math.PI * 2 * index) / Math.max(slice.length, 1) -
        Math.PI / 2 +
        (offset % 2 === 0 ? 0 : Math.PI / slice.length);
      map.set(id, {
        x: cx + ring.rx * Math.cos(angle),
        y: cy + ring.ry * Math.sin(angle),
        agent,
      });
    });
    offset += ring.count;
  }
  return map;
}

function edgePath(from: NodePosition, to: NodePosition, fromId: string, toId: string) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const bend = fromId < toId ? 8 : -8;
  const controlX = (from.x + to.x) / 2 - (dy / length) * bend;
  const controlY = (from.y + to.y) / 2 + (dx / length) * bend;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function extractDeltas(logs: LogEntry[]): RelationshipDelta[] {
  return logs
    .filter((log) => log.type === "relationship.delta")
    .map((log) => asRecord(log.payload))
    .map((payload) => ({
      from: String(payload.from ?? "?"),
      to: String(payload.to ?? "?"),
      before: asRecord(payload.before) as Partial<RelationshipEdge>,
      after: asRecord(payload.after) as Partial<RelationshipEdge>,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
    }));
}

function metricDelta(delta: RelationshipDelta, key: keyof RelationshipEdge) {
  const before = delta.before[key];
  const after = delta.after[key];
  if (typeof before !== "number" || typeof after !== "number") return null;
  return {
    label: key,
    before,
    after,
    change: after - before,
  };
}

function agentLabel(agent: AgentState): string {
  const name = agent.public.name ?? agent.public.id;
  return name.length > 4 ? `${name.slice(0, 4)}…` : name;
}

export function RelationshipGraph({
  state,
  step,
  stepLogs,
  selectedAgentId,
  onSelectAgent,
}: RelationshipGraphProps) {
  const agentCount = Object.keys(state.agents).length;
  const large = agentCount >= 24;
  const [mode, setMode] = useState<GraphMode>(large ? "ego" : "overview");
  const [maxNeighbors, setMaxNeighbors] = useState(16);

  const width = 520;
  const height = 360;
  const focusId =
    selectedAgentId && state.agents[selectedAgentId]
      ? selectedAgentId
      : step.focusAgentIds.find((id) => state.agents[id]) ??
        Object.keys(state.agents)[0] ??
        "";

  const neighborRanked = useMemo(
    () => (focusId ? neighborsOf(state.relationships, focusId) : []),
    [focusId, state.relationships],
  );

  const visibleIds = useMemo(() => {
    if (mode === "overview") return new Set(Object.keys(state.agents));
    const ids = new Set<string>();
    if (focusId) ids.add(focusId);
    for (const row of neighborRanked.slice(0, maxNeighbors)) ids.add(row.id);
    // Always include step focus participants so current event is visible.
    for (const id of step.focusAgentIds) {
      if (state.agents[id]) ids.add(id);
    }
    return ids;
  }, [mode, focusId, neighborRanked, maxNeighbors, step.focusAgentIds, state.agents]);

  const positions = useMemo(() => {
    if (mode === "ego" && focusId) {
      const ring = [...visibleIds].filter((id) => id !== focusId);
      // Keep neighbor ranking order for ring placement.
      const ordered = [
        ...neighborRanked.map((n) => n.id).filter((id) => visibleIds.has(id) && id !== focusId),
        ...ring.filter((id) => !neighborRanked.some((n) => n.id === id)),
      ];
      return layoutEgo(state.agents, focusId, ordered, width, height);
    }
    return layoutOverview(state.agents, width, height);
  }, [mode, focusId, visibleIds, neighborRanked, state.agents]);

  const visibleEdges = useMemo(() => {
    const edges = state.relationships.filter(
      (e) => visibleIds.has(e.from) && visibleIds.has(e.to),
    );
    if (mode === "ego") {
      // Ego: prefer edges touching focus; keep a few strong peripheral ties.
      const toFocus = edges.filter((e) => e.from === focusId || e.to === focusId);
      const peripheral = edges
        .filter((e) => e.from !== focusId && e.to !== focusId)
        .sort((a, b) => edgeStrength(b) - edgeStrength(a))
        .slice(0, Math.min(24, maxNeighbors));
      return [...toFocus, ...peripheral];
    }
    // Overview: only strongest edges so the canvas stays readable.
    return [...edges].sort((a, b) => edgeStrength(b) - edgeStrength(a)).slice(0, 120);
  }, [state.relationships, visibleIds, mode, focusId, maxNeighbors]);

  const changed = new Set(step.affectedEdgeKeys);
  const deltas = extractDeltas(stepLogs);
  const egoDegree = neighborRanked.length;
  const outDebt = focusId
    ? outgoing(state.relationships, focusId).reduce((s, e) => s + Math.max(0, e.giftDebt), 0)
    : 0;

  return (
    <section className="relationship-panel pixel-panel">
      <div className="panel-heading compact">
        <div>
          <span className="eyebrow">SOCIAL GRAPH</span>
          <h2>关系网络</h2>
        </div>
        <div className="graph-legend">
          <span>
            {agentCount}人 · {state.relationships.length}边
          </span>
          <span>粗细 trust</span>
        </div>
      </div>

      <div className="graph-toolbar">
        <div className="graph-mode-toggle" role="tablist" aria-label="关系图模式">
          <button
            type="button"
            className={mode === "ego" ? "is-active" : ""}
            onClick={() => setMode("ego")}
          >
            自我中心
          </button>
          <button
            type="button"
            className={mode === "overview" ? "is-active" : ""}
            onClick={() => setMode("overview")}
          >
            全村总览
          </button>
        </div>
        {mode === "ego" ? (
          <label className="graph-neighbor-control">
            邻居
            <select
              value={maxNeighbors}
              onChange={(event) => setMaxNeighbors(Number(event.target.value))}
            >
              {[8, 12, 16, 24, 32].map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="graph-hint">声望外环 · 仅绘最强 120 边</span>
        )}
      </div>

      {mode === "ego" && focusId ? (
        <p className="graph-focus-line">
          焦点 <strong>{state.agents[focusId]?.public.name ?? focusId}</strong>
          <span>
            一度关系 {egoDegree} · 展示 {Math.min(maxNeighbors, egoDegree)} · 礼债出
            {outDebt.toFixed(0)}
          </span>
        </p>
      ) : null}

      <div className="relationship-canvas">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Agent 关系图">
          <defs>
            <marker
              id="arrow-default"
              markerWidth="6"
              markerHeight="6"
              refX="6"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L6,3 L0,6 z" />
            </marker>
          </defs>
          <g className="relationship-edges">
            {visibleEdges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              const key = `${edge.from}->${edge.to}`;
              const touchesFocus =
                mode === "overview" || edge.from === focusId || edge.to === focusId;
              return (
                <path
                  key={key}
                  d={edgePath(from, to, edge.from, edge.to)}
                  className={[
                    "relationship-edge",
                    changed.has(key) ? "is-changed" : "",
                    touchesFocus ? "" : "is-muted",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    strokeWidth: 0.5 + (edge.trust / 100) * (mode === "ego" ? 3.2 : 2.2),
                    strokeOpacity: touchesFocus
                      ? 0.22 + (edge.intimacy / 100) * 0.7
                      : 0.08,
                  }}
                  markerEnd={mode === "ego" ? "url(#arrow-default)" : undefined}
                />
              );
            })}
          </g>
          <g className="relationship-nodes">
            {[...positions.entries()].map(([agentId, position]) => {
              const selected = agentId === focusId;
              const focused = step.focusAgentIds.includes(agentId);
              const prestige = Number(position.agent.public.prestige ?? 50);
              const radius =
                mode === "overview"
                  ? 3.2 + Math.min(5, prestige / 28)
                  : selected
                    ? 14
                    : 8 + Math.min(5, Number(position.agent.public.face ?? 50) / 22);
              const showLabel = mode === "ego" || selected || focused;
              return (
                <g
                  key={agentId}
                  className={`relationship-node ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectAgent(agentId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectAgent(agentId);
                    }
                  }}
                >
                  <title>
                    {position.agent.public.name}（{agentId}） prestige=
                    {prestige.toFixed(0)} face=
                    {Number(position.agent.public.face ?? 50).toFixed(0)}
                  </title>
                  <circle cx={position.x} cy={position.y} r={radius} />
                  {showLabel ? (
                    <>
                      <text
                        x={position.x}
                        y={position.y + (mode === "ego" && selected ? 4 : 3)}
                        className="node-id"
                        style={{ fontSize: selected ? 9 : 7 }}
                      >
                        {mode === "overview" ? agentId.replace(/^a0*/, "") : agentId.slice(-3)}
                      </text>
                      {mode === "ego" ? (
                        <text
                          x={position.x}
                          y={position.y + radius + 10}
                          className="node-name"
                        >
                          {agentLabel(position.agent)}
                        </text>
                      ) : null}
                    </>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {mode === "ego" && neighborRanked.length > maxNeighbors ? (
        <p className="graph-hint muted">
          另有 {neighborRanked.length - maxNeighbors} 个较弱邻居未展示；提高 Top N 或点选节点切换焦点。
        </p>
      ) : null}

      <div className="relationship-deltas">
        {deltas.length ? (
          deltas.slice(0, 5).map((delta, index) => {
            const metrics = (["trust", "affection", "intimacy", "giftDebt"] as const)
              .map((key) => metricDelta(delta, key))
              .filter((metric): metric is NonNullable<typeof metric> => Boolean(metric));
            return (
              <div className="relationship-delta" key={`${delta.from}-${delta.to}-${index}`}>
                <strong>
                  {delta.from} → {delta.to}
                </strong>
                <span>{delta.reason}</span>
                <div>
                  {metrics.map((metric) => (
                    <i
                      key={metric.label}
                      className={metric.change >= 0 ? "positive" : "negative"}
                    >
                      {metric.label} {metric.before.toFixed(1)} → {metric.after.toFixed(1)}
                    </i>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <p className="empty-state">本步没有关系边变化</p>
        )}
      </div>
    </section>
  );
}
