/**
 * Phase 4 runner: economy/gift closure — R1/R3/R4/R6/R7 + GiftStrategyLLM.
 * Usage: npm run sim:p4
 * Optional: P4_LLM_MODE=live (requires AGENTSOCIETY_LLM_*).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExperimentConfig, RelationshipEdge, SimTime } from "../../shared/types/index.js";
import { nextSimTime } from "../../shared/types/index.js";
import { createLlmClient, describeLlmClient } from "../llm/client.js";
import { loadAgents } from "../systems/person/loader.js";
import { GiftLedgerManager } from "../systems/gift/ledger.js";
import { computeDebtActionBias, GiftStrategyLLM } from "../systems/gift/strategy.js";
import { Experiment } from "./experiment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

function loadEdges(path: string): RelationshipEdge[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] })
    .relationships;
}

async function main(): Promise<void> {
  const runId = process.env.RUN_ID ?? `p4_${Date.now()}`;
  const llmPreference =
    (process.env.P4_LLM_MODE as "mock" | "live" | "auto" | undefined) ?? "mock";
  const llm = createLlmClient(llmPreference);
  let time: SimTime = { day: 1, slot: "AM" };

  const config: ExperimentConfig = {
    runId,
    name: "phase4-economy-gift",
    startDay: 1,
    endDay: 2,
    seed: 42,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    enableOccasionNorms: true,
    enableAxisReciprocity: true,
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

  const strategy = new GiftStrategyLLM(llm);
  const faceBefore = exp.world.agents.a08!.public.face ?? 50;

  exp.log.append(time, "experiment.start", {
    config,
    llm: describeLlmClient(llm),
    phase: 4,
  });
  exp.log.append(time, "timeslot.start", { day: time.day, slot: time.slot });

  // --- A) Occasion-driven wedding via Event template (P4-12) ---
  const wedding = exp.generator.generateManual(
    exp.world,
    "private.wedding",
    time,
    exp.rng,
    {
      roleOverrides: {
        host: ["a01"],
        kin: ["a02"],
        guests: ["a04", "a06"],
      },
      payload: { occasion: "wedding", minGiftNorm: 200, replyWindowSlots: 9 },
      sourceAgentId: "a01",
    },
  );
  if (!wedding) throw new Error("failed to create wedding event");
  exp.world.eventQueue.push(wedding);
  exp.pipeline.process(exp.world, time, wedding);
  wedding.status = "completed";
  exp.world.metrics.eventsCompleted += 1;

  // --- B) R1 below-norm gift (etiquette breach, still commits) ---
  const r1 = exp.rules.commit(exp.world, time, {
    kind: "give_gift",
    from: "a08",
    to: "a01",
    value: 80,
    expressiveScore: 0.75,
    description: "婚礼随礼不足（R1 probe）",
    occasion: "wedding",
    minGiftNorm: 200,
    eid: wedding.eid,
    replyWindowSlots: 9,
  });
  if (!r1.ok) throw new Error(`R1 probe failed: ${r1.reason}`);

  // --- C) GiftStrategyLLM propose + clip + commit (P4-10 / R6) ---
  const bias = computeDebtActionBias(exp.world, "a07");
  const proposal = await strategy.propose(exp.world, "a07", time, {
    occasion: "wedding",
    minGiftNorm: 200,
    preferredTarget: "a01",
    forceHeuristic: llm.mode === "mock",
  });
  if (!proposal) throw new Error("GiftStrategyLLM returned null");
  const clipped = strategy.clipProposal(exp.world, "a07", proposal);
  if (clipped.rejected) throw new Error(`strategy rejected: ${clipped.rejectReason}`);
  const stratCommit = exp.rules.commit(exp.world, time, {
    kind: "give_gift",
    from: "a07",
    to: clipped.targetAgentId,
    value: clipped.value,
    expressiveScore: clipped.expressiveScore,
    description: clipped.description,
    occasion: clipped.occasion,
    minGiftNorm: 200,
    eid: wedding.eid,
  });
  if (!stratCommit.ok) throw new Error(`strategy commit failed: ${stratCommit.reason}`);

  // --- D) Instrumental gift branch (P4-11) ---
  const instr = exp.rules.commit(exp.world, time, {
    kind: "give_gift",
    from: "a06",
    to: "a04",
    value: 180,
    expressiveScore: 0.25,
    description: "托事人情（工具性）",
    occasion: "instrumental",
    replyWindowSlots: 6,
  });
  if (!instr.ok) throw new Error(`instrumental gift failed: ${instr.reason}`);

  const snap1 = exp.world.snapshot(time, exp.log.nextSeq());
  exp.snapshots.write(snap1);
  exp.log.append(
    time,
    "timeslot.end",
    {
      snapshotId: snap1.snapshotId,
      publicMemories: exp.world.publicMemories.length,
      giftLedger: exp.world.giftLedger.length,
      strategy: { proposal, clipped, bias },
      r1FaceBefore: faceBefore,
      r1FaceAfter: exp.world.agents.a08!.public.face,
    },
    { snapshotId: snap1.snapshotId },
  );

  // --- E) Axis repay: horizontal sufficient vs vertical_up symbolic (R3/R4) ---
  time = nextSimTime(time); // D1-PM
  exp.log.append(time, "timeslot.start", { day: time.day, slot: time.slot });

  // Horizontal open gift a06→a04 (instrumental): debtor a04 repays near adjustedValue
  const openInstr = exp.world.giftLedger.find(
    (g) => g.from === "a06" && g.to === "a04" && g.status === "pending_reply",
  );
  if (openInstr) {
    const repayH = exp.rules.commit(exp.world, time, {
      kind: "repay_gift",
      from: "a04",
      to: "a06",
      value: Math.ceil(openInstr.adjustedValue * 0.9),
      originalGid: openInstr.gid,
    });
    if (!repayH.ok) throw new Error(`horizontal repay failed: ${repayH.reason}`);
  }

  // Seed a vertical_up debt: a01 (superior) gifts a04; a04 looks up → symbolic repay OK
  const vertGift = exp.rules.commit(exp.world, time, {
    kind: "give_gift",
    from: "a01",
    to: "a04",
    value: 250,
    expressiveScore: 0.5,
    description: "上级馈赠（纵向）",
    replyWindowSlots: 9,
  });
  if (!vertGift.ok) throw new Error(`vertical gift failed: ${vertGift.reason}`);
  const openVert = exp.world.giftLedger.find(
    (g) => g.from === "a01" && g.to === "a04" && g.status === "pending_reply",
  );
  if (openVert) {
    // 35% of adjustedValue — OK under R4 vertical_up (min 30%)
    const repayV = exp.rules.commit(exp.world, time, {
      kind: "repay_gift",
      from: "a04",
      to: "a01",
      value: Math.max(1, Math.ceil(openVert.adjustedValue * 0.35)),
      originalGid: openVert.gid,
    });
    if (!repayV.ok) throw new Error(`vertical repay failed: ${repayV.reason}`);
  }

  const ledger = new GiftLedgerManager(exp.world.giftLedger);
  const between = ledger.queryBetween("a01", "a04");

  const snap2 = exp.world.snapshot(time, exp.log.nextSeq());
  exp.snapshots.write(snap2);
  exp.log.append(
    time,
    "timeslot.end",
    {
      snapshotId: snap2.snapshotId,
      queryBetween_a01_a04: between.length,
      metrics: exp.world.metrics,
    },
    { snapshotId: snap2.snapshotId },
  );

  exp.log.append(time, "experiment.end", {
    phase: 4,
    giftLedger: exp.world.giftLedger.length,
    publicMemories: exp.world.publicMemories.length,
    metrics: exp.world.metrics,
  });

  writeFileSync(join(dataDir, "runs", "LATEST_P4_RUN.txt"), runId, "utf8");
  console.log(`P4 run finished: ${runDir}`);
  console.log(`  gifts=${exp.world.giftLedger.length} publicMemories=${exp.world.publicMemories.length}`);
  console.log(`  metrics=`, exp.world.metrics);
  console.log(`  RUN_ID=${runId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
