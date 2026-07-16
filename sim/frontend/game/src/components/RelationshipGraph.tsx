import type {
  AgentState,
  LogEntry,
  RelationshipEdge,
} from "@shared/types";
import type { ReplayStep, ReplayWorldState } from "@shared/replay/types";
import { useMemo } from "react";

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function layoutNodes(
  agents: Record<string, AgentState>,
  width: number,
  height: number,
): Map<string, NodePosition> {
  const entries = Object.entries(agents);
  const map = new Map<string, NodePosition>();
  const cx = width / 2;
  const cy = height / 2;
  const rx = width * 0.4;
  const ry = height * 0.34;
  entries.forEach(([id, agent], index) => {
    const angle = (Math.PI * 2 * index) / Math.max(entries.length, 1) - Math.PI / 2;
    map.set(id, {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      agent,
    });
  });
  return map;
}

function edgePath(from: NodePosition, to: NodePosition, fromId: string, toId: string) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const bend = fromId < toId ? 10 : -10;
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
  const change = after - before;
  return {
    label: key,
    before,
    after,
    change,
  };
}

export function RelationshipGraph({
  state,
  step,
  stepLogs,
  selectedAgentId,
  onSelectAgent,
}: RelationshipGraphProps) {
  const width = 520;
  const height = 330;
  const positions = useMemo(
    () => layoutNodes(state.agents, width, height),
    [state.agents],
  );
  const changed = new Set(step.affectedEdgeKeys);
  const deltas = extractDeltas(stepLogs);

  return (
    <section className="relationship-panel pixel-panel">
      <div className="panel-heading compact">
        <div>
          <span className="eyebrow">SOCIAL GRAPH</span>
          <h2>关系网络</h2>
        </div>
        <div className="graph-legend">
          <span>粗细 trust</span>
          <span>明暗 intimacy</span>
        </div>
      </div>
      <div className="relationship-canvas">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Agent 有向关系图">
          <defs>
            <marker
              id="arrow-default"
              markerWidth="7"
              markerHeight="7"
              refX="7"
              refY="3.5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L7,3.5 L0,7 z" />
            </marker>
          </defs>
          <g className="relationship-edges">
            {state.relationships.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              const key = `${edge.from}->${edge.to}`;
              const relevant =
                !selectedAgentId ||
                edge.from === selectedAgentId ||
                edge.to === selectedAgentId;
              return (
                <path
                  key={key}
                  d={edgePath(from, to, edge.from, edge.to)}
                  className={[
                    "relationship-edge",
                    changed.has(key) ? "is-changed" : "",
                    relevant ? "" : "is-muted",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    strokeWidth: 0.7 + (edge.trust / 100) * 4,
                    strokeOpacity: relevant
                      ? 0.18 + (edge.intimacy / 100) * 0.75
                      : 0.07,
                  }}
                  markerEnd="url(#arrow-default)"
                />
              );
            })}
          </g>
          <g className="relationship-nodes">
            {[...positions.entries()].map(([agentId, position]) => {
              const selected = agentId === selectedAgentId;
              const focused = step.focusAgentIds.includes(agentId);
              const radius =
                9 + Math.min(7, Number(position.agent.public.face ?? 50) / 16);
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
                  <circle cx={position.x} cy={position.y} r={radius} />
                  <text x={position.x} y={position.y + 3.5} className="node-id">
                    {agentId}
                  </text>
                  <text
                    x={position.x}
                    y={position.y + radius + 11}
                    className="node-name"
                  >
                    {position.agent.public.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
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
