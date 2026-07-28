/**
 * Verify scale data + random social drive + ablation config wiring.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { EventTemplateLibrary } from "../systems/event/index.js";
import { loadAgents } from "../systems/person/loader.js";
import { VARIANT_SPECS, ABLATION_VARIANTS, buildConfig } from "./experiment_presets.js";
import { applyAblationToWorld } from "./ablation.js";
import { WorldState } from "../store/world_state.js";

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

function ensureScaleData(): void {
  const agents100 = join(dataDir, "agents_100.json");
  if (existsSync(agents100)) return;
  console.log("Generating scale data…");
  const r = spawnSync("npx", ["tsx", "sim/backend/engine/generate_scale_data.ts"], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "generate failed");
}

function main(): void {
  console.log("verify:ablation / scale");
  ensureScaleData();

  const agents = loadAgents(join(dataDir, "agents_100.json"));
  ok("agents_100.count", Object.keys(agents).length === 100, `n=${Object.keys(agents).length}`);

  const rel = JSON.parse(readFileSync(join(dataDir, "relationships_100.json"), "utf8")) as {
    relationships: unknown[];
  };
  ok("relationships_100.nonempty", rel.relationships.length > 200, `edges=${rel.relationships.length}`);

  const lib = new EventTemplateLibrary();
  lib.loadFromDir(join(dataDir, "event_templates"));
  lib.loadCatalog(join(dataDir, "event_catalogs", "public_500.json"));
  lib.loadCatalog(join(dataDir, "event_catalogs", "random_500.json"));
  const publicN = lib.byCategory("public").length;
  const socialN = lib.randomSocialTemplates().length;
  ok("catalog.public>=500", publicN >= 500, `public=${publicN}`);
  ok("catalog.random>=500", socialN >= 500, `random=${socialN}`);

  for (const v of ABLATION_VARIANTS) {
    ok(`variant.${v}`, Boolean(VARIANT_SPECS[v]));
  }

  const cfg = buildConfig({
    runId: "verify_ablation",
    endDay: 2,
    seed: 1,
    variant: "A1_no_bdie",
    llmMode: "mock",
  });
  ok("A1.enableBdieDrive=false", cfg.enableBdieDrive === false);
  const world = new WorldState(cfg);
  world.agents = structuredClone(agents);
  applyAblationToWorld(world, cfg);
  const sample = Object.values(world.agents)[0]!;
  ok("A1.flatten.face", sample.public.face === 50);
  ok("A1.flatten.bigFive", sample.private.bigFive.E === 0.5);

  const cfg3 = buildConfig({
    runId: "verify_inf",
    endDay: 2,
    seed: 1,
    variant: "A3_infinite_economy",
    llmMode: "mock",
  });
  const w3 = new WorldState(cfg3);
  w3.agents = structuredClone(agents);
  applyAblationToWorld(w3, cfg3);
  ok("A3.infinite.cash", Object.values(w3.agents)[0]!.economy.cash >= 1e11);

  // Smoke: 3 slots, 100 agents, dialogue off
  const runId = `verify_ablation_smoke_${Date.now()}`;
  const r = spawnSync(
    "npx",
    ["tsx", "sim/backend/engine/run_experiment.ts"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        RUN_ID: runId,
        VARIANT: "A0_full",
        AGENTS: "100",
        END_SLOTS: "3",
        ENABLE_DIALOGUE: "0",
        DEMO_STORY: "0",
        SEED: "7",
      },
      encoding: "utf8",
      shell: true,
    },
  );
  ok("smoke.exit0", r.status === 0, (r.stderr || "").slice(0, 200));
  if (r.status === 0) {
    const metrics = JSON.parse(
      readFileSync(join(dataDir, "runs", runId, "metrics.json"), "utf8"),
    ) as { agent_count: number; events_completed: number };
    ok("smoke.agents100", metrics.agent_count === 100);
    ok("smoke.events", metrics.events_completed >= 0, `events=${metrics.events_completed}`);
    // cleanup smoke run dir to save disk
    try {
      rmSync(join(dataDir, "runs", runId), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  } else {
    console.error(r.stdout?.slice(-1500));
    console.error(r.stderr?.slice(-1500));
  }

  if (failed) {
    console.error(`\nverify:ablation FAILED (${failed})`);
    process.exit(1);
  }
  console.log("\nverify:ablation OK");
}

main();
