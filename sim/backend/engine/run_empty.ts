import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExperimentConfig, RelationshipEdge, SimTime } from "../../shared/types/index.js";
import { LogWriter } from "../log/log_writer.js";
import { SnapshotStore } from "../store/snapshot_store.js";
import { WorldState } from "../store/world_state.js";
import { RuleEngine } from "../rules/rule_engine.js";
import { TimeScheduler } from "./scheduler.js";
import { loadAgents } from "../systems/person/loader.js";
import { createLlmClient, describeLlmClient } from "../llm/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

/** D1 default: 30 time slots (= 10 days × AM/PM/EVE). Override with END_SLOTS or END_DAY. */
const DEFAULT_SLOTS = 30;

function makeRunId(): string {
  const t = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `empty_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
}

function loadEdges(path: string): RelationshipEdge[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] };
  return raw.relationships;
}

async function main(): Promise<void> {
  const runId = process.env.RUN_ID ?? makeRunId();
  const start: SimTime = { day: 1, slot: "AM" };

  const llmPreference = (process.env.LLM_MODE as "mock" | "live" | "auto" | undefined) ?? "auto";
  const llm = createLlmClient(llmPreference);

  let slotCount = DEFAULT_SLOTS;
  let endDay: number;
  if (process.env.END_DAY) {
    endDay = Number(process.env.END_DAY);
    // days 1..endDay inclusive × 3 slots
    slotCount = endDay * 3;
  } else {
    slotCount = Number(process.env.END_SLOTS ?? DEFAULT_SLOTS);
    endDay = Math.ceil(slotCount / 3);
  }

  const config: ExperimentConfig = {
    runId,
    name: "empty-clock",
    startDay: 1,
    endDay,
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
    JSON.stringify({ ...config, slotCount, llm: describeLlmClient(llm) }, null, 2),
    "utf8",
  );

  const world = new WorldState(config);
  world.agents = loadAgents(join(dataDir, "agents.json"));
  world.relationships = loadEdges(join(dataDir, "relationships.json"));
  for (const id of Object.keys(world.agents)) {
    world.personalEventTables[id] = [];
  }

  const log = new LogWriter(runDir);
  const snapshots = new SnapshotStore(runDir);
  const rules = new RuleEngine({ log });

  log.append({ day: 1, slot: "AM" }, "experiment.start", {
    config,
    slotCount,
    llm: describeLlmClient(llm),
  });
  console.log("LLM:", describeLlmClient(llm));

  // D1-A3 smoke: illegal proposal must produce rule.rejected in JSONL
  const rejectResult = rules.commit(world, start, {
    kind: "give_gift",
    from: "a01",
    to: "a02",
    value: -100,
    expressiveScore: 0.5,
    description: "D1 illegal smoke",
  });
  if (rejectResult.ok) {
    throw new Error("D1 smoke failed: expected illegal give_gift to be rejected");
  }
  console.log("RuleEngine smoke reject:", rejectResult.reason);

  const scheduler = new TimeScheduler(world, log, snapshots, rules);
  const last = await scheduler.runSlots(start, slotCount);

  log.append(last, "experiment.end", {
    agents: Object.keys(world.agents).length,
    relationships: world.relationships.length,
    slotCount,
    logPath: log.path,
  });

  // Pointer for verify:d1
  writeFileSync(join(dataDir, "runs", "LATEST_EMPTY_RUN.txt"), runId, "utf8");

  console.log(`Empty run finished: ${runDir}`);
  console.log(
    `  agents=${Object.keys(world.agents).length} slots=${slotCount} last=${last.day}-${last.slot}`,
  );
  console.log(`  log=${log.path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
