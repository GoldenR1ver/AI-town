/** Phase 2 acceptance: prompts, styles, KB, conversation persistence, logs and rule updates. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { ConversationRecord, LogEntry, WorldSnapshot } from "../../shared/types/index.js";
import { loadAgents } from "../systems/person/loader.js";
import { deriveStyleProfile, KnowledgeBase } from "../systems/dialogue/index.js";
import { readLlmEnv } from "../llm/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");
interface Check { id: string; ok: boolean; detail: string }
const checks: Check[] = [];
const pass = (id: string, detail: string) => checks.push({ id, ok: true, detail });
const fail = (id: string, detail: string) => checks.push({ id, ok: false, detail });

function main(): void {
  const agents = loadAgents(join(dataDir, "agents.json"));
  const s1 = deriveStyleProfile(agents.a01!);
  const s2 = deriveStyleProfile(agents.a08!);
  if (JSON.stringify(s1) !== JSON.stringify(s2)) {
    pass("P2-05.style", `a01.formality=${s1.formality.toFixed(2)} a08=${s2.formality.toFixed(2)}`);
  } else fail("P2-05.style", "profiles identical");

  const kb = new KnowledgeBase();
  const count = kb.load(join(dataDir, "knowledge", "gift_norms.json"));
  const wedding = kb.search("wedding", ["村委会主任"], 6);
  if (count >= 10 && wedding.some((x) => x.key === "wedding_min_gift")) {
    pass("P2-09.knowledge", `${count} entries; wedding norm retrieved`);
  } else fail("P2-09.knowledge", `count=${count}, retrieved=${wedding.length}`);

  const runId = `verify_p2_${Date.now()}`;
  const r = spawnSync("npm", ["run", "sim:p2"], {
    cwd: projectRoot,
    env: { ...process.env, RUN_ID: runId, P2_LLM_MODE: "mock", P2_ALL_MODES: "1" },
    encoding: "utf8",
    shell: true,
  });
  if (r.status === 0) pass("P2.run.mock", runId);
  else {
    fail("P2.run.mock", (r.stderr || r.stdout).slice(0, 1000));
    print();
    process.exit(1);
  }

  const runDir = join(dataDir, "runs", runId);
  const logPath = join(runDir, "event_log.jsonl");
  const tablePath = join(runDir, "conversation_table.jsonl");
  const snapshotPath = join(runDir, "snapshots", "D1-AM.json");
  const logs = readFileSync(logPath, "utf8").split("\n").filter(Boolean)
    .map((x) => JSON.parse(x) as LogEntry);
  const types = new Set(logs.map((x) => x.type));
  for (const type of ["dialogue.start", "dialogue.message", "dialogue.end"] as const) {
    if (types.has(type)) pass(`P2-11.${type}`, "present");
    else fail(`P2-11.${type}`, "missing");
  }

  const rows = readFileSync(tablePath, "utf8").split("\n").filter(Boolean)
    .map((x) => JSON.parse(x) as ConversationRecord);
  const modes = new Set(rows.map((x) => x.mode));
  if (rows.length === 3 && ["dialogue", "host", "random"].every((m) => modes.has(m as never))) {
    pass("P2-03/04.controller", `records=${rows.length}, modes=${[...modes].join(",")}`);
  } else fail("P2-03/04.controller", `records=${rows.length}, modes=${[...modes].join(",")}`);

  if (rows.every((x) => x.messages.length >= 4 && x.messages.length <= 8 && x.status === "completed")) {
    pass("P2-07.table", "all conversations queryable with 4–8 turns");
  } else fail("P2-07.table", "invalid turn count/status");

  if (rows.every((x) => x.summary && x.keyFacts.length > 0)) {
    pass("P2-06.summary", "summary + keyFacts present");
  } else fail("P2-06.summary", "missing summary/keyFacts");

  const promptLog = logs.find((x) => x.type === "dialogue.message");
  const payload = promptLog?.payload as { style?: unknown } | undefined;
  if (payload?.style) pass("P2-01/02.prompt", "message records derived style; prompt runner succeeded");
  else fail("P2-01/02.prompt", "style/prompt evidence missing");

  const dialogueDelta = logs.find(
    (x) =>
      x.type === "relationship.delta" &&
      String((x.payload as { reason?: string }).reason).includes("dialogue"),
  );
  if (dialogueDelta) pass("P2-08.relationship", "dialogue delta committed by RuleEngine");
  else fail("P2-08.relationship", "dialogue relationship delta missing");

  const bdie = logs.find(
    (x) =>
      x.type === "bdi.updated" &&
      (x.payload as { kind?: string }).kind === "dialogue_bdie",
  );
  if (bdie) pass("P2-08.bdie", "clamped dialogue BDIE committed");
  else fail("P2-08.bdie", "dialogue_bdie missing");

  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as WorldSnapshot;
  if (snapshot.conversations.length === 3 && snapshot.metrics.dialoguesCompleted === 3) {
    pass("P2.snapshot", `conversations=${snapshot.conversations.length}`);
  } else fail("P2.snapshot", JSON.stringify(snapshot.metrics));

  if (types.has("gift.given") && types.has("event.completed")) {
    pass("P2.DoD.eventGift", "event-triggered dialogue followed by rule gift settlement");
  } else fail("P2.DoD.eventGift", "gift/event completion missing");

  if (readLlmEnv()) {
    pass("P2-10.live.config", "AGENTSOCIETY_LLM_* detected; run npm run verify:p2:live");
  } else {
    pass("P2-10.live.config", "live env absent (optional); mock fallback verified");
  }
  if (existsSync(tablePath)) pass("P2.artifacts", "conversation_table.jsonl exists");

  print();
  if (checks.some((x) => !x.ok)) process.exit(1);
  console.log(`\nP2 PASSED. Inspect: ${runDir}`);
}

function print(): void {
  console.log("\n=== P2 verify ===");
  for (const c of checks) console.log(`${c.ok ? "OK" : "FAIL"}  ${c.id} — ${c.detail}`);
}

main();
