/**
 * Phase 0 acceptance — infra + schema + empty clock.
 * Usage: npm run verify:p0
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { LogEntry, WorldSnapshot } from "../../shared/types/index.js";
import { EventTemplateLibrary } from "../systems/event/library.js";
import { ReplayEngine } from "../store/replay_engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

interface Check { id: string; ok: boolean; detail: string }
const checks: Check[] = [];
function pass(id: string, detail: string) { checks.push({ id, ok: true, detail }); }
function fail(id: string, detail: string) { checks.push({ id, ok: false, detail }); }

function main(): void {
  // templates loadable (P0/P1 shared contract)
  const lib = new EventTemplateLibrary();
  const n = lib.loadFromDir(join(dataDir, "event_templates"));
  const pub = lib.byCategory("public").length;
  const priv = lib.byCategory("private").length;
  if (n >= 6 && pub >= 3 && priv >= 3) pass("P0.templates", `${n} templates (public=${pub} private=${priv})`);
  else fail("P0.templates", `need ≥3+3, got public=${pub} private=${priv} total=${n}`);

  const agents = JSON.parse(readFileSync(join(dataDir, "agents.json"), "utf8")) as {
    agents: Array<{ public: { communityId?: string; workplaceId?: string; socialTags?: string[] } }>;
  };
  const tagged = agents.agents.every((a) => a.public.communityId && a.public.workplaceId);
  if (tagged && agents.agents.length >= 8) pass("P0.agents", `${agents.agents.length} agents with community/workplace`);
  else fail("P0.agents", "missing communityId/workplaceId");

  const runId = `verify_p0_${Date.now()}`;
  const r = spawnSync("npm", ["run", "sim:empty"], {
    cwd: projectRoot,
    env: { ...process.env, RUN_ID: runId, END_SLOTS: "9", LLM_MODE: "mock" },
    encoding: "utf8",
    shell: true,
  });
  if (r.status === 0) pass("P0.empty", runId);
  else {
    fail("P0.empty", r.stderr || r.stdout);
    print();
    process.exit(1);
  }

  const runDir = join(dataDir, "runs", runId);
  const logs = readFileSync(join(runDir, "event_log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);
  for (const t of ["experiment.start", "timeslot.start", "timeslot.end", "rule.rejected", "experiment.end"] as const) {
    if (logs.some((e) => e.type === t)) pass(`P0.log.${t}`, "ok");
    else fail(`P0.log.${t}`, "missing");
  }

  const snaps = readdirSync(join(runDir, "snapshots")).filter((f) => f.endsWith(".json"));
  if (snaps.length === 9) pass("P0.snapshots", "9 files");
  else fail("P0.snapshots", `got ${snaps.length}`);

  const sample = JSON.parse(readFileSync(join(runDir, "snapshots", "D1-AM.json"), "utf8")) as WorldSnapshot;
  const keys = ["agents", "relationships", "giftLedger", "eventQueue", "personalEventTables", "metrics"];
  if (keys.every((k) => k in sample)) pass("P0.snapshotSchema", "ok");
  else fail("P0.snapshotSchema", "missing keys");

  const engine = new ReplayEngine();
  engine.loadExperiment(runId, join(dataDir, "runs"));
  const seek = engine.seekTo({ day: 1, slot: "EVE" });
  if (seek.simTime.slot === "EVE") pass("P0.replay", `seq=${seek.seq}`);
  else fail("P0.replay", "seek failed");

  print();
  if (checks.some((c) => !c.ok)) process.exit(1);
  console.log(`\nP0 PASSED. run=${runDir}`);
}

function print() {
  console.log("\n=== P0 verify ===");
  for (const c of checks) console.log(`${c.ok ? "OK" : "FAIL"}  ${c.id} — ${c.detail}`);
}

main();
