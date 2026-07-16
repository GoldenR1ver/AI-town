/**
 * D2/P4 seed run: occasion-driven gifts + relationship deltas + window/repay.
 * Usage: npm run sim:seed-gifts
 * Optional: SEED_OCCASION=1 uses wedding EventTemplate (P4-12).
 */
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
import {
  EventTemplateLibrary,
  EventGenerator,
  EventPipeline,
  createRng,
  resetEidCounter,
} from "../systems/event/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

function loadEdges(path: string): RelationshipEdge[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] };
  return raw.relationships;
}

async function main(): Promise<void> {
  const runId = process.env.RUN_ID ?? `seed_gifts_${Date.now()}`;
  const slotCount = Number(process.env.END_SLOTS ?? 6);
  const occasionDriven = process.env.SEED_OCCASION === "1";

  const config: ExperimentConfig = {
    runId,
    name: occasionDriven ? "seed-gifts-p4-occasion" : "seed-gifts-d2",
    startDay: 1,
    endDay: Math.ceil(slotCount / 3),
    seed: 42,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    enableOccasionNorms: true,
    enableAxisReciprocity: true,
    llmMode: "mock",
  };

  const runDir = join(dataDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "config.json"), JSON.stringify(config, null, 2), "utf8");

  resetEidCounter();
  const world = new WorldState(config);
  world.agents = loadAgents(join(dataDir, "agents.json"));
  world.relationships = loadEdges(join(dataDir, "relationships.json"));
  for (const id of Object.keys(world.agents)) {
    world.personalEventTables[id] = [];
  }

  const log = new LogWriter(runDir);
  const snapshots = new SnapshotStore(runDir);
  const rules = new RuleEngine({
    log,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
    enableAxisReciprocity: true,
  });

  const library = new EventTemplateLibrary();
  library.loadFromDir(join(dataDir, "event_templates"));
  const generator = new EventGenerator(library, log);
  const pipeline = new EventPipeline(rules, log);
  const rng = createRng(config.seed);

  log.append(
    { day: 1, slot: "AM" },
    "experiment.start",
    { config, purpose: occasionDriven ? "P4 occasion seed" : "D2 seed gifts" },
  );

  let giftsInjected = 0;
  const scheduler = new TimeScheduler(world, log, snapshots, rules, {
    onGenerateEvents: (w, time) => {
      if (time.day === 1 && time.slot === "AM") {
        if (occasionDriven) {
          const ev = generator.generateManual(w, "private.wedding", time, rng, {
            roleOverrides: {
              host: ["a01"],
              kin: ["a02"],
              guests: ["a04"],
            },
            payload: { occasion: "wedding", minGiftNorm: 200, replyWindowSlots: 2 },
            sourceAgentId: "a01",
          });
          if (!ev) throw new Error("occasion seed: wedding event failed");
          w.eventQueue.push(ev);
          pipeline.process(w, time, ev);
          ev.status = "completed";
          giftsInjected += w.giftLedger.filter((g) => g.eid === ev.eid).length;
        } else {
          // a04→a01: ritual gift (vertical_up, no window-default) — D2 cash/trust checks
          const r1 = rules.commit(w, time, {
            kind: "give_gift",
            from: "a04",
            to: "a01",
            value: 300,
            expressiveScore: 0.6,
            description: "婚礼随礼",
            occasion: "wedding",
            minGiftNorm: 200,
            replyWindowSlots: 12,
          });
          if (!r1.ok) throw new Error(r1.reason);
          giftsInjected++;
          // Horizontal short-window gift → should default under giftWindowCheck
          const r2 = rules.commit(w, time, {
            kind: "give_gift",
            from: "a08",
            to: "a07",
            value: 120,
            expressiveScore: 0.5,
            description: "短窗违约探针",
            occasion: "instrumental",
            replyWindowSlots: 2,
          });
          if (!r2.ok) throw new Error(r2.reason);
          giftsInjected++;
        }
      }
      if (time.day === 1 && time.slot === "PM") {
        const r = rules.commit(w, time, {
          kind: "give_gift",
          from: "a06",
          to: "a04",
          value: 150,
          expressiveScore: 0.3,
          description: "人情往来",
          occasion: "instrumental",
          replyWindowSlots: 12,
        });
        if (!r.ok) throw new Error(r.reason);
        giftsInjected++;
      }
      if (time.day === 1 && time.slot === "EVE") {
        const r = rules.commit(w, time, {
          kind: "give_gift",
          from: "a02",
          to: "a01",
          value: 200,
          expressiveScore: 0.7,
          description: "亲属随礼",
          occasion: "wedding",
          minGiftNorm: 200,
          replyWindowSlots: 12,
        });
        if (!r.ok) throw new Error(r.reason);
        giftsInjected++;
      }
      // Repay the a06→a04 gift on D2-PM (debtor a04 → creditor a06)
      if (time.day === 2 && time.slot === "PM") {
        const open = w.giftLedger.find(
          (g) => g.status === "pending_reply" && g.from === "a06" && g.to === "a04",
        );
        if (open) {
          const r = rules.commit(w, time, {
            kind: "repay_gift",
            from: "a04",
            to: "a06",
            value: Math.max(open.adjustedValue, 120),
            originalGid: open.gid,
          });
          if (!r.ok) throw new Error(r.reason);
        }
      }
    },
    onGiftWindowCheck: (w, time) => {
      rules.commit(w, time, { kind: "gift_window_check" });
    },
  });

  const start: SimTime = { day: 1, slot: "AM" };
  const last = await scheduler.runSlots(start, slotCount);

  log.append(last, "experiment.end", {
    giftsInjected,
    giftLedger: world.giftLedger.length,
    publicMemories: world.publicMemories.length,
    metrics: world.metrics,
  });

  writeFileSync(join(dataDir, "runs", "LATEST_SEED_RUN.txt"), runId, "utf8");

  console.log(`Seed gifts run finished: ${runDir}`);
  console.log(`  giftsInjected=${giftsInjected} ledger=${world.giftLedger.length}`);
  console.log(`  publicMemories=${world.publicMemories.length} occasionDriven=${occasionDriven}`);
  console.log(`  metrics=`, world.metrics);
  console.log(`  RUN_ID=${runId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
