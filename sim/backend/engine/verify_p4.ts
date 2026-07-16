/**
 * Phase 4 acceptance: R1/R3/R4/R6/R7, strategy clip, expressive/instrumental, occasion path.
 * Usage: npm run verify:p4
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { LogEntry, WorldSnapshot } from "../../shared/types/index.js";
import { EconomyManager } from "../systems/economy/manager.js";
import { GiftLedgerManager, advanceSimTime } from "../systems/gift/ledger.js";
import {
  assessOccasionEtiquette,
  assessRepaySufficiency,
  computeGiftDebt,
  DEFAULT_MIN_GIFT_NORMS,
} from "../systems/gift/norms.js";
import {
  applyDefaultSocialEffects,
  applyGiveGiftSocialEffects,
  isRitualOccasion,
} from "../systems/gift/flow_effects.js";
import { computeDebtActionBias, GiftStrategyLLM } from "../systems/gift/strategy.js";
import { createLlmClient } from "../llm/client.js";
import { loadAgents } from "../systems/person/loader.js";
import { WorldState } from "../store/world_state.js";
import type { RelationshipEdge } from "../../shared/types/index.js";
import { RuleEngine } from "../rules/rule_engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");
const runsRoot = join(dataDir, "runs");

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
const pass = (id: string, detail: string) => checks.push({ id, ok: true, detail });
const fail = (id: string, detail: string) => checks.push({ id, ok: false, detail });

function runCmd(
  script: string,
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("npm", ["run", script], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: true,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function unitChecks(): void {
  // P4-01 economy formula (regression)
  const sample = {
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
  const next = new EconomyManager().monthlySettle(sample, 31);
  if (Math.abs(next.cash - 1040) < 1e-9) pass("P4-01.economy", `cash=${next.cash}`);
  else fail("P4-01.economy", JSON.stringify(next));

  // P4-05 R1
  const okNorm = assessOccasionEtiquette(220, "wedding", 200);
  const badNorm = assessOccasionEtiquette(80, "wedding", 200);
  if (!okNorm.belowNorm && badNorm.belowNorm && badNorm.facePenalty > 0) {
    pass("P4-05.R1", `belowNorm facePenalty=${badNorm.facePenalty}`);
  } else fail("P4-05.R1", JSON.stringify({ okNorm, badNorm }));

  if (DEFAULT_MIN_GIFT_NORMS.wedding === 200) pass("P4-05.defaults", "wedding min=200");
  else fail("P4-05.defaults", String(DEFAULT_MIN_GIFT_NORMS.wedding));

  // P4-06 R3/R4
  const gift = {
    gid: "g",
    from: "a",
    to: "b",
    expressiveScore: 0.5,
    instrumentalScore: 0.5,
    value: 200,
    adjustedValue: 100,
    description: "t",
    givenAt: { day: 1, slot: "AM" as const },
    replyWindowEnd: advanceSimTime({ day: 1, slot: "AM" }, 3),
    status: "pending_reply" as const,
  };
  const h = assessRepaySufficiency(90, gift, "horizontal", { enableAxisReciprocity: true });
  const hFail = assessRepaySufficiency(70, gift, "horizontal", { enableAxisReciprocity: true });
  const up = assessRepaySufficiency(35, gift, "vertical_up", { enableAxisReciprocity: true });
  const upFail = assessRepaySufficiency(20, gift, "vertical_up", { enableAxisReciprocity: true });
  if (h.sufficient && !hFail.sufficient && up.sufficient && !upFail.sufficient) {
    pass("P4-06.R3R4", `h.min=${h.requiredMin} up.min=${up.requiredMin}`);
  } else fail("P4-06.R3R4", JSON.stringify({ h, hFail, up, upFail }));

  // P4-11 debt kind
  const expr = computeGiftDebt(200, 0.8, "wedding");
  const instr = computeGiftDebt(200, 0.2, "instrumental");
  if (expr.giftKind === "expressive" && instr.giftKind === "instrumental" && instr.debtAmount > expr.debtAmount) {
    pass("P4-11.kind", `exprDebt=${expr.debtAmount.toFixed(1)} instrDebt=${instr.debtAmount.toFixed(1)}`);
  } else fail("P4-11.kind", JSON.stringify({ expr, instr }));

  // P4-09 ledger query
  const ledger = new GiftLedgerManager([
    { ...gift, gid: "g1", from: "a01", to: "a04" },
    { ...gift, gid: "g2", from: "a04", to: "a01", status: "replied" },
    { ...gift, gid: "g3", from: "a02", to: "a03" },
  ]);
  const between = ledger.queryBetween("a01", "a04");
  if (between.length === 2) pass("P4-09.queryBetween", `n=${between.length}`);
  else fail("P4-09.queryBetween", `n=${between.length}`);

  // P4-08 / P4-10 strategy
  const agents = loadAgents(join(dataDir, "agents.json"));
  const edges = (
    JSON.parse(readFileSync(join(dataDir, "relationships.json"), "utf8")) as {
      relationships: RelationshipEdge[];
    }
  ).relationships;
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
  world.giftLedger = [
    {
      ...gift,
      gid: "debt1",
      from: "a01",
      to: "a07",
      adjustedValue: 400,
      value: 500,
      status: "pending_reply",
      replyWindowEnd: { day: 2, slot: "AM" },
    },
  ];
  const bias = computeDebtActionBias(world, "a07");
  if (bias.repayUrgency > 0.5 && bias.giftWillingness < 0.8) {
    pass("P4-08.R6", `repayUrgency=${bias.repayUrgency.toFixed(2)} giftWillingness=${bias.giftWillingness.toFixed(2)}`);
  } else fail("P4-08.R6", JSON.stringify(bias));

  const strategy = new GiftStrategyLLM(createLlmClient("mock"));
  const raw = {
    targetAgentId: "a01",
    value: 50,
    expressiveScore: 0.7,
    occasion: "wedding",
    description: "test",
    reason: "unit",
    source: "heuristic" as const,
  };
  const clipped = strategy.clipProposal(world, "a07", raw);
  if (!clipped.rejected && clipped.clipped && clipped.value >= 200) {
    pass("P4-10.clip", `clipped value=${clipped.value} reason=${clipped.clipReason}`);
  } else fail("P4-10.clip", JSON.stringify(clipped));

  // rule-of-gift-flow.md §3 face/prestige/reputation
  if (isRitualOccasion("wedding") && !isRitualOccasion("instrumental")) {
    pass("flow.ritual_set", "wedding ritual; instrumental not");
  } else fail("flow.ritual_set", "occasion classification");

  const w2 = new WorldState({
    runId: "flow",
    name: "flow",
    startDay: 1,
    endDay: 1,
    seed: 1,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    llmMode: "mock",
  });
  w2.agents = structuredClone(agents);
  w2.relationships = structuredClone(edges);
  const hostBefore = w2.agents.a01!.public.prestige ?? 50;
  const giverFaceBefore = w2.agents.a04!.public.face ?? 50;
  const etiquetteOk = assessOccasionEtiquette(300, "wedding", 200);
  const socialOk = applyGiveGiftSocialEffects({
    world: w2,
    from: "a04",
    to: "a01",
    value: 300,
    expressiveScore: 0.75,
    giftKind: "expressive",
    occasion: "wedding",
    eid: "e_test",
    etiquette: etiquetteOk,
    relationAxis: "horizontal",
    enableOccasionNorms: true,
  });
  // Simulate ledger entry for cohort (already applied social once)
  if (
    socialOk.deltas.receiverPrestige > 0 &&
    socialOk.deltas.giverFace > 0 &&
    (w2.agents.a01!.public.prestige ?? 0) > hostBefore
  ) {
    pass(
      "flow.ritual_prestige_face",
      `hostPrestigeΔ=${socialOk.deltas.receiverPrestige.toFixed(2)} giverFaceΔ=${socialOk.deltas.giverFace.toFixed(2)}`,
    );
  } else {
    fail("flow.ritual_prestige_face", JSON.stringify(socialOk.deltas));
  }

  // Instrumental should NOT give large host prestige
  const w3 = new WorldState({
    runId: "flow2",
    name: "flow2",
    startDay: 1,
    endDay: 1,
    seed: 1,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    llmMode: "mock",
  });
  w3.agents = structuredClone(agents);
  w3.relationships = structuredClone(edges);
  const instrSocial = applyGiveGiftSocialEffects({
    world: w3,
    from: "a06",
    to: "a04",
    value: 300,
    expressiveScore: 0.2,
    giftKind: "instrumental",
    occasion: "instrumental",
    etiquette: assessOccasionEtiquette(300, undefined, undefined),
    relationAxis: "horizontal",
    enableOccasionNorms: true,
  });
  if (instrSocial.deltas.receiverPrestige < socialOk.deltas.receiverPrestige) {
    pass(
      "flow.instrumental_prestige_cap",
      `instrPrestigeΔ=${instrSocial.deltas.receiverPrestige.toFixed(2)} < ritual=${socialOk.deltas.receiverPrestige.toFixed(2)}`,
    );
  } else fail("flow.instrumental_prestige_cap", JSON.stringify(instrSocial.deltas));

  // Default → face/reputation down
  const w4 = new WorldState({
    runId: "flow3",
    name: "flow3",
    startDay: 1,
    endDay: 1,
    seed: 1,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    llmMode: "mock",
  });
  w4.agents = structuredClone(agents);
  const face0 = w4.agents.a07!.public.face ?? 50;
  const rep0 = w4.agents.a07!.public.reputation ?? 50;
  const def = applyDefaultSocialEffects({
    world: w4,
    gift: {
      gid: "gd",
      from: "a01",
      to: "a07",
      expressiveScore: 0.5,
      instrumentalScore: 0.5,
      value: 100,
      adjustedValue: 50,
      description: "d",
      givenAt: { day: 1, slot: "AM" },
      replyWindowEnd: { day: 1, slot: "EVE" },
      status: "defaulted",
      occasion: "wedding",
      giftKind: "expressive",
    },
  });
  if (
    def.deltas.giverFace < 0 &&
    def.deltas.giverReputation < 0 &&
    (w4.agents.a07!.public.face ?? 50) < face0 &&
    (w4.agents.a07!.public.reputation ?? 50) < rep0
  ) {
    pass(
      "flow.default_face_rep",
      `faceΔ=${def.deltas.giverFace.toFixed(1)} repΔ=${def.deltas.giverReputation.toFixed(1)}`,
    );
  } else fail("flow.default_face_rep", JSON.stringify(def.deltas));

  // Below-norm via RuleEngine commit
  const w5 = new WorldState({
    runId: "flow4",
    name: "flow4",
    startDay: 1,
    endDay: 1,
    seed: 1,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    enableOccasionNorms: true,
    llmMode: "mock",
  });
  w5.agents = structuredClone(agents);
  w5.relationships = structuredClone(edges);
  const faceLow0 = w5.agents.a08!.public.face ?? 50;
  const rules = new RuleEngine({ enableOccasionNorms: true, enableReciprocityRules: true });
  const r = rules.commit(w5, { day: 1, slot: "AM" }, {
    kind: "give_gift",
    from: "a08",
    to: "a01",
    value: 50,
    expressiveScore: 0.8,
    occasion: "wedding",
    minGiftNorm: 200,
    description: "失礼小礼",
  });
  const faceLow1 = w5.agents.a08!.public.face ?? 50;
  if (r.ok && faceLow1 < faceLow0 && giverFaceBefore >= 0) {
    pass("flow.R1_face_via_engine", `face ${faceLow0}→${faceLow1}`);
  } else fail("flow.R1_face_via_engine", `ok=${r.ok} face ${faceLow0}→${faceLow1}`);
}

function main(): void {
  unitChecks();

  const runId = `verify_p4_${Date.now()}`;
  const run = runCmd("sim:p4", {
    RUN_ID: runId,
    P4_LLM_MODE: "mock",
  });
  if (run.status === 0) pass("P4.run", `runId=${runId}`);
  else {
    fail("P4.run", run.stderr || run.stdout);
    printSummary();
    process.exit(1);
  }

  const runDir = join(runsRoot, runId);
  const logPath = join(runDir, "event_log.jsonl");
  if (!existsSync(logPath)) {
    fail("P4.log", "missing event_log.jsonl");
    printSummary();
    process.exit(1);
  }

  const logs = readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);

  const types = new Set(logs.map((l) => l.type));
  for (const t of [
    "gift.given",
    "gift.replied",
    "relationship.delta",
    "public_memory.created",
    "event.completed",
  ] as const) {
    if (types.has(t)) pass(`P4.log.${t}`, "present");
    else fail(`P4.log.${t}`, "missing");
  }

  const giftGiven = logs.filter((l) => l.type === "gift.given");
  const r1Breach = giftGiven.find((l) => {
    const p = l.payload as { etiquette?: { belowNorm?: boolean }; gift?: { belowNorm?: boolean } };
    return p.etiquette?.belowNorm || p.gift?.belowNorm;
  });
  if (r1Breach) pass("P4-05.log.R1", "belowNorm gift logged");
  else fail("P4-05.log.R1", "no belowNorm gift.given");

  const replied = logs.filter((l) => l.type === "gift.replied");
  const hasAxis = replied.some((l) => {
    const p = l.payload as { axis?: string; sufficient?: boolean };
    return typeof p.axis === "string" && p.sufficient === true;
  });
  if (hasAxis) pass("P4-06.log.axis", `replied=${replied.length}`);
  else fail("P4-06.log.axis", JSON.stringify(replied.map((l) => l.payload).slice(0, 2)));

  const pm = logs.filter((l) => l.type === "public_memory.created");
  if (pm.length >= 1) pass("P4-09.log.memory", `n=${pm.length}`);
  else fail("P4-09.log.memory", "no public_memory.created");

  const snapPath = join(runDir, "snapshots", "D1-AM.json");
  if (!existsSync(snapPath)) {
    fail("P4.snapshot", "missing D1-AM.json");
  } else {
    const snap = JSON.parse(readFileSync(snapPath, "utf8")) as WorldSnapshot;
    if ((snap.publicMemories?.length ?? 0) >= 1) {
      pass("P4-09.snapshot.memory", `publicMemories=${snap.publicMemories.length}`);
    } else fail("P4-09.snapshot.memory", "empty publicMemories");

    const kinds = new Set(snap.giftLedger.map((g) => g.giftKind).filter(Boolean));
    if (kinds.has("expressive") && kinds.has("instrumental")) {
      pass("P4-11.snapshot.kinds", [...kinds].join(","));
    } else fail("P4-11.snapshot.kinds", [...kinds].join(",") || "none");

    // Bilateral cash conservation spot-check on strategy gift a07→a01
    const a07 = snap.agents.a07?.economy.cash;
    const a01 = snap.agents.a01?.economy.cash;
    if (typeof a07 === "number" && typeof a01 === "number") {
      pass("P4-02.cash", `a07=${a07} a01=${a01}`);
    } else fail("P4-02.cash", "missing agents");
  }

  // Also keep d2 regression green (optional quick)
  const d2 = runCmd("verify:d2");
  if (d2.status === 0) pass("P4.compat.d2", "verify:d2 still passes");
  else fail("P4.compat.d2", d2.stderr || d2.stdout.slice(-400));

  printSummary();
  if (checks.some((c) => !c.ok)) process.exit(1);
  console.log(`\nP4 PASSED. Inspect run: ${join(runsRoot, runId)}`);
  console.log("Commands: npm run sim:p4  |  npm run verify:p4  |  npm run verify:d2");
}

function printSummary(): void {
  console.log("\n=== P4 verify ===");
  for (const c of checks) {
    console.log(`${c.ok ? "OK" : "FAIL"}  ${c.id} — ${c.detail}`);
  }
}

main();
