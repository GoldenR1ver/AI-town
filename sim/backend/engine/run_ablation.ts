/**
 * Ablation suite runner (A0–A3).
 *
 * Usage (params-first):
 *   npm run sim:ablation -- --params sim/data/experiment_params/ablation_cell.json
 *   npm run sim:ablation -- --preset ablation_cell
 *
 * Matrix overrides still accepted when explicitly set:
 *   SEEDS / ABLATION_VARIANTS / ABLATION_ID / END_DAY
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { ExperimentMetrics } from "./metrics.js";
import { ABLATION_VARIANTS, VARIANT_SPECS } from "./experiment_presets.js";
import type { ExperimentParamsFile, ExperimentVariant } from "../../shared/types/index.js";
import { resolveLaunch } from "./load_launch_config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const runsDir = join(projectRoot, "sim/data/runs");

const METRIC_COLUMNS: Array<keyof ExperimentMetrics> = [
  "avg_repay_delay",
  "reciprocity_rate",
  "default_rate",
  "prestige_gini",
  "gift_count_total",
  "gift_inflow_top10_prestige_share",
  "gift_inflow_top10_wealth_share",
  "gift_prestige_corr",
  "gift_wealth_corr",
  "trust_mean",
  "intimacy_mean",
  "relationship_density",
  "events_completed",
  "dialogues_completed",
  "agent_count",
];

interface AblationRow extends ExperimentMetrics {
  runId: string;
  variant: ExperimentVariant;
  label: string;
  endDay: number;
  seed: number;
}

function parseSeeds(raw?: string): number[] {
  const values = (raw ?? "42")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const s = Number(p);
      if (!Number.isInteger(s)) throw new Error(`Invalid seed: ${p}`);
      return s;
    });
  const seeds = [...new Set(values)];
  if (!seeds.length) throw new Error("SEEDS must contain at least one integer");
  return seeds;
}

function parseVariants(raw?: string): ExperimentVariant[] {
  if (!raw?.trim()) return [...ABLATION_VARIANTS];
  const out: ExperimentVariant[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim() as ExperimentVariant;
    if (!(value in VARIANT_SPECS)) {
      throw new Error(
        `Unknown ablation variant: ${value}. Available: ${ABLATION_VARIANTS.join(", ")}`,
      );
    }
    out.push(value);
  }
  return out;
}

function toCsv(rows: AblationRow[]): string {
  const headers = [
    "runId",
    "variant",
    "label",
    "endDay",
    "seed",
    ...METRIC_COLUMNS,
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const v = row[h as keyof AblationRow];
          return typeof v === "number" ? String(v) : JSON.stringify(String(v ?? ""));
        })
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function main(): void {
  const hasExplicitParams =
    process.argv.some((a) => a === "--params" || a === "--preset" || a.startsWith("--params=") || a.startsWith("--preset=")) ||
    Boolean(process.env.SIM_PARAMS || process.env.SIM_PRESET);
  const baseLaunch = resolveLaunch({
    argv: hasExplicitParams ? process.argv.slice(2) : ["--preset", "ablation_cell"],
  });
  const baseFile: ExperimentParamsFile = { ...baseLaunch.params };

  const days = Number(
    process.env.END_DAY ?? process.env.DAYS ?? baseFile.endDay ?? 14,
  );
  const seeds = parseSeeds(process.env.SEEDS ?? String(baseFile.seed ?? 42));
  const variants = parseVariants(process.env.ABLATION_VARIANTS);
  const ablationId = process.env.ABLATION_ID ?? `ablation_${Date.now()}`;
  const outDir = join(runsDir, ablationId);
  mkdirSync(outDir, { recursive: true });
  const cellsDir = join(outDir, "_cells");
  mkdirSync(cellsDir, { recursive: true });

  if ((baseFile.agentScale ?? 100) === 100) {
    const agents100 = join(projectRoot, "sim/data/agents_100.json");
    if (!existsSync(agents100)) {
      console.log("Generating scale data (agents_100 + catalogs)…");
      const gen = spawnSync("npx", ["tsx", "sim/backend/engine/generate_scale_data.ts"], {
        cwd: projectRoot,
        encoding: "utf8",
        shell: true,
      });
      if (gen.status !== 0) {
        console.error(gen.stderr || gen.stdout);
        process.exit(1);
      }
    }
  }

  const rows: AblationRow[] = [];
  for (const seed of seeds) {
    for (const variant of variants) {
      const runId = `${ablationId}_${variant}_s${seed}`;
      const cell: ExperimentParamsFile = {
        ...baseFile,
        presetId: "ablation_cell",
        runId,
        variant,
        seed,
        endDay: days,
        demoStory: false,
      };
      const cellPath = join(cellsDir, `${runId}.json`);
      writeFileSync(cellPath, JSON.stringify(cell, null, 2), "utf8");

      console.log(`\n=== ablation ${variant} seed=${seed} ===`);
      const r = spawnSync(
        "npx",
        ["tsx", "sim/backend/engine/run_experiment.ts", "--params", cellPath],
        {
          cwd: projectRoot,
          env: { ...process.env },
          encoding: "utf8",
          shell: true,
        },
      );
      if (r.status !== 0) {
        console.error(r.stderr || r.stdout);
        process.exit(r.status ?? 1);
      }
      console.log(r.stdout);
      const metricsPath = join(runsDir, runId, "metrics.json");
      const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as ExperimentMetrics;
      rows.push({
        ...metrics,
        runId,
        variant,
        label: VARIANT_SPECS[variant].label,
        endDay: days,
        seed,
      });
    }
  }

  writeFileSync(join(outDir, "ablation_results.json"), JSON.stringify(rows, null, 2), "utf8");
  writeFileSync(join(outDir, "ablation_results.csv"), toCsv(rows), "utf8");
  writeFileSync(join(runsDir, "LATEST_ABLATION.txt"), ablationId, "utf8");

  console.log(`\nAblation finished: ${outDir}`);
  console.log(`  variants=${variants.join(",")}`);
  console.log(`  seeds=${seeds.join(",")}`);
  for (const row of rows) {
    console.log(
      `  ${row.variant}: prestige_top10=${row.gift_inflow_top10_prestige_share.toFixed(3)} wealth_top10=${row.gift_inflow_top10_wealth_share.toFixed(3)} corr_p=${row.gift_prestige_corr.toFixed(3)}`,
    );
  }
}

main();
