/**
 * Extract convergence trajectories from ablation A0 runs + write summary JSON
 * for canvas / reporting.
 *
 * Usage (after sim:ablation):
 *   npx tsx sim/backend/engine/analyze_convergence.ts [ablationId]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runsDir = join(__dirname, "../../data/runs");

function gini(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  if (mean <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sum += Math.abs(sorted[i]! - sorted[j]!);
  }
  return sum / (2 * n * n * mean);
}

function slotIdx(f: string): number {
  const m = f.match(/D(\d+)-(AM|PM|EVE)/);
  if (!m) return 0;
  return +m[1]! * 3 + ({ AM: 0, PM: 1, EVE: 2 }[m[2] as "AM" | "PM" | "EVE"] ?? 0);
}

function topShare(inflow: number[], scores: number[], fraction = 0.1): number {
  const n = inflow.length;
  if (!n) return 0;
  const total = inflow.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const idx = [...Array(n).keys()].sort((i, j) => scores[j]! - scores[i]!);
  const k = Math.max(1, Math.ceil(n * fraction));
  let s = 0;
  for (let i = 0; i < k; i++) s += inflow[idx[i]!]!;
  return s / total;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

interface DayPoint {
  day: number;
  gifts: number;
  replied: number;
  defaulted: number;
  pending: number;
  closed: number;
  reciprocity: number;
  default_among_closed: number;
  prestige_gini: number;
  top10_prestige_share: number;
  gift_prestige_corr: number;
  trust_mean: number;
}

function trajectoryFromRun(runDir: string, days: number[]): DayPoint[] {
  const snapDir = join(runDir, "snapshots");
  if (!existsSync(snapDir)) return [];
  const files = readdirSync(snapDir).filter((f) => f.endsWith(".json"));
  const out: DayPoint[] = [];
  for (const day of days) {
    const cand = files.filter((f) => f.startsWith(`D${day}-`));
    if (!cand.length) continue;
    const f = cand.sort((a, b) => slotIdx(b) - slotIdx(a))[0]!;
    const snap = JSON.parse(readFileSync(join(snapDir, f), "utf8")) as {
      agents: Record<string, { public: { prestige?: number }; economy: { cash: number; deposit: number } }>;
      giftLedger: Array<{
        to: string;
        status: string;
        adjustedValue: number;
        replyRequired?: boolean;
      }>;
      relationships: Array<{ trust: number }>;
    };
    const agents = Object.keys(snap.agents);
    const prestiges = agents.map((id) => snap.agents[id]!.public.prestige ?? 50);
    const gifts = snap.giftLedger;
    const replied = gifts.filter((g) => g.status === "replied").length;
    const defaulted = gifts.filter((g) => g.status === "defaulted").length;
    const pending = gifts.filter((g) => g.status === "pending_reply").length;
    const closedStatus = gifts.filter((g) => g.status === "closed").length;
    const closedOrDone = replied + defaulted;
    const inflow = agents.map((id) =>
      gifts.filter((g) => g.to === id).reduce((s, g) => s + g.adjustedValue, 0),
    );
    out.push({
      day,
      gifts: gifts.length,
      replied,
      defaulted,
      pending,
      closed: closedStatus,
      reciprocity: closedOrDone === 0 ? 0 : replied / closedOrDone,
      default_among_closed: closedOrDone === 0 ? 0 : defaulted / closedOrDone,
      prestige_gini: gini(prestiges),
      top10_prestige_share: topShare(inflow, prestiges, 0.1),
      gift_prestige_corr: pearson(prestiges, inflow),
      trust_mean:
        snap.relationships.length === 0
          ? 0
          : snap.relationships.reduce((s, e) => s + e.trust, 0) / snap.relationships.length,
    });
  }
  return out;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function main(): void {
  const ablationId =
    process.argv[2] ??
    (existsSync(join(runsDir, "LATEST_ABLATION.txt"))
      ? readFileSync(join(runsDir, "LATEST_ABLATION.txt"), "utf8").trim()
      : "");
  if (!ablationId) throw new Error("No ablation id; pass as argv or set LATEST_ABLATION.txt");

  const resultsPath = join(runsDir, ablationId, "ablation_results.json");
  if (!existsSync(resultsPath)) throw new Error(`missing ${resultsPath}`);
  const rows = JSON.parse(readFileSync(resultsPath, "utf8")) as Array<{
    variant: string;
    seed: number;
    runId: string;
    reciprocity_rate: number;
    default_rate: number;
    avg_repay_delay: number;
    prestige_gini: number;
    gift_count_total: number;
    gift_replied: number;
    gift_defaulted: number;
    gift_pending: number;
    gift_inflow_top10_prestige_share: number;
    gift_prestige_corr: number;
    gift_wealth_corr: number;
    asymmetric_gift_ratio: number;
    trust_mean: number;
    endDay: number;
  }>;

  const sampleDays = [1, 10, 20, 30, 40, 50, 60].filter((d) => d <= (rows[0]?.endDay ?? 60));
  const a0Runs = rows.filter((r) => r.variant === "A0_full");
  const trajectories = a0Runs.map((r) => ({
    seed: r.seed,
    runId: r.runId,
    points: trajectoryFromRun(join(runsDir, r.runId), sampleDays),
  }));

  // Mean trajectory across A0 seeds
  const meanCurve = sampleDays.map((day) => {
    const pts = trajectories.flatMap((t) => t.points.filter((p) => p.day === day));
    return {
      day,
      gifts: mean(pts.map((p) => p.gifts)),
      replied: mean(pts.map((p) => p.replied)),
      defaulted: mean(pts.map((p) => p.defaulted)),
      pending: mean(pts.map((p) => p.pending)),
      reciprocity: mean(pts.map((p) => p.reciprocity)),
      default_among_closed: mean(pts.map((p) => p.default_among_closed)),
      prestige_gini: mean(pts.map((p) => p.prestige_gini)),
      top10_prestige_share: mean(pts.map((p) => p.top10_prestige_share)),
      gift_prestige_corr: mean(pts.map((p) => p.gift_prestige_corr)),
      trust_mean: mean(pts.map((p) => p.trust_mean)),
      n: pts.length,
    };
  });

  // Aggregate by variant
  const byVariant: Record<string, typeof rows> = {};
  for (const r of rows) {
    (byVariant[r.variant] ??= []).push(r);
  }
  const variantSummary = Object.entries(byVariant).map(([variant, list]) => ({
    variant,
    n: list.length,
    reciprocity_rate: mean(list.map((r) => r.reciprocity_rate)),
    default_rate: mean(list.map((r) => r.default_rate)),
    avg_repay_delay: mean(list.map((r) => r.avg_repay_delay ?? 0)),
    prestige_gini: mean(list.map((r) => r.prestige_gini)),
    gift_count_total: mean(list.map((r) => r.gift_count_total)),
    gift_replied: mean(list.map((r) => r.gift_replied)),
    gift_defaulted: mean(list.map((r) => r.gift_defaulted)),
    gift_inflow_top10_prestige_share: mean(list.map((r) => r.gift_inflow_top10_prestige_share)),
    gift_prestige_corr: mean(list.map((r) => r.gift_prestige_corr)),
    gift_wealth_corr: mean(list.map((r) => r.gift_wealth_corr)),
    asymmetric_gift_ratio: mean(list.map((r) => r.asymmetric_gift_ratio)),
    trust_mean: mean(list.map((r) => r.trust_mean)),
  }));

  const outDir = join(runsDir, ablationId);
  mkdirSync(outDir, { recursive: true });
  const payload = {
    ablationId,
    generatedAt: new Date().toISOString(),
    meanCurve,
    trajectories,
    variantSummary,
    rawRows: rows,
  };
  writeFileSync(join(outDir, "convergence_analysis.json"), JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${join(outDir, "convergence_analysis.json")}`);
  console.log("\nMean A0 curve:");
  console.table(meanCurve);
  console.log("\nVariant summary:");
  console.table(
    variantSummary.map((v) => ({
      variant: v.variant,
      recip: +v.reciprocity_rate.toFixed(3),
      def: +v.default_rate.toFixed(3),
      delay: +v.avg_repay_delay.toFixed(1),
      top10: +v.gift_inflow_top10_prestige_share.toFixed(3),
      corr_p: +v.gift_prestige_corr.toFixed(3),
      gini: +v.prestige_gini.toFixed(3),
    })),
  );
}

main();
