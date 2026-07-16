/**
 * Phase 3 acceptance: three relationship channels, cognitive promotion, R5, prompt summaries.
 * Usage: npm run verify:p3
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type {
  CognitiveNode,
  LogEntry,
  RelationshipEdge,
  WorldSnapshot,
} from "../../shared/types/index.js";
import { loadAgents } from "../systems/person/loader.js";
import { RelationshipGraph } from "../systems/relationship/graph.js";
import { RelationshipSummarizer } from "../systems/relationship/summarizer.js";
import {
  CognitiveTreeManager,
  DIALOGUE_TO_RELATION_THRESHOLD,
} from "../cognition/cognitive_tree.js";
import { DialogPromptBuilder } from "../systems/dialogue/prompt.js";
import { WorldState } from "../store/world_state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
const pass = (id: string, detail: string) => checks.push({ id, ok: true, detail });
const fail = (id: string, detail: string) => checks.push({ id, ok: false, detail });

function main(): void {
  // Unit: graph social circle + summarizer
  const edges = (
    JSON.parse(readFileSync(join(dataDir, "relationships.json"), "utf8")) as {
      relationships: RelationshipEdge[];
    }
  ).relationships;
  const graph = new RelationshipGraph(edges);
  const neigh = graph.neighbors("a01");
  if (neigh.length >= 2) pass("P3-01.graph", `a01 neighbors=${neigh.length}`);
  else fail("P3-01.graph", `neighbors=${neigh.length}`);

  const hasAxisDebt = edges.some(
    (e) => typeof e.giftDebt === "number" && e.relationAxis && typeof e.reciprocityScore === "number",
  );
  if (hasAxisDebt) pass("P3-02.fields", "giftDebt/reciprocityScore/relationAxis present");
  else fail("P3-02.fields", "axis/debt fields missing");

  const agents = loadAgents(join(dataDir, "agents.json"));
  const summarizer = new RelationshipSummarizer();
  const sample = summarizer.summarizeEdge(edges[0]!, agents[edges[0]!.from], agents[edges[0]!.to]);
  if (sample.includes("trust=") && (sample.includes("横向") || sample.includes("纵向"))) {
    pass("P3-04.summarizer", sample.slice(0, 80));
  } else fail("P3-04.summarizer", sample);

  // Unit: cognitive promote threshold
  const ct = new CognitiveTreeManager({}, undefined, DIALOGUE_TO_RELATION_THRESHOLD);
  const t = { day: 1, slot: "AM" as const };
  ct.archiveDialogue({
    agentId: "a01",
    scope: "a04",
    cid: "c_unit",
    summary: "谈及婚礼随礼",
    keyFacts: ["随礼规范"],
    influenceScore: DIALOGUE_TO_RELATION_THRESHOLD,
    time: t,
  });
  const relationNodes = ct.activeNodes("a01", "relation");
  if (relationNodes.length === 1) {
    pass("P3-05.promote.unit", `relation node influence=${relationNodes[0]!.influenceSum}`);
  } else fail("P3-05.promote.unit", `relation nodes=${relationNodes.length}`);

  // Prompt contains 关系摘要 + 认知树 sections
  const world = new WorldState({
    runId: "tmp",
    name: "tmp",
    startDay: 1,
    endDay: 1,
    seed: 1,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    llmMode: "mock",
  });
  world.agents = agents;
  world.relationships = edges;
  world.cognitiveTrees = ct.all();
  world.personalEventTables.a01 = [];
  const built = new DialogPromptBuilder().build({
    world,
    selfId: "a01",
    otherIds: ["a04"],
    event: {
      eid: "e_tmp",
      templateId: "private.wedding",
      category: "private",
      subType: "wedding",
      visibility: "private",
      time: t,
      location: "x",
      status: "processing",
      roleBindings: { host: ["a01"], guests: ["a04"] },
      goals: [],
      summary: "wedding",
      payload: {},
      source: "manual",
      requiredAgentIds: ["a01"],
      priority: 1,
      dialogue: {
        mode: "dialogue",
        minParticipants: 2,
        maxParticipants: 4,
        maxTurns: 6,
        forced: true,
      },
    },
    mode: "dialogue",
    history: [],
    knowledge: [],
  });
  if (built.user.includes("[关系摘要]") && built.user.includes("[认知树]")) {
    pass("P3-04.prompt", "DialogPromptBuilder injects relation + cognition");
  } else fail("P3-04.prompt", "missing prompt sections");

  const runId = `verify_p3_${Date.now()}`;
  const r = spawnSync("npm", ["run", "sim:p3"], {
    cwd: projectRoot,
    env: { ...process.env, RUN_ID: runId, P3_LLM_MODE: "mock" },
    encoding: "utf8",
    shell: true,
  });
  if (r.status === 0) pass("P3.run.mock", runId);
  else {
    fail("P3.run.mock", (r.stderr || r.stdout).slice(0, 1200));
    print();
    process.exit(1);
  }

  const runDir = join(dataDir, "runs", runId);
  const logPath = join(runDir, "event_log.jsonl");
  const snapPath = join(runDir, "snapshots", "D1-AM.json");
  const logs = readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((x) => JSON.parse(x) as LogEntry);

  const dialogueDelta = logs.find(
    (x) =>
      x.type === "relationship.delta" &&
      String((x.payload as { reason?: string }).reason).includes("dialogue"),
  );
  const giftDelta = logs.find(
    (x) =>
      x.type === "relationship.delta" &&
      String((x.payload as { reason?: string }).reason).includes("gift"),
  );
  const defaultDelta = logs.find(
    (x) =>
      x.type === "relationship.delta" &&
      String((x.payload as { reason?: string }).reason).includes("defaulted"),
  );
  if (dialogueDelta) pass("P3-03.channel.dialogue", "dialogue delta present");
  else fail("P3-03.channel.dialogue", "missing");
  if (giftDelta) pass("P3-03.channel.gift", "gift delta present");
  else fail("P3-03.channel.gift", "missing");
  if (defaultDelta) pass("P3-03.channel.default", "defaulted delta present");
  else fail("P3-03.channel.default", "missing");

  const promoted = logs.filter((x) => x.type === "cognitive.promoted");
  if (promoted.length >= 1) {
    pass("P3-05.cognitive.promoted", `count=${promoted.length}`);
  } else fail("P3-05.cognitive.promoted", "no cognitive.promoted log");

  const giftGiven = logs.find((x) => x.type === "gift.given");
  const gp = giftGiven?.payload as {
    before?: {
      hostPrestige?: number;
      social?: { receiver?: { prestige?: number }; giver?: { face?: number } };
    };
    after?: {
      hostPrestige?: number;
      social?: { receiver?: { prestige?: number }; giver?: { face?: number } };
    };
    socialDeltas?: { receiverPrestige?: number };
  } | undefined;
  const beforePrestige =
    gp?.before?.social?.receiver?.prestige ?? gp?.before?.hostPrestige;
  const afterPrestige =
    gp?.after?.social?.receiver?.prestige ?? gp?.after?.hostPrestige;
  if (
    beforePrestige !== undefined &&
    afterPrestige !== undefined &&
    afterPrestige > beforePrestige
  ) {
    pass("P3-08.prestige", `host prestige ${beforePrestige}→${afterPrestige}`);
  } else if ((gp?.socialDeltas?.receiverPrestige ?? 0) > 0) {
    pass("P3-08.prestige", `receiverPrestigeΔ=${gp!.socialDeltas!.receiverPrestige}`);
  } else fail("P3-08.prestige", JSON.stringify(gp?.after ?? gp?.socialDeltas ?? gp));

  const snap = JSON.parse(readFileSync(snapPath, "utf8")) as WorldSnapshot;
  if (snap.cognitiveTrees && Object.keys(snap.cognitiveTrees).length > 0) {
    const allNodes = Object.values(snap.cognitiveTrees).flat() as CognitiveNode[];
    const relation = allNodes.filter((n) => n.layer === "relation" && !n.archived);
    if (relation.length >= 1) {
      pass("P3.snapshot.cognition", `relation nodes=${relation.length}`);
    } else fail("P3.snapshot.cognition", `nodes=${allNodes.length}, relation=0`);
  } else fail("P3.snapshot.cognition", "cognitiveTrees missing");

  // Receiver (host a01) owes repay Intentions after guests gift.
  const a01 = snap.agents.a01;
  const repayKeys = Object.keys(a01?.private.intentions ?? {}).filter((k) =>
    k.startsWith("repay:"),
  );
  if (repayKeys.length >= 1) {
    pass("P3-07.intention", `host repay intentions=${repayKeys.length}`);
  } else fail("P3-07.intention", "no repay intention on gift receiver");

  const finalSnapPath = join(runDir, "snapshots", "D2-AM.json");
  if (typesHas(logs, "gift.defaulted") && existsSync(finalSnapPath)) {
    const finalSnap = JSON.parse(readFileSync(finalSnapPath, "utf8")) as WorldSnapshot;
    if (finalSnap.metrics.giftDefaulted >= 1) {
      pass("P3.DoD.default", `giftDefaulted=${finalSnap.metrics.giftDefaulted}`);
    } else fail("P3.DoD.default", "gift.defaulted log but metric=0");
  } else fail("P3.DoD.default", "gift.defaulted / D2-AM missing");

  if (existsSync(join(dataDir, "runs", "LATEST_P3_RUN.txt"))) {
    pass("P3.pointer", "LATEST_P3_RUN.txt written");
  }

  print();
  if (checks.some((x) => !x.ok)) process.exit(1);
  console.log(`\nP3 PASSED. Inspect: ${runDir}`);
}

function typesHas(logs: LogEntry[], type: LogEntry["type"]): boolean {
  return logs.some((x) => x.type === type);
}

function print(): void {
  console.log("\n=== P3 verify ===");
  for (const c of checks) console.log(`${c.ok ? "OK" : "FAIL"}  ${c.id} — ${c.detail}`);
}

main();
