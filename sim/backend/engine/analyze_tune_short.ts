/**
 * Short-run calibration checks for tune_v1_100_30d (and similar).
 * Usage: npx tsx sim/backend/engine/analyze_tune_short.ts tune_v1_100_30d
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentState, LogEntry } from "../../shared/types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runsDir = join(__dirname, "../../../sim/data/runs");

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN;
}

function main(): void {
  const runId = process.argv[2] ?? "tune_v1_100_30d";
  const runDir = join(runsDir, runId);
  if (!existsSync(runDir)) throw new Error(`missing ${runDir}`);

  const logs = readFileSync(join(runDir, "event_log.jsonl"), "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);

  const snaps = readdirSync(join(runDir, "snapshots"))
    .filter((f) => /^D\d+-(AM|PM|EVE)\.json$/.test(f))
    .sort((a, b) => {
      const pa = a.match(/D(\d+)-(AM|PM|EVE)/)!;
      const pb = b.match(/D(\d+)-(AM|PM|EVE)/)!;
      const s = { AM: 0, PM: 1, EVE: 2 } as const;
      return Number(pa[1]) - Number(pb[1]) || s[pa[2] as keyof typeof s] - s[pb[2] as keyof typeof s];
    });
  const last = JSON.parse(
    readFileSync(join(runDir, "snapshots", snaps[snaps.length - 1]!), "utf8"),
  ) as { agents: Record<string, AgentState>; relationships: Array<{ dislike?: number }> };
  const metrics = JSON.parse(readFileSync(join(runDir, "metrics.json"), "utf8")) as Record<
    string,
    number
  >;

  const agents = Object.values(last.agents);
  const mood = mean(agents.map((a) => a.private.emotion.mood));
  const stress = mean(agents.map((a) => a.private.emotion.stress));
  const energy = mean(agents.map((a) => a.private.emotion.energy));
  const cash = mean(agents.map((a) => a.economy.cash));
  const debt = mean(agents.map((a) => a.economy.debt));
  const liquid = mean(agents.map((a) => a.economy.cash + a.economy.deposit));
  const cashZeroShare =
    agents.filter((a) => a.economy.cash <= 1).length / Math.max(1, agents.length);

  const refused = logs.filter((l) => l.type === "event.refused").length;
  const daily = logs.filter((l) => l.type === "economy.daily").length;
  const forget = logs.filter((l) => l.type === "bdi.forget").length;
  const gossip = logs.filter((l) => {
    const p = l.payload as { templateId?: string; subType?: string };
    return (
      l.type === "event.created" &&
      (p.templateId?.includes("gossip") || p.subType === "social_gossip")
    );
  }).length;
  const dislikeN = (last.relationships ?? []).filter((e) => (e.dislike ?? 0) >= 35).length;

  const days = metrics.endDay ?? 30;
  const checks: Check[] = [
    {
      id: "daily_vitals",
      ok: daily >= days - 1,
      detail: `economy.daily=${daily}`,
    },
    {
      id: "forget",
      ok: forget >= days - 1,
      detail: `bdi.forget=${forget}`,
    },
    {
      id: "mood_band",
      ok: mood >= 0.35 && mood <= 0.85,
      detail: `mean mood=${mood.toFixed(3)} (want 0.35–0.85)`,
    },
    {
      id: "stress_band",
      ok: stress >= 0.18 && stress <= 0.72,
      detail: `mean stress=${stress.toFixed(3)} (want 0.18–0.72, ideal~0.25–0.45)`,
    },
    {
      id: "energy_band",
      ok: energy >= 0.45 && energy <= 0.92,
      detail: `mean energy=${energy.toFixed(3)} (want 0.45–0.92)`,
    },
    {
      id: "cash_not_collapsed",
      ok: cashZeroShare < 0.45 && liquid > 800,
      detail: `cashZeroShare=${cashZeroShare.toFixed(2)} meanCash=${cash.toFixed(0)} meanLiquid=${liquid.toFixed(0)} meanDebt=${debt.toFixed(0)}`,
    },
    {
      id: "gifts_alive",
      ok: (metrics.gift_count_total ?? 0) >= 25,
      detail: `gifts=${metrics.gift_count_total} reciprocity=${metrics.reciprocity_rate} default=${metrics.default_rate}`,
    },
    {
      id: "refuse_moderate",
      ok: refused > 0 && refused < days * 80,
      detail: `refused=${refused} (~${(refused / days).toFixed(1)}/day)`,
    },
    {
      id: "gossip_or_dislike",
      ok: gossip > 0 && dislikeN > 0,
      detail: `gossip=${gossip} dislikeEdges≥35=${dislikeN}`,
    },
    {
      id: "default_controlled",
      ok: (metrics.default_rate ?? 1) <= 0.2,
      detail: `default_rate=${metrics.default_rate}`,
    },
    {
      id: "reciprocity_band",
      ok:
        (metrics.reciprocity_rate ?? 0) >= 0.65 &&
        (metrics.reciprocity_rate ?? 1) <= 1.0,
      detail: `reciprocity=${metrics.reciprocity_rate} (want 0.65–1.0)`,
    },
    {
      id: "defaults_present",
      ok: (metrics.default_rate ?? 0) >= 0.02 && (metrics.default_rate ?? 1) <= 0.2,
      detail: `default_rate=${metrics.default_rate} (want 0.02–0.20)`,
    },
  ];

  const passed = checks.filter((c) => c.ok).length;
  const report = {
    runId,
    passed,
    total: checks.length,
    ok: passed === checks.length,
    checks,
    summary: { mood, stress, energy, cash, debt, liquid, refused, gifts: metrics.gift_count_total },
  };
  writeFileSync(join(runDir, "tune_short_report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`\n=== tune short report (${runId}) ===`);
  for (const c of checks) console.log(`${c.ok ? "OK " : "FAIL"} ${c.id} — ${c.detail}`);
  console.log(`\n${passed}/${checks.length} passed`);
  if (passed < checks.length) process.exitCode = 1;
}

main();
