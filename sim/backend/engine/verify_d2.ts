/**
 * D2 acceptance checker.
 * Usage: npm run verify:d2
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { EconomyState, LogEntry, RelationshipEdge } from "../../shared/types/index.js";
import { EconomyManager } from "../systems/economy/manager.js";
import { RelationshipGraph } from "../systems/relationship/graph.js";
import { GiftLedgerManager, advanceSimTime } from "../systems/gift/ledger.js";
import { ReplayEngine } from "../store/replay_engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const runsRoot = join(projectRoot, "sim/data/runs");

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
function pass(id: string, detail: string): void {
  checks.push({ id, ok: true, detail });
}
function fail(id: string, detail: string): void {
  checks.push({ id, ok: false, detail });
}

function runCmd(script: string, env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("npm", ["run", script], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: true,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function checkEconomy(): void {
  const sample: EconomyState = {
    agentId: "t",
    cash: 1000,
    deposit: 2000,
    debt: 300,
    creditLimit: 5000,
    income: 1000,
    essentialExpenseRatio: 0.4,
    savingsRatio: 0.2,
    lastSettlementDay: 0,
  };
  // cash = 1000 + 1000*0.6 = 1600; repay 300 → cash 1300 debt 0; savings 260 → deposit 2260 cash 1040
  const next = new EconomyManager().monthlySettle(sample, 31);
  const ok =
    Math.abs(next.cash - 1040) < 1e-9 &&
    Math.abs(next.deposit - 2260) < 1e-9 &&
    Math.abs(next.debt - 0) < 1e-9;
  if (ok) pass("D2-A3.economy", `cash=${next.cash} deposit=${next.deposit} debt=${next.debt}`);
  else fail("D2-A3.economy", `unexpected ${JSON.stringify({ cash: next.cash, deposit: next.deposit, debt: next.debt })}`);
}

function checkGraph(): void {
  const edges: RelationshipEdge[] = [
    {
      from: "a",
      to: "b",
      socialBasis: "friend",
      intimacy: 40,
      trust: 40,
      affection: 40,
      authority: 10,
      giftDebt: 0,
      reciprocityScore: 0.4,
      relationAxis: "horizontal",
    },
  ];
  const g = new RelationshipGraph(edges);
  g.ensureEdge("b", "a", { relationAxis: "vertical_up" });
  g.upsert({ ...g.getEdge("a", "b")!, giftDebt: 12, reciprocityScore: 0.55 });
  const circle = g.neighbors("a");
  const hasFields =
    g.getEdge("a", "b")?.giftDebt === 12 &&
    g.getEdge("b", "a")?.relationAxis === "vertical_up" &&
    circle.length === 1;
  if (hasFields) pass("D2-A1.graph", `neighbors(a)=${circle.length}, giftDebt/axis ok`);
  else fail("D2-A1.graph", "CRUD/neighbors/fields failed");
  if (g.getEdge("a", "b")?.reciprocityScore === 0.55) pass("D2-A2.fields", "giftDebt/reciprocityScore/relationAxis");
  else fail("D2-A2.fields", "missing Yan fields");
}

function checkLedgerMachine(): void {
  const ledger = new GiftLedgerManager([
    {
      gid: "g1",
      from: "a",
      to: "b",
      expressiveScore: 0.5,
      instrumentalScore: 0.5,
      value: 100,
      adjustedValue: 50,
      description: "t",
      givenAt: { day: 1, slot: "AM" },
      replyWindowEnd: advanceSimTime({ day: 1, slot: "AM" }, 1),
      status: "pending_reply",
    },
  ]);
  const d1 = ledger.checkWindows({ day: 1, slot: "AM" });
  const d2 = ledger.checkWindows({ day: 1, slot: "EVE" });
  ledger.markReplied; // keep import use via method existence
  if (d1.length === 0 && d2.length === 1 && ledger.get("g1")?.status === "defaulted") {
    pass("D2-A4.ledger", "pending → defaulted on window");
  } else {
    fail("D2-A4.ledger", `d1=${d1.length} d2=${d2.length} status=${ledger.get("g1")?.status}`);
  }
}

function main(): void {
  checkEconomy();
  checkGraph();
  checkLedgerMachine();

  // frontend shell files
  const html = join(projectRoot, "sim/frontend/replay/index.html");
  const app = join(projectRoot, "sim/frontend/replay/app.js");
  if (existsSync(html) && existsSync(app)) pass("D2-B2.frontendFiles", "index.html + app.js");
  else fail("D2-B2.frontendFiles", "missing frontend shell");

  // seed + export
  const seedId = `verify_d2_${Date.now()}`;
  const seed = runCmd("sim:seed-gifts", { RUN_ID: seedId, END_SLOTS: "6", LLM_MODE: "mock" });
  if (seed.status === 0) pass("D2-B3.seed", `run=${seedId}`);
  else {
    fail("D2-B3.seed", seed.stderr || seed.stdout);
    printSummary();
    process.exit(1);
  }

  const exp = runCmd("frontend:export", { RUN_ID: seedId });
  if (exp.status === 0 && existsSync(join(projectRoot, "sim/frontend/replay/demo_data.json"))) {
    pass("D2-B2.demoData", "demo_data.json exported");
  } else {
    fail("D2-B2.demoData", exp.stderr || "export failed");
  }

  // replay seek
  const engine = new ReplayEngine();
  engine.loadExperiment(seedId, runsRoot);
  const snap = engine.seekTo({ day: 1, slot: "PM" });
  if (snap.giftLedger.length >= 2) pass("D2-B1.seekTo", `D1-PM gifts=${snap.giftLedger.length}`);
  else fail("D2-B1.seekTo", `expected >=2 gifts, got ${snap.giftLedger.length}`);

  const bySeq = engine.seekToSeq(snap.seq);
  if (bySeq.snapshotId) pass("D2-B1.seekToSeq", `seq=${bySeq.seq}`);
  else fail("D2-B1.seekToSeq", "failed");

  // rule path logs
  const logPath = join(runsRoot, seedId, "event_log.jsonl");
  const logs = readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);
  const types = new Set(logs.map((l) => l.type));
  for (const t of ["gift.given", "relationship.delta", "gift.defaulted", "gift.replied"] as const) {
    if (types.has(t)) pass(`D2.DoD.${t}`, "present");
    else fail(`D2.DoD.${t}`, "missing in event_log");
  }

  // trust rose after gift on an edge
  const d1am = engine.seekTo({ day: 1, slot: "AM" });
  const edge = d1am.relationships.find((e) => e.from === "a04" && e.to === "a01");
  if (edge && edge.trust > 40) pass("D2.DoD.trustUp", `a04→a01 trust=${edge.trust}`);
  else fail("D2.DoD.trustUp", `trust not increased: ${edge?.trust}`);

  // bilateral cash: a04 gave 300 to a01 at D1-AM (seed agents: a04=12000, a01=8000)
  const a04Cash = d1am.agents.a04?.economy.cash;
  const a01Cash = d1am.agents.a01?.economy.cash;
  if (a04Cash === 11700 && a01Cash === 8300) {
    pass("D2.cash.transfer", `a04=${a04Cash} a01=${a01Cash} (300 transferred)`);
  } else {
    fail("D2.cash.transfer", `expected a04=11700 a01=8300, got a04=${a04Cash} a01=${a01Cash}`);
  }

  // demo_data has gifts visible
  const demo = JSON.parse(readFileSync(join(projectRoot, "sim/frontend/replay/demo_data.json"), "utf8")) as {
    slots: Array<{ giftCount: number }>;
  };
  if (demo.slots.some((s) => s.giftCount >= 3)) pass("D2-B3.replayVisible", "demo slots show ≥3 gifts");
  else fail("D2-B3.replayVisible", "demo_data lacks gifts");

  printSummary();
  if (checks.some((c) => !c.ok)) process.exit(1);
  console.log(`\nD2 PASSED. Inspect run: ${join(runsRoot, seedId)}`);
  console.log("UI: npm run frontend:serve  →  http://127.0.0.1:5177/");
}

function printSummary(): void {
  console.log("\n=== D2 verify ===");
  for (const c of checks) {
    console.log(`${c.ok ? "OK" : "FAIL"}  ${c.id} — ${c.detail}`);
  }
}

main();
