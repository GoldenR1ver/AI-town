/**
 * D1 acceptance checker.
 * Usage: npm run verify:d1
 * Optionally set RUN_ID to check an existing run without re-running.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { LogEntry, WorldSnapshot } from "../../shared/types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const runsDir = join(projectRoot, "sim/data/runs");
const agentsPath = join(projectRoot, "sim/data/agents.json");

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

function fail(checks: Check[], id: string, detail: string): void {
  checks.push({ id, ok: false, detail });
}

function pass(checks: Check[], id: string, detail: string): void {
  checks.push({ id, ok: true, detail });
}

function main(): void {
  const checks: Check[] = [];

  // --- D1-B2 agents.json ---
  const agentsFile = JSON.parse(readFileSync(agentsPath, "utf8")) as {
    agents: Array<{
      public: { id: string; kinship?: string[]; occupation: string };
      economy: { cash: number };
    }>;
  };
  const n = agentsFile.agents.length;
  if (n >= 8 && n <= 12) pass(checks, "D1-B2.count", `${n} agents`);
  else fail(checks, "D1-B2.count", `expected 8–12 agents, got ${n}`);

  const missingKin = agentsFile.agents.filter((a) => !Array.isArray(a.public.kinship));
  const missingOcc = agentsFile.agents.filter((a) => !a.public.occupation);
  const missingCash = agentsFile.agents.filter((a) => typeof a.economy?.cash !== "number");
  if (!missingKin.length && !missingOcc.length && !missingCash.length) {
    pass(checks, "D1-B2.fields", "kinship / occupation / cash present");
  } else {
    fail(
      checks,
      "D1-B2.fields",
      `missing kinship=${missingKin.length} occupation=${missingOcc.length} cash=${missingCash.length}`,
    );
  }

  // --- run empty unless RUN_ID provided ---
  let runId = process.env.RUN_ID?.trim();
  if (!runId) {
    const env = { ...process.env, RUN_ID: `verify_d1_${Date.now()}`, END_SLOTS: "30", LLM_MODE: "mock" };
    runId = env.RUN_ID!;
    const r = spawnSync("npx", ["tsx", "sim/backend/engine/run_empty.ts"], {
      cwd: projectRoot,
      env,
      encoding: "utf8",
      shell: true,
    });
    if (r.status !== 0) {
      fail(checks, "D1-B3.run", `sim:empty failed:\n${r.stdout}\n${r.stderr}`);
      printSummary(checks);
      process.exit(1);
    }
    pass(checks, "D1-B3.run", `ran empty → ${runId}`);
  } else {
    pass(checks, "D1-B3.run", `using existing RUN_ID=${runId}`);
  }

  const runDir = join(runsDir, runId);
  const logPath = join(runDir, "event_log.jsonl");
  const snapDir = join(runDir, "snapshots");
  const indexPath = join(runDir, "replay_index.json");

  if (!existsSync(logPath)) {
    fail(checks, "D1-B1.log", `missing ${logPath}`);
    printSummary(checks);
    process.exit(1);
  }

  const lines = readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);

  const types = new Set(lines.map((e) => e.type));
  for (const t of ["experiment.start", "timeslot.start", "timeslot.end", "experiment.end", "rule.rejected"] as const) {
    if (types.has(t)) pass(checks, `D1.log.${t}`, "present");
    else fail(checks, `D1.log.${t}`, "missing");
  }

  const rejected = lines.find((e) => e.type === "rule.rejected");
  if (rejected) {
    const payload = rejected.payload as { reason?: string; before?: unknown; after?: unknown };
    if (payload.reason && "before" in payload) {
      pass(checks, "D1-A3.reject", payload.reason);
    } else {
      fail(checks, "D1-A3.reject", "rule.rejected missing reason/before");
    }
  }

  const starts = lines.filter((e) => e.type === "timeslot.start").length;
  const ends = lines.filter((e) => e.type === "timeslot.end").length;
  if (starts === 30 && ends === 30) pass(checks, "D1-A2.slots", `30 starts / 30 ends`);
  else fail(checks, "D1-A2.slots", `expected 30/30, got start=${starts} end=${ends}`);

  if (!existsSync(snapDir)) {
    fail(checks, "D1-B1.snapshots", "snapshots dir missing");
  } else {
    const snaps = readdirSync(snapDir).filter((f) => f.endsWith(".json"));
    if (snaps.length === 30) pass(checks, "D1-B1.snapshots", `30 files`);
    else fail(checks, "D1-B1.snapshots", `expected 30, got ${snaps.length}`);

    const sample = JSON.parse(readFileSync(join(snapDir, "D1-AM.json"), "utf8")) as WorldSnapshot;
    const agentIds = Object.keys(sample.agents);
    if (agentIds.length === n) pass(checks, "D1-A1.snapshot.agents", `${agentIds.length} agents in snapshot`);
    else fail(checks, "D1-A1.snapshot.agents", `snapshot agents=${agentIds.length}, seed=${n}`);

    const requiredSnapKeys = [
      "snapshotId",
      "simTime",
      "seq",
      "agents",
      "relationships",
      "personalEventTables",
      "giftLedger",
      "eventQueue",
      "metrics",
    ];
    const missingKeys = requiredSnapKeys.filter((k) => !(k in sample));
    if (!missingKeys.length) pass(checks, "D1-AB.snapshotSchema", "WorldSnapshot keys ok");
    else fail(checks, "D1-AB.snapshotSchema", `missing ${missingKeys.join(",")}`);
  }

  if (existsSync(indexPath)) {
    const idx = JSON.parse(readFileSync(indexPath, "utf8")) as unknown[];
    if (idx.length === 30) pass(checks, "D1-B1.index", "replay_index 30 rows");
    else fail(checks, "D1-B1.index", `replay_index length=${idx.length}`);
  } else {
    fail(checks, "D1-B1.index", "replay_index.json missing");
  }

  printSummary(checks);
  if (checks.some((c) => !c.ok)) process.exit(1);
  console.log(`\nD1 PASSED. Inspect run: ${runDir}`);
}

function printSummary(checks: Check[]): void {
  console.log("\n=== D1 verify ===");
  for (const c of checks) {
    console.log(`${c.ok ? "OK" : "FAIL"}  ${c.id} — ${c.detail}`);
  }
}

main();
