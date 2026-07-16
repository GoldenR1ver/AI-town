/**
 * Experiment outcome metrics (P5 / rule-of-return-gift R32 observables).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldSnapshot } from "../../shared/types/index.js";
import type { WorldState } from "../store/world_state.js";

export interface ExperimentMetrics {
  reciprocity_rate: number;
  default_rate: number;
  avg_repay_delay: number;
  prestige_gini: number;
  asymmetric_gift_ratio: number;
  gift_count_total: number;
  gift_replied: number;
  gift_defaulted: number;
  gift_pending: number;
  trust_mean: number;
  intimacy_mean: number;
  relationship_density: number;
  dialogues_completed: number;
  events_completed: number;
  agent_count: number;
  runId?: string;
  variant?: string;
  label?: string;
  endDay?: number;
  seed?: number;
}

function gini(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  if (mean <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sum += Math.abs(sorted[i]! - sorted[j]!);
    }
  }
  return sum / (2 * n * n * mean);
}

function metricsFromLedger(
  snap: Pick<WorldSnapshot, "giftLedger" | "relationships" | "agents" | "metrics">,
): ExperimentMetrics {
  const gifts = snap.giftLedger;
  const total = gifts.length;
  const replied = gifts.filter((g) => g.status === "replied").length;
  const defaulted = gifts.filter((g) => g.status === "defaulted").length;
  const pending = gifts.filter((g) => g.status === "pending_reply").length;
  const closedOrDone = replied + defaulted;
  const agents = Object.keys(snap.agents);
  const n = agents.length;
  const edges = snap.relationships;
  const trustMean =
    edges.length === 0 ? 0 : edges.reduce((s, e) => s + e.trust, 0) / edges.length;
  const intimacyMean =
    edges.length === 0 ? 0 : edges.reduce((s, e) => s + e.intimacy, 0) / edges.length;
  const density = n <= 1 ? 0 : edges.length / (n * (n - 1));
  const prestiges = agents.map((id) => snap.agents[id]?.public.prestige ?? 50);
  const directedPairs = new Set(edges.map((e) => `${e.from}->${e.to}`));
  let asymmetric = 0;
  for (const e of edges) {
    if (!directedPairs.has(`${e.to}->${e.from}`)) asymmetric += 1;
  }

  return {
    reciprocity_rate: closedOrDone === 0 ? 0 : replied / closedOrDone,
    default_rate: closedOrDone === 0 ? 0 : defaulted / Math.max(1, total),
    avg_repay_delay: snap.metrics.avgRepayDelaySlots ?? 0,
    prestige_gini: gini(prestiges),
    asymmetric_gift_ratio: edges.length === 0 ? 0 : asymmetric / edges.length,
    gift_count_total: total,
    gift_replied: replied,
    gift_defaulted: defaulted,
    gift_pending: pending,
    trust_mean: trustMean,
    intimacy_mean: intimacyMean,
    relationship_density: density,
    dialogues_completed: snap.metrics.dialoguesCompleted,
    events_completed: snap.metrics.eventsCompleted,
    agent_count: n,
  };
}

export function computeMetricsFromSnapshot(snap: WorldSnapshot): ExperimentMetrics {
  return metricsFromLedger(snap);
}

export function computeMetrics(args: {
  world: WorldState;
  runId?: string;
  variant?: string;
  label?: string;
  endDay?: number;
  seed?: number;
}): ExperimentMetrics {
  const m = metricsFromLedger({
    giftLedger: args.world.giftLedger,
    relationships: args.world.relationships,
    agents: args.world.agents,
    metrics: args.world.metrics,
  });
  return {
    ...m,
    runId: args.runId,
    variant: args.variant,
    label: args.label,
    endDay: args.endDay,
    seed: args.seed,
  };
}

export function writeMetricsJson(runDir: string, metrics: ExperimentMetrics): void {
  writeFileSync(join(runDir, "metrics.json"), JSON.stringify(metrics, null, 2), "utf8");
}
