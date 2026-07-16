/**
 * Phase 3 runner: relationship channels + cognitive tree (dialogue→relation) + R5 face/prestige.
 * Usage: npm run sim:p3
 * Optional: P3_LLM_MODE=live (requires AGENTSOCIETY_LLM_*).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExperimentConfig, RelationshipEdge, SimTime } from "../../shared/types/index.js";
import { nextSimTime } from "../../shared/types/index.js";
import { createLlmClient, describeLlmClient } from "../llm/client.js";
import { loadAgents } from "../systems/person/loader.js";
import { PersonalEventTableManager } from "../systems/event/pet.js";
import {
  ConversationTable,
  DialogueController,
  KnowledgeBase,
} from "../systems/dialogue/index.js";
import { listActionableIntentions } from "../cognition/bdi.js";
import { Experiment } from "./experiment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

function loadEdges(path: string): RelationshipEdge[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] })
    .relationships;
}

async function main(): Promise<void> {
  const runId = process.env.RUN_ID ?? `p3_${Date.now()}`;
  const llmPreference =
    (process.env.P3_LLM_MODE as "mock" | "live" | "auto" | undefined) ?? "mock";
  const llm = createLlmClient(llmPreference);
  let time: SimTime = { day: 1, slot: "AM" };
  const config: ExperimentConfig = {
    runId,
    name: "phase3-relation-cognition",
    startDay: 1,
    endDay: 2,
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
  for (const id of Object.keys(exp.world.agents)) {
    exp.world.personalEventTables[id] = [];
    exp.world.cognitiveTrees[id] = [];
  }

  const hostPrestigeBefore = exp.world.agents.a01!.public.prestige ?? 0;

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
    phase: 3,
  });
  exp.log.append(time, "timeslot.start", { day: time.day, slot: time.slot });

  const pet = new PersonalEventTableManager(exp.log);
  const affected = pet.propagate(exp.world, time, event);
  pet.syncBeliefs(exp.world, time, affected);

  const knowledge = new KnowledgeBase();
  knowledge.load(join(dataDir, "knowledge", "gift_norms.json"));
  const table = new ConversationTable(join(runDir, "conversation_table.jsonl"));
  const controller = new DialogueController(llm, exp.rules, knowledge, table, exp.log);

  // Channel 1 — dialogue relationship deltas + cognitive tree archive/promote
  const primary = await controller.run({
    world: exp.world,
    event,
    time,
    participants: ["a01", "a04"],
    mode: "dialogue",
    minTurns: 6,
    maxTurns: 6,
  });

  // Channel 2 — gift / R5 prestige via EventPipeline → RuleEngine
  exp.pipeline.process(exp.world, time, event);
  event.status = "completed";
  exp.world.metrics.eventsCompleted += 1;

  const hostPrestigeAfter = exp.world.agents.a01!.public.prestige ?? 0;
  const hostIntentions = listActionableIntentions(
    exp.world.agents.a01!.private,
    time,
  );

  const snap1 = exp.world.snapshot(time, exp.log.nextSeq());
  exp.snapshots.write(snap1);
  exp.log.append(
    time,
    "timeslot.end",
    {
      snapshotId: snap1.snapshotId,
      hostPrestigeBefore,
      hostPrestigeAfter,
      actionableIntentions: hostIntentions.length,
    },
    { snapshotId: snap1.snapshotId },
  );

  // Channel 3 — default: short-window gift then check strictly after replyWindowEnd
  time = nextSimTime(time); // D1-PM
  exp.log.append(time, "timeslot.start", { day: time.day, slot: time.slot });
  const defaultGift = exp.rules.commit(exp.world, time, {
    kind: "give_gift",
    from: "a08",
    to: "a07",
    value: 120,
    expressiveScore: 0.4,
    description: "P3 default-channel probe gift",
    replyWindowSlots: 1, // ends at D1-EVE
    occasion: undefined,
  });
  if (!defaultGift.ok) throw new Error(`default probe gift failed: ${defaultGift.reason}`);
  const snapPm = exp.world.snapshot(time, exp.log.nextSeq());
  exp.snapshots.write(snapPm);
  exp.log.append(
    time,
    "timeslot.end",
    { snapshotId: snapPm.snapshotId },
    { snapshotId: snapPm.snapshotId },
  );

  time = nextSimTime(time); // D1-EVE = window end (not yet strictly after)
  exp.log.append(time, "timeslot.start", { day: time.day, slot: time.slot });
  exp.log.append(time, "timeslot.end", { note: "waiting past reply window" });

  time = nextSimTime(time); // D2-AM — strictly after window → default
  exp.log.append(time, "timeslot.start", { day: time.day, slot: time.slot });
  exp.rules.commit(exp.world, time, { kind: "gift_window_check" });

  const snap2 = exp.world.snapshot(time, exp.log.nextSeq());
  exp.snapshots.write(snap2);
  exp.log.append(
    time,
    "timeslot.end",
    { snapshotId: snap2.snapshotId },
    { snapshotId: snap2.snapshotId },
  );

  exp.log.append(time, "experiment.end", {
    cid: primary.cid,
    conversations: exp.world.conversations.length,
    cognitivePromotions: exp.world.metrics.cognitivePromotions,
    metrics: exp.world.metrics,
    gifts: exp.world.giftLedger.length,
    hostPrestigeBefore,
    hostPrestigeAfter,
  });
  writeFileSync(join(dataDir, "runs", "LATEST_P3_RUN.txt"), runId, "utf8");
  console.log(`P3 run finished: ${runDir}`);
  console.log(`  llm=${llm.mode} conversations=${exp.world.conversations.length}`);
  console.log(
    `  cognitivePromotions=${exp.world.metrics.cognitivePromotions} gifts=${exp.world.giftLedger.length}`,
  );
  console.log(
    `  hostPrestige ${hostPrestigeBefore}→${hostPrestigeAfter} defaulted=${exp.world.metrics.giftDefaulted}`,
  );
  console.log(`  RUN_ID=${runId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
