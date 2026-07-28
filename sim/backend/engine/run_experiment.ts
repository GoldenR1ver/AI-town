/**
 * Phase 5 integrated batch runner (P5-02 / P5-03 / P5-05).
 *
 * Usage (params-first):
 *   npm run sim:run -- --preset baseline_16_30d
 *   npm run sim:run -- --preset test1
 *   npm run sim:run -- --params sim/data/experiment_params/live100_365d_baseline.json
 *
 * Optional one-shot overrides (only if explicitly set):
 *   RUN_ID / SEED / END_DAY / VARIANT / P5_LLM_MODE / …
 *
 * Presets live in: sim/data/experiment_params/*.json
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RelationshipEdge, SimTime } from "../../shared/types/index.js";
import { createLlmClient, describeLlmClient } from "../llm/client.js";
import { loadAgents } from "../systems/person/loader.js";
import { Experiment } from "./experiment.js";
import {
  applyVariantEdges,
  VARIANT_SPECS,
} from "./experiment_presets.js";
import { resolveLaunch, variantLabel } from "./load_launch_config.js";
import { computeMetrics, writeMetricsJson } from "./metrics.js";
import { applyAblationToWorld } from "./ablation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");

function loadEdges(path: string): RelationshipEdge[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] })
    .relationships;
}

function queueDemoManuals(exp: Experiment): void {
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

  exp.queueManual({
    templateId: "private.instrumental_gift",
    sourceAgentId: "a06",
    onlyAt: { day: 1, slot: "PM" },
  });

  exp.queueManual({
    templateId: "private.repay_gift",
    onlyAt: { day: 2, slot: "PM" },
    roleOverrides: { debtor: ["a04"], creditor: ["a06"] },
  });

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
  const launch = resolveLaunch({ argv: process.argv.slice(2) });
  const { config, runId, paths, params } = launch;
  const variant = params.variant!;
  const spec = VARIANT_SPECS[variant];
  const endDay = params.endDay;

  const llm = createLlmClient(params.llmPreference ?? config.llmPreference ?? "mock");
  // Align frozen llmMode with resolved client.
  config.llmMode = llm.mode;

  const runDir = join(paths.runsDir, runId);
  if (existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "config.json"),
    JSON.stringify(
      {
        ...config,
        llm: describeLlmClient(llm),
        variantLabel: spec.label,
        agentScale: config.agentScale ?? 16,
        paramsSource: launch.source,
        presetId: params.presetId,
      },
      null,
      2,
    ),
    "utf8",
  );

  const exp = new Experiment(
    config,
    {
      runDir,
      templatesDir: paths.templatesDir,
      knowledgePath: paths.knowledgePath,
    },
    { llm },
  );

  if (launch.loadPublicCatalog && existsSync(paths.publicCatalog)) {
    exp.library.loadCatalog(paths.publicCatalog);
  }
  if (launch.loadRandomCatalog && existsSync(paths.randomCatalog)) {
    exp.library.loadCatalog(paths.randomCatalog);
  }

  exp.world.agents = loadAgents(paths.agents);
  exp.world.relationships = applyVariantEdges(loadEdges(paths.relationships), variant);
  for (const id of Object.keys(exp.world.agents)) {
    exp.world.personalEventTables[id] = [];
    exp.world.cognitiveTrees[id] = [];
  }
  applyAblationToWorld(exp.world, config);

  if (launch.wantDemoManuals) queueDemoManuals(exp);
  if (launch.wantDemoStory) writeDemoStory(runDir, runId, endDay);

  exp.log.append({ day: 1, slot: "AM" }, "experiment.start", {
    config,
    llm: describeLlmClient(llm),
    phase: 5,
    variant,
    paramsSource: launch.source,
  });

  const start: SimTime = { day: config.startDay ?? 1, slot: "AM" };
  let last: SimTime;
  if (config.endSlots && config.endSlots > 0) {
    last = await exp.scheduler.runSlots(start, config.endSlots);
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
    seed: config.seed,
  });
  writeMetricsJson(runDir, metrics);

  exp.log.append(last, "experiment.end", {
    metrics: exp.world.metrics,
    experimentMetrics: metrics,
    gifts: exp.world.giftLedger.length,
    conversations: exp.world.conversations.length,
  });

  exp.snapshots.flushIndex();

  writeFileSync(join(paths.runsDir, "LATEST_P5_RUN.txt"), runId, "utf8");
  writeFileSync(join(paths.runsDir, "LATEST_GOLD_RUN.txt"), runId, "utf8");

  console.log(`P5 run finished: ${runDir}`);
  console.log(`  params=${launch.source}`);
  console.log(`  variant=${variant} (${variantLabel(variant)})`);
  console.log(
    `  agents=${Object.keys(exp.world.agents).length} scale=${config.agentScale} templates=${exp.library.size()} endDay=${endDay}`,
  );
  console.log(`  dialogues=${exp.world.metrics.dialoguesCompleted} gifts=${exp.world.giftLedger.length}`);
  console.log(`  metrics.reciprocity_rate=${metrics.reciprocity_rate.toFixed(3)}`);
  console.log(`  metrics.default_rate=${metrics.default_rate.toFixed(3)}`);
  console.log(
    `  concentration gift→prestige_top10=${metrics.gift_inflow_top10_prestige_share.toFixed(3)} corr=${metrics.gift_prestige_corr.toFixed(3)}`,
  );
  console.log(`  RUN_ID=${runId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
