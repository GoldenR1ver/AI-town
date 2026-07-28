/**
 * Verify repay loop + reply policy (window / donation / wedding / agent_driven repay).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveReplyPolicy } from "../systems/gift/norms.js";
import { loadAgents } from "../systems/person/loader.js";
import { Experiment } from "./experiment.js";
import { computeMetrics } from "./metrics.js";
import type { ExperimentConfig, RelationshipEdge, SimTime } from "../../shared/types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

function loadEdges(path: string): RelationshipEdge[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] })
    .relationships;
}

async function runMiniRepay(): Promise<void> {
  const runId = `verify_repay_mini_${Date.now()}`;
  const runDir = join(dataDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const config: ExperimentConfig = {
    runId,
    name: "verify-repay-mini",
    startDay: 1,
    endDay: 12,
    seed: 7,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    enableRandomSocialEvents: false,
    enableAgentDrivenRepay: true,
    enableDialogue: false,
    llmMode: "mock",
  };
  writeFileSync(join(runDir, "config.json"), JSON.stringify(config, null, 2), "utf8");
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

  // Horizontal everyday gifts with reciprocal windows
  for (const day of [1, 2, 3]) {
    exp.queueManual({
      templateId: "private.neighbor_gift",
      onlyAt: { day, slot: "PM" },
      sourceAgentId: "a04",
      roleOverrides: { initiator: ["a04"], receiver: ["a06"] },
      payload: { occasion: "daily", replyWindowSlots: 12 },
    });
    exp.queueManual({
      templateId: "private.instrumental_gift",
      onlyAt: { day, slot: "EVE" },
      sourceAgentId: "a06",
    });
  }
  // Wedding should NOT create repay windows
  exp.queueManual({
    templateId: "private.wedding",
    onlyAt: { day: 1, slot: "AM" },
    roleOverrides: { host: ["a01"], kin: ["a02"], guests: ["a04", "a10"] },
    payload: { occasion: "wedding", minGiftNorm: 200 },
  });

  const start: SimTime = { day: 1, slot: "AM" };
  await exp.scheduler.run(start, 12);
  const metrics = computeMetrics({ world: exp.world, runId });
  const ledger = exp.world.giftLedger;
  const wedding = ledger.filter((g) => g.occasion === "wedding");
  const daily = ledger.filter((g) => g.occasion === "daily" || g.occasion === "instrumental");
  const weddingOpen = wedding.filter((g) => g.replyRequired !== false && g.status === "pending_reply");
  const replied = ledger.filter((g) => g.status === "replied").length;
  const defaulted = ledger.filter((g) => g.status === "defaulted").length;
  const closed = ledger.filter((g) => g.status === "closed").length;

  ok("mini.wedding.no_window", weddingOpen.length === 0, `wedding=${wedding.length} openWin=${weddingOpen.length}`);
  ok("mini.wedding.closed_or_noreply", wedding.every((g) => g.replyRequired === false || g.status === "closed"), `n=${wedding.length}`);
  ok("mini.has_reciprocal", daily.length >= 1, `reciprocalish=${daily.length}`);
  ok("mini.replied>0", replied >= 1, `replied=${replied} defaulted=${defaulted} closed=${closed}`);
  ok(
    "mini.default_rate_moderate",
    // Yan mid-state: most repay, some may still be pending within 12 days; allow 0–40% default among closed
    replied + defaulted === 0 || defaulted / (replied + defaulted) <= 0.4,
    `rate=${replied + defaulted ? (defaulted / (replied + defaulted)).toFixed(2) : "n/a"} metrics.default=${metrics.default_rate.toFixed(2)}`,
  );

  try {
    rmSync(runDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function main(): Promise<void> {
  console.log("verify:repay");

  const wWedding = resolveReplyPolicy({
    occasion: "wedding",
    giftKind: "expressive",
    relationAxis: "horizontal",
    expressiveScore: 0.7,
  });
  ok("policy.wedding.closed", wWedding.replyRequired === false && wWedding.initialStatus === "closed");

  const wDon = resolveReplyPolicy({
    occasion: "donation",
    giftKind: "instrumental",
    relationAxis: "horizontal",
    expressiveScore: 0.2,
  });
  ok("policy.donation.closed", wDon.replyRequired === false && !wDon.recordDebt);

  const wVert = resolveReplyPolicy({
    occasion: "daily",
    giftKind: "expressive",
    relationAxis: "vertical_up",
    expressiveScore: 0.5,
  });
  ok("policy.vertical.closed", wVert.replyRequired === false);

  const wDaily = resolveReplyPolicy({
    occasion: "daily",
    giftKind: "expressive",
    relationAxis: "horizontal",
    explicitWindowSlots: 30,
    expressiveScore: 0.55,
  });
  ok("policy.daily.window", wDaily.replyRequired === true && wDaily.windowSlots >= 21, `win=${wDaily.windowSlots}`);

  const wLeader = resolveReplyPolicy({
    occasion: "daily",
    giftKind: "expressive",
    relationAxis: "horizontal",
    explicitWindowSlots: 30,
    expressiveScore: 0.55,
    windowContext: {
      intimacy: 35,
      socialBasis: "neighbor",
      debtorPrestige: 70,
      debtorFace: 70,
      debtorSocialTags: ["authority", "community_leader"],
      debtorOccupation: "村委会主任",
      debtorOpenDebtCount: 5,
      creditorPrestige: 40,
    },
  });
  // Weak-tie → high-status looks like tribute (no one-to-one window)
  ok(
    "policy.leader.quasi_vertical_or_long",
    wLeader.replyRequired === false || wLeader.windowSlots >= 45,
    `req=${wLeader.replyRequired} win=${wLeader.windowSlots} ${wLeader.formula}`,
  );

  const wKinLeader = resolveReplyPolicy({
    occasion: "daily",
    giftKind: "expressive",
    relationAxis: "horizontal",
    explicitWindowSlots: 30,
    expressiveScore: 0.55,
    windowContext: {
      intimacy: 70,
      socialBasis: "kin",
      debtorPrestige: 70,
      debtorSocialTags: ["authority"],
      debtorOccupation: "村委会主任",
      debtorOpenDebtCount: 4,
      creditorPrestige: 45,
    },
  });
  ok(
    "policy.leader.kin_still_reciprocal_long",
    wKinLeader.replyRequired === true && wKinLeader.windowSlots > 30,
    `win=${wKinLeader.windowSlots} ${wKinLeader.formula}`,
  );

  await runMiniRepay();

  // Scale smoke: 16 agents, 20 days, dialogue off (explicit AGENTS to avoid leftover env)
  const runId = `verify_repay_scale_${Date.now()}`;
  const r = spawnSync("npx", ["tsx", "sim/backend/engine/run_experiment.ts"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      RUN_ID: runId,
      DAYS: "20",
      AGENTS: "16",
      ENABLE_DIALOGUE: "0",
      DEMO_STORY: "0",
      VARIANT: "A0_full",
      SEED: "42",
      ENABLE_SCHEDULED: "1",
      ENABLE_RANDOM_SOCIAL: "1",
    },
    encoding: "utf8",
    shell: true,
  });
  ok("scale.exit0", r.status === 0, (r.stderr || "").slice(0, 200));
  if (r.status === 0) {
    const metrics = JSON.parse(
      readFileSync(join(dataDir, "runs", runId, "metrics.json"), "utf8"),
    ) as {
      gift_count_total: number;
      gift_replied: number;
      gift_defaulted: number;
      gift_pending: number;
      reciprocity_rate: number;
      default_rate: number;
      avg_repay_delay: number;
      agent_count: number;
    };
    const closed = metrics.gift_replied + metrics.gift_defaulted;
    const defAmongClosed = closed === 0 ? 0 : metrics.gift_defaulted / closed;
    ok("scale.agents16", metrics.agent_count === 16, `n=${metrics.agent_count}`);
    ok("scale.replied>0", metrics.gift_replied >= 1, `replied=${metrics.gift_replied}`);
    ok(
      "scale.reciprocity_yan_mid",
      // Most repay, some default allowed (Yan mid-state)
      metrics.reciprocity_rate >= 0.55 || (closed > 0 && defAmongClosed <= 0.4),
      `reciprocity=${metrics.reciprocity_rate.toFixed(2)} defAmongClosed=${defAmongClosed.toFixed(2)} pending=${metrics.gift_pending} delay=${metrics.avg_repay_delay?.toFixed?.(1) ?? metrics.avg_repay_delay}`,
    );
    ok(
      "scale.default_among_closed<=0.4",
      closed === 0 || defAmongClosed <= 0.4,
      `defaulted=${metrics.gift_defaulted}/${closed}`,
    );
    ok(
      "scale.has_delay",
      metrics.gift_replied === 0 || (metrics.avg_repay_delay ?? 0) >= 3,
      `avg_repay_delay=${metrics.avg_repay_delay}`,
    );

    // 100-agent smoke (short): reciprocal gifts + repay must still work
    const run100 = `verify_repay_100_${Date.now()}`;
    const r100 = spawnSync("npx", ["tsx", "sim/backend/engine/run_experiment.ts"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        RUN_ID: run100,
        DAYS: "12",
        AGENTS: "100",
        ENABLE_DIALOGUE: "0",
        DEMO_STORY: "0",
        VARIANT: "A0_full",
        SEED: "42",
        ENABLE_SCHEDULED: "1",
        ENABLE_RANDOM_SOCIAL: "0",
      },
      encoding: "utf8",
      shell: true,
    });
    ok("scale100.exit0", r100.status === 0, (r100.stderr || "").slice(0, 200));
    if (r100.status === 0) {
      const m100 = JSON.parse(
        readFileSync(join(dataDir, "runs", run100, "metrics.json"), "utf8"),
      ) as {
        gift_replied: number;
        gift_defaulted: number;
        gift_pending: number;
        gift_count_total: number;
        reciprocity_rate: number;
        agent_count: number;
      };
      const closed100 = m100.gift_replied + m100.gift_defaulted;
      const def100 = closed100 === 0 ? 0 : m100.gift_defaulted / closed100;
      ok("scale100.agents", m100.agent_count === 100);
      ok(
        "scale100.has_reciprocal_flow",
        m100.gift_replied + m100.gift_pending + m100.gift_defaulted >= 1 ||
          m100.gift_count_total >= 1,
        `gifts=${m100.gift_count_total} replied=${m100.gift_replied} pending=${m100.gift_pending}`,
      );
      ok(
        "scale100.default_among_closed<0.5",
        closed100 === 0 || def100 < 0.5,
        `def=${m100.gift_defaulted}/${closed100} reciprocity=${m100.reciprocity_rate.toFixed(2)}`,
      );
      try {
        rmSync(join(dataDir, "runs", run100), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }

    console.log(
      r.stdout
        .split("\n")
        .filter((l) => l.includes("metrics") || l.includes("concentration") || l.includes("P5"))
        .join("\n"),
    );
    try {
      rmSync(join(dataDir, "runs", runId), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  } else {
    console.error(r.stdout?.slice(-2000));
    console.error(r.stderr?.slice(-2000));
  }

  if (failed) {
    console.error(`\nverify:repay FAILED (${failed})`);
    process.exit(1);
  }
  console.log("\nverify:repay OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
