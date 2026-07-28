/**
 * Post-run checks for test2 expectations (daily vitals, refuse, forget, gossip, emotion).
 *
 * Usage:
 *   npx tsx sim/backend/engine/analyze_test2_expectations.ts test2
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentState, LogEntry, SimTime } from "../../shared/types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const runsDir = join(projectRoot, "sim/data/runs");

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

function loadLogs(runDir: string): LogEntry[] {
  const path = join(runDir, "event_log.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry);
}

function listSnapshots(runDir: string): string[] {
  const dir = join(runDir, "snapshots");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => {
      const pa = a.match(/D(\d+)-(AM|PM|EVE)/);
      const pb = b.match(/D(\d+)-(AM|PM|EVE)/);
      if (!pa || !pb) return a.localeCompare(b);
      const sa = { AM: 0, PM: 1, EVE: 2 }[pa[2] as "AM" | "PM" | "EVE"] ?? 0;
      const sb = { AM: 0, PM: 1, EVE: 2 }[pb[2] as "AM" | "PM" | "EVE"] ?? 0;
      return Number(pa[1]) - Number(pb[1]) || sa - sb;
    });
}

function loadSnap(runDir: string, file: string): {
  agents: Record<string, AgentState>;
  simTime?: SimTime;
  giftLedger?: unknown[];
  relationships?: Array<{ dislike?: number }>;
} {
  return JSON.parse(readFileSync(join(runDir, "snapshots", file), "utf8"));
}

function mean(nums: number[]): number {
  if (!nums.length) return NaN;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function main(): void {
  const runId = process.argv[2] ?? process.env.RUN_ID ?? "test2";
  const runDir = join(runsDir, runId);
  if (!existsSync(runDir)) throw new Error(`run not found: ${runDir}`);

  const checks: Check[] = [];
  const logs = loadLogs(runDir);
  const snaps = listSnapshots(runDir);
  const first = snaps[0] ? loadSnap(runDir, snaps[0]) : null;
  const last = snaps.length ? loadSnap(runDir, snaps[snaps.length - 1]!) : null;

  const daily = logs.filter((l) => l.type === "economy.daily");
  const forget = logs.filter((l) => l.type === "bdi.forget");
  const refused = logs.filter((l) => l.type === "event.refused");
  const gossipCreated = logs.filter(
    (l) =>
      l.type === "event.created" &&
      String((l.payload as { templateId?: string; subType?: string })?.templateId ?? "").includes(
        "gossip",
      ),
  );
  const gossipAlt = logs.filter((l) => {
    if (l.type !== "event.created" && l.type !== "event.completed") return false;
    const p = l.payload as { templateId?: string; subType?: string; summary?: string };
    return (
      p.templateId?.includes("gossip") ||
      p.subType === "social_gossip" ||
      Boolean(p.summary && /坏话|闲话|gossip/i.test(p.summary))
    );
  });

  checks.push({
    id: "daily_vitals_logged",
    ok: daily.length >= 300,
    detail: `economy.daily logs=${daily.length} (expect ≥300 for ~365 mornings)`,
  });
  checks.push({
    id: "belief_forget_logged",
    ok: forget.length >= 300,
    detail: `bdi.forget logs=${forget.length}`,
  });
  checks.push({
    id: "refuse_happened",
    ok: refused.length > 0,
    detail: `event.refused=${refused.length}`,
  });
  checks.push({
    id: "gossip_happened",
    ok: gossipCreated.length + gossipAlt.length > 0,
    detail: `gossip-related events≈${Math.max(gossipCreated.length, gossipAlt.length)}`,
  });

  if (first && last) {
    const ids = Object.keys(last.agents);
    const mood0 = mean(ids.map((id) => first.agents[id]?.private.emotion.mood ?? 0.5));
    const mood1 = mean(ids.map((id) => last.agents[id]?.private.emotion.mood ?? 0.5));
    const energy0 = mean(ids.map((id) => first.agents[id]?.private.emotion.energy ?? 0.7));
    const energy1 = mean(ids.map((id) => last.agents[id]?.private.emotion.energy ?? 0.7));
    const stress0 = mean(ids.map((id) => first.agents[id]?.private.emotion.stress ?? 0.2));
    const stress1 = mean(ids.map((id) => last.agents[id]?.private.emotion.stress ?? 0.2));
    const cash1 = mean(ids.map((id) => last.agents[id]?.economy.cash ?? 0));
    const debt1 = mean(ids.map((id) => last.agents[id]?.economy.debt ?? 0));

    // Expectation: mood should NOT all drift to near 1.0
    checks.push({
      id: "mood_not_all_maxed",
      ok: mood1 < 0.85,
      detail: `mean mood start=${mood0.toFixed(3)} end=${mood1.toFixed(3)} (want end < 0.85)`,
    });
    // Energy should recover / stay usable, not collapse to ~0
    checks.push({
      id: "energy_recovered_band",
      ok: energy1 >= 0.35 && energy1 <= 0.9,
      detail: `mean energy start=${energy0.toFixed(3)} end=${energy1.toFixed(3)} (want 0.35–0.90)`,
    });
    // Stress should show economic pressure somewhere (not stuck near 0)
    checks.push({
      id: "stress_has_pressure",
      ok: stress1 >= 0.15,
      detail: `mean stress start=${stress0.toFixed(3)} end=${stress1.toFixed(3)} (want end ≥ 0.15)`,
    });
    checks.push({
      id: "economy_alive",
      ok: Number.isFinite(cash1) && cash1 > 0,
      detail: `mean cash=${cash1.toFixed(1)} mean debt=${debt1.toFixed(1)}`,
    });

    const dislikeEdges = (last.relationships ?? []).filter((e) => (e.dislike ?? 0) >= 35);
    checks.push({
      id: "dislike_present",
      ok: dislikeEdges.length > 0,
      detail: `edges with dislike≥35: ${dislikeEdges.length}`,
    });

    // Sample mid-year vs end belief counts if stubs/__count present
    const mid = snaps.find((f) => f.includes("D180")) ?? snaps[Math.floor(snaps.length / 2)];
    if (mid) {
      const midSnap = loadSnap(runDir, mid);
      const bel = (agents: Record<string, AgentState>) =>
        mean(
          Object.values(agents).map((a) => {
            const b = a.private.beliefs ?? {};
            const meta = (b as { __count?: number }).__count;
            if (typeof meta === "number") return meta;
            return Object.keys(b).length;
          }),
        );
      checks.push({
        id: "beliefs_not_monotone_explosion",
        ok: bel(last.agents) < bel(midSnap.agents) * 3 + 50,
        detail: `mean belief# mid=${bel(midSnap.agents).toFixed(1)} end=${bel(last.agents).toFixed(1)}`,
      });
    }
  } else {
    checks.push({ id: "snapshots", ok: false, detail: "missing snapshots" });
  }

  const metricsPath = join(runDir, "metrics.json");
  let metrics: Record<string, number> | null = null;
  if (existsSync(metricsPath)) {
    metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as Record<string, number>;
    checks.push({
      id: "reciprocity_sane",
      ok: (metrics.reciprocity_rate ?? 0) >= 0.5,
      detail: `reciprocity_rate=${metrics.reciprocity_rate}`,
    });
    checks.push({
      id: "default_not_explosion",
      ok: (metrics.default_rate ?? 1) <= 0.25,
      detail: `default_rate=${metrics.default_rate}`,
    });
  }

  const passed = checks.filter((c) => c.ok).length;
  const report = {
    runId,
    checkedAt: new Date().toISOString(),
    passed,
    total: checks.length,
    ok: passed === checks.length,
    checks,
    metrics,
    logCounts: {
      economy_daily: daily.length,
      bdi_forget: forget.length,
      event_refused: refused.length,
      gossipish: Math.max(gossipCreated.length, gossipAlt.length),
      dialogue_message: logs.filter((l) => l.type === "dialogue.message").length,
    },
  };
  const out = join(runDir, "expectation_report.json");
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n=== test2 expectation report (${runId}) ===`);
  for (const c of checks) {
    console.log(`${c.ok ? "OK " : "FAIL"} ${c.id} — ${c.detail}`);
  }
  console.log(`\n${passed}/${checks.length} passed → ${out}`);
  if (passed < checks.length) process.exitCode = 1;
}

main();
