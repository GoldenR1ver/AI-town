/**
 * Phase 1 runner: scheduled wedding + instrumental gift + repay via Event pipeline.
 * Usage: npm run sim:p1
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExperimentConfig, RelationshipEdge, SimTime } from "../../shared/types/index.js";
import { loadAgents } from "../systems/person/loader.js";
import { Experiment } from "./experiment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

function loadEdges(path: string): RelationshipEdge[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] }).relationships;
}

async function main(): Promise<void> {
  const runId = process.env.RUN_ID ?? `p1_${Date.now()}`;
  const slotCount = Number(process.env.END_SLOTS ?? 6);

  const config: ExperimentConfig = {
    runId,
    name: "phase1-event-pipeline",
    startDay: 1,
    endDay: Math.ceil(slotCount / 3),
    seed: Number(process.env.SEED ?? 42),
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: true,
    llmMode: "mock",
  };

  const runDir = join(dataDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "config.json"), JSON.stringify(config, null, 2), "utf8");

  const exp = new Experiment(config, {
    runDir,
    templatesDir: join(dataDir, "event_templates"),
  });

  exp.world.agents = loadAgents(join(dataDir, "agents.json"));
  exp.world.relationships = loadEdges(join(dataDir, "relationships.json"));
  for (const id of Object.keys(exp.world.agents)) {
    exp.world.personalEventTables[id] = [];
  }

  // D1-PM: instrumental gift a06 → top-trust (a04)
  exp.queueManual({
    templateId: "private.instrumental_gift",
    sourceAgentId: "a06",
    onlyAt: { day: 1, slot: "PM" },
  });

  // D2-PM: repay open debt where possible (override roles dynamically at queue time — set placeholders)
  exp.queueManual({
    templateId: "private.repay_gift",
    onlyAt: { day: 2, slot: "PM" },
    roleOverrides: { debtor: ["a04"], creditor: ["a06"] },
  });

  exp.log.append({ day: 1, slot: "AM" }, "experiment.start", {
    config,
    templates: exp.library.all().map((t) => t.templateId),
  });

  const start: SimTime = { day: 1, slot: "AM" };
  const last = await exp.scheduler.runSlots(start, slotCount);

  exp.log.append(last, "experiment.end", {
    metrics: exp.world.metrics,
    gifts: exp.world.giftLedger.length,
    events: exp.world.eventQueue.length,
  });

  writeFileSync(join(dataDir, "runs", "LATEST_P1_RUN.txt"), runId, "utf8");

  console.log(`P1 run finished: ${runDir}`);
  console.log(`  templates=${exp.library.all().length}`);
  console.log(`  metrics=`, exp.world.metrics);
  console.log(`  giftLedger=${exp.world.giftLedger.length}`);
  console.log(`  RUN_ID=${runId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
