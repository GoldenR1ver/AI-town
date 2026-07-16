/**
 * Phase 5 integrated batch runner (P5-02 / P5-03 / P5-05).
 *
 * Usage:
 *   npm run sim:run
 *   DAYS=30 VARIANT=baseline npm run sim:run
 *   DAYS=60 VARIANT=E1_memory_off SEED=7 npm run sim:run
 *   P5_LLM_MODE=live npm run sim:run
 *
 * Env:
 *   DAYS          — 30 or 60 (default 30); maps to endDay
 *   END_DAY       — override end day directly
 *   END_SLOTS     — override exact slot count (takes precedence over DAYS for clock length)
 *   VARIANT       — baseline | E1_memory_on | E1_memory_off | E2_* | E3_* | E4_*
 *   SEED          — RNG seed (default 42)
 *   RUN_ID        — optional fixed run id
 *   P5_LLM_MODE   — mock | live | auto (default mock)
 *   ENABLE_DIALOGUE — 0 to skip dialogue in main clock (faster)
 *   DEMO_STORY    — 1 to write demo_report.json acts for frontend (default 1 for DAYS<=10)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RelationshipEdge, SimTime } from "../../shared/types/index.js";
import { createLlmClient, describeLlmClient } from "../llm/client.js";
import { loadAgents } from "../systems/person/loader.js";
import { Experiment } from "./experiment.js";
import {
  applyVariantEdges,
  buildConfig,
  resolveVariant,
  VARIANT_SPECS,
} from "./experiment_presets.js";
import { computeMetrics, writeMetricsJson } from "./metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

function loadEdges(path: string): RelationshipEdge[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] })
    .relationships;
}

function queueDemoManuals(exp: Experiment): void {
  // D1-AM wedding ritual (hosts + kin + guests) — forces dialogue in main clock
  exp.queueManual({
    templateId: "private.wedding",
    onlyAt: { day: 1, slot: "AM" },
    roleOverrides: {
      host: ["a01"],
      kin: ["a02", "a03", "a14"],
      guests: ["a04", "a10", "a11"],
    },
    payload: { occasion: "wedding", minGiftNorm: 200, replyWindowSlots: 9 },
    sourceAgentId: "a01",
  });

  // D1-PM instrumental gift
  exp.queueManual({
    templateId: "private.instrumental_gift",
    sourceAgentId: "a06",
    onlyAt: { day: 1, slot: "PM" },
  });

  // D2-PM repay where debt exists
  exp.queueManual({
    templateId: "private.repay_gift",
    onlyAt: { day: 2, slot: "PM" },
    roleOverrides: { debtor: ["a04"], creditor: ["a06"] },
  });

  // D3-AM public conflict mediation (host mode dialogue)
  exp.queueManual({
    templateId: "public.conflict_mediation",
    onlyAt: { day: 3, slot: "AM" },
    sourceAgentId: "a01",
  });
}

function writeDemoStory(runDir: string, runId: string, endDay: number): void {
  const story = {
    title: "礼物的流动 · P5 集成实验",
    runId,
    endDay,
    acts: [
      {
        act: 1,
        time: { day: 1, slot: "AM" },
        title: "赵家婚礼随礼",
        tip: "强制对话 → 送礼 → 关系/声望变化",
      },
      {
        act: 2,
        time: { day: 1, slot: "PM" },
        title: "工具性送礼",
        tip: "a06 发起 instrumental gift",
      },
      {
        act: 3,
        time: { day: 2, slot: "PM" },
        title: "回礼窗口",
        tip: "repay_gift 或后续 defaulted",
      },
      {
        act: 4,
        time: { day: 3, slot: "AM" },
        title: "公共调解",
        tip: "主持人模式对话 + PET 广播",
      },
      {
        act: 5,
        time: { day: Math.min(endDay, 4), slot: "EVE" },
        title: "礼窗结算",
        tip: "在时间轴上寻找 gift.defaulted",
      },
    ],
  };
  writeFileSync(join(runDir, "demo_report.json"), JSON.stringify(story, null, 2), "utf8");
}

async function main(): Promise<void> {
  const days = Number(process.env.DAYS ?? process.env.END_DAY ?? 30);
  const endDay = Number(process.env.END_DAY ?? days);
  const variant = resolveVariant(process.env.VARIANT);
  const spec = VARIANT_SPECS[variant];
  const seed = Number(process.env.SEED ?? 42);
  const llmPref =
    (process.env.P5_LLM_MODE as "mock" | "live" | "auto" | undefined) ?? "mock";
  const llm = createLlmClient(llmPref);
  const enableDialogue = process.env.ENABLE_DIALOGUE !== "0";
  const runId =
    process.env.RUN_ID ?? `p5_${variant}_${endDay}d_${Date.now()}`;

  const config = buildConfig({
    runId,
    endDay,
    seed,
    llmMode: llm.mode,
    variant,
    enableScheduledEvents: process.env.ENABLE_SCHEDULED !== "0",
    enableDialogue,
    dialogueMaxTurns: Number(process.env.DIALOGUE_TURNS ?? 4),
  });

  const runDir = join(dataDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "config.json"),
    JSON.stringify(
      { ...config, llm: describeLlmClient(llm), variantLabel: spec.label },
      null,
      2,
    ),
    "utf8",
  );

  const exp = new Experiment(
    config,
    {
      runDir,
      templatesDir: join(dataDir, "event_templates"),
      knowledgePath: join(dataDir, "knowledge", "gift_norms.json"),
    },
    { llm },
  );

  exp.world.agents = loadAgents(join(dataDir, "agents.json"));
  exp.world.relationships = applyVariantEdges(
    loadEdges(join(dataDir, "relationships.json")),
    variant,
  );
  for (const id of Object.keys(exp.world.agents)) {
    exp.world.personalEventTables[id] = [];
    exp.world.cognitiveTrees[id] = [];
  }

  queueDemoManuals(exp);

  const wantStory =
    process.env.DEMO_STORY === "1" ||
    (process.env.DEMO_STORY !== "0" && endDay <= 12);
  if (wantStory) writeDemoStory(runDir, runId, endDay);

  exp.log.append({ day: 1, slot: "AM" }, "experiment.start", {
    config,
    llm: describeLlmClient(llm),
    phase: 5,
    variant,
  });

  const start: SimTime = { day: 1, slot: "AM" };
  let last: SimTime;
  if (process.env.END_SLOTS) {
    last = await exp.scheduler.runSlots(start, Number(process.env.END_SLOTS));
  } else {
    await exp.scheduler.run(start, endDay);
    last = { day: endDay, slot: "EVE" };
  }

  const metrics = computeMetrics({
    world: exp.world,
    runId,
    variant,
    label: spec.label,
    endDay,
    seed,
  });
  writeMetricsJson(runDir, metrics);

  exp.log.append(last, "experiment.end", {
    metrics: exp.world.metrics,
    experimentMetrics: metrics,
    gifts: exp.world.giftLedger.length,
    conversations: exp.world.conversations.length,
  });

  writeFileSync(join(dataDir, "runs", "LATEST_P5_RUN.txt"), runId, "utf8");
  writeFileSync(join(dataDir, "runs", "LATEST_GOLD_RUN.txt"), runId, "utf8");

  console.log(`P5 run finished: ${runDir}`);
  console.log(`  variant=${variant} (${spec.label})`);
  console.log(`  agents=${Object.keys(exp.world.agents).length} endDay=${endDay}`);
  console.log(`  dialogues=${exp.world.metrics.dialoguesCompleted} gifts=${exp.world.giftLedger.length}`);
  console.log(`  metrics.reciprocity_rate=${metrics.reciprocity_rate.toFixed(3)}`);
  console.log(`  metrics.default_rate=${metrics.default_rate.toFixed(3)}`);
  console.log(`  RUN_ID=${runId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
