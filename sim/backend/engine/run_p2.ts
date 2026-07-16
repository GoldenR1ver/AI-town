/**
 * Phase 2 runner: a wedding event triggers dialogue before rule-based gift settlement.
 * Usage: npm run sim:p2
 * Optional: P2_LLM_MODE=live (requires AGENTSOCIETY_LLM_*).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExperimentConfig, RelationshipEdge, SimTime } from "../../shared/types/index.js";
import { createLlmClient, describeLlmClient } from "../llm/client.js";
import { loadAgents } from "../systems/person/loader.js";
import { PersonalEventTableManager } from "../systems/event/pet.js";
import {
  ConversationTable,
  DialogueController,
  KnowledgeBase,
} from "../systems/dialogue/index.js";
import { Experiment } from "./experiment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

function loadEdges(path: string): RelationshipEdge[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] })
    .relationships;
}

async function main(): Promise<void> {
  const runId = process.env.RUN_ID ?? `p2_${Date.now()}`;
  const llmPreference =
    (process.env.P2_LLM_MODE as "mock" | "live" | "auto" | undefined) ?? "mock";
  const llm = createLlmClient(llmPreference);
  const time: SimTime = { day: 1, slot: "AM" };
  const config: ExperimentConfig = {
    runId,
    name: "phase2-dialogue",
    startDay: 1,
    endDay: 1,
    seed: 42,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    llmMode: llm.mode,
  };
  const runDir = join(dataDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "config.json"),
    JSON.stringify({ ...config, llm: describeLlmClient(llm) }, null, 2),
    "utf8",
  );

  const exp = new Experiment(config, {
    runDir,
    templatesDir: join(dataDir, "event_templates"),
  });
  exp.world.agents = loadAgents(join(dataDir, "agents.json"));
  exp.world.relationships = loadEdges(join(dataDir, "relationships.json"));
  for (const id of Object.keys(exp.world.agents)) exp.world.personalEventTables[id] = [];

  const event = exp.generator.generateManual(
    exp.world,
    "private.wedding",
    time,
    exp.rng,
    {
      roleOverrides: {
        host: ["a01"],
        kin: ["a02"],
        guests: ["a04"],
      },
      payload: { occasion: "wedding", minGiftNorm: 200, replyWindowSlots: 9 },
      sourceAgentId: "a01",
    },
  );
  if (!event) throw new Error("failed to create wedding event");
  exp.world.eventQueue.push(event);

  exp.log.append(time, "experiment.start", {
    config,
    llm: describeLlmClient(llm),
    phase: 2,
  });
  exp.log.append(time, "timeslot.start", { day: time.day, slot: time.slot });

  // Event knowledge reaches participants before they talk.
  const pet = new PersonalEventTableManager(exp.log);
  const affected = pet.propagate(exp.world, time, event);
  pet.syncBeliefs(exp.world, time, affected);

  const knowledge = new KnowledgeBase();
  knowledge.load(join(dataDir, "knowledge", "gift_norms.json"));
  const table = new ConversationTable(join(runDir, "conversation_table.jsonl"));
  const controller = new DialogueController(llm, exp.rules, knowledge, table, exp.log);

  const primary = await controller.run({
    world: exp.world,
    event,
    time,
    participants: ["a01", "a04"],
    mode: "dialogue",
    minTurns: 4,
    maxTurns: 6,
  });

  // Exercise all supported controller modes in the phase acceptance run.
  if (process.env.P2_ALL_MODES !== "0") {
    await controller.run({
      world: exp.world,
      event,
      time,
      participants: ["a01", "a02", "a04"],
      mode: "host",
      minTurns: 4,
      maxTurns: 4,
    });
    await controller.run({
      world: exp.world,
      event,
      time,
      participants: ["a01", "a02", "a04"],
      mode: "random",
      minTurns: 4,
      maxTurns: 4,
    });
  }

  // Dialogue is narrative; actual gifts/state changes still go through EventPipeline/RuleEngine.
  exp.pipeline.process(exp.world, time, event);
  event.status = "completed";
  exp.world.metrics.eventsCompleted += 1;

  const snap = exp.world.snapshot(time, exp.log.nextSeq());
  exp.snapshots.write(snap);
  exp.log.append(
    time,
    "timeslot.end",
    { snapshotId: snap.snapshotId },
    { snapshotId: snap.snapshotId },
  );
  exp.log.append(time, "experiment.end", {
    cid: primary.cid,
    conversations: exp.world.conversations.length,
    metrics: exp.world.metrics,
    gifts: exp.world.giftLedger.length,
  });
  writeFileSync(join(dataDir, "runs", "LATEST_P2_RUN.txt"), runId, "utf8");
  console.log(`P2 run finished: ${runDir}`);
  console.log(`  llm=${llm.mode} conversations=${exp.world.conversations.length}`);
  console.log(`  messages=${exp.world.metrics.dialogueMessages} gifts=${exp.world.giftLedger.length}`);
  console.log(`  RUN_ID=${runId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
