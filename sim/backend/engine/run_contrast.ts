/**
 * Phase 5 contrast experiment runner (P5-06 / D6-B1).
 *
 * Runs existing experiment variants with shared seeds, then aggregates each
 * run's metrics.json into one JSON file and one CSV table.
 *
 * Usage:
 *   npm run sim:contrast
 *   DAYS=60 SEEDS=42,43,44 npm run sim:contrast
 *   CONTRAST_VARIANTS=E1_memory_on,E1_memory_off npm run sim:contrast
 *
 * Env:
 *   DAYS              — experiment duration in days (default 30)
 *   END_DAY           — forwarded to sim:run; overrides DAYS there
 *   END_SLOTS         — forwarded to sim:run for short smoke runs
 *   SEEDS             — comma-separated integer seeds (default 42)
 *   CONTRAST_VARIANTS — comma-separated existing variant ids
 *   CONTRAST_ID       — optional aggregate run id
 *   P5_LLM_MODE       — mock | live | auto (default mock)
 *
 * Other sim:run options such as ENABLE_DIALOGUE and ENABLE_SCHEDULED are
 * inherited unchanged. Demo story output is disabled unless DEMO_STORY is set.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { ExperimentMetrics } from "./metrics.js";
import { VARIANT_SPECS } from "./experiment_presets.js";
import type { ExperimentVariant } from "../../shared/types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const runsDir = join(projectRoot, "sim/data/runs");

const DEFAULT_VARIANTS: ExperimentVariant[] = [
  "E1_memory_on",
  "E1_memory_off",
  "E2_reciprocity_on",
  "E2_reciprocity_off",
];

const METRIC_COLUMNS: Array<keyof ExperimentMetrics> = [
  "reciprocity_rate",
  "default_rate",
  "avg_repay_delay",
  "prestige_gini",
  "asymmetric_gift_ratio",
  "gift_count_total",
  "gift_replied",
  "gift_defaulted",
  "gift_pending",
  "trust_mean",
  "intimacy_mean",
  "relationship_density",
  "dialogues_completed",
  "events_completed",
  "agent_count",
];

interface ContrastRow extends ExperimentMetrics {
  runId: string;
  variant: ExperimentVariant;
  label: string;
  endDay: number;
  seed: number;
}

interface SavedPointer {
  path: string;
  existed: boolean;
  content: string;
}

function parsePositiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return value;
}

function parseSeeds(raw?: string): number[] {
  const values = (raw ?? "42")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const seed = Number(part);
      if (!Number.isInteger(seed)) throw new Error(`Invalid seed: ${part}`);
      return seed;
    });
  const seeds = [...new Set(values)];
  if (seeds.length === 0) throw new Error("SEEDS must contain at least one integer");
  return seeds;
}

function parseVariants(raw?: string): ExperimentVariant[] {
  if (!raw?.trim()) return DEFAULT_VARIANTS;
  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const variants: ExperimentVariant[] = [];
  for (const value of values) {
    if (!(value in VARIANT_SPECS)) {
      throw new Error(
        `Unknown contrast variant: ${value}. Available: ${Object.keys(VARIANT_SPECS).join(", ")}`,
      );
    }
    variants.push(value as ExperimentVariant);
  }
  const unique = [...new Set(variants)];
  if (unique.length === 0) {
    throw new Error("CONTRAST_VARIANTS must contain at least one variant");
  }
  return unique;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(path: string, rows: ContrastRow[]): void {
  const columns: Array<keyof ContrastRow> = [
    "runId",
    "variant",
    "label",
    "endDay",
    "seed",
    ...METRIC_COLUMNS,
  ];
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function savePointers(paths: string[]): SavedPointer[] {
  return paths.map((path) => ({
    path,
    existed: existsSync(path),
    content: existsSync(path) ? readFileSync(path, "utf8") : "",
  }));
}

function restorePointers(pointers: SavedPointer[]): void {
  for (const pointer of pointers) {
    if (pointer.existed) writeFileSync(pointer.path, pointer.content, "utf8");
    else rmSync(pointer.path, { force: true });
  }
}

function runVariant(args: {
  contrastId: string;
  variant: ExperimentVariant;
  seed: number;
  days: number;
}): ContrastRow {
  const runId = `${args.contrastId}_${args.variant}_seed${args.seed}`;
  const runDir = join(runsDir, runId);
  if (existsSync(runDir)) throw new Error(`Run directory already exists: ${runDir}`);

  console.log(`\n[contrast] variant=${args.variant} seed=${args.seed} run=${runId}`);
  const result = spawnSync("npm", ["run", "sim:run"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DAYS: String(args.days),
      VARIANT: args.variant,
      SEED: String(args.seed),
      RUN_ID: runId,
      P5_LLM_MODE: process.env.P5_LLM_MODE ?? "mock",
      DEMO_STORY: process.env.DEMO_STORY ?? "0",
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === "win32",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`sim:run failed for variant=${args.variant} seed=${args.seed}`);
  }

  const metricsPath = join(runDir, "metrics.json");
  if (!existsSync(metricsPath)) {
    throw new Error(`Missing metrics output: ${metricsPath}`);
  }
  const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as ExperimentMetrics;
  return {
    ...metrics,
    runId,
    variant: args.variant,
    label: VARIANT_SPECS[args.variant].label,
    endDay: metrics.endDay ?? args.days,
    seed: metrics.seed ?? args.seed,
  };
}

function main(): void {
  const days = parsePositiveInteger(process.env.END_DAY ?? process.env.DAYS ?? "30", "DAYS");
  const endSlots = process.env.END_SLOTS
    ? parsePositiveInteger(process.env.END_SLOTS, "END_SLOTS")
    : undefined;
  const seeds = parseSeeds(process.env.SEEDS);
  const variants = parseVariants(process.env.CONTRAST_VARIANTS);
  const contrastId = process.env.CONTRAST_ID?.trim() || `contrast_${Date.now()}`;
  const contrastDir = join(runsDir, contrastId);
  if (existsSync(contrastDir)) {
    throw new Error(`Contrast directory already exists: ${contrastDir}`);
  }
  mkdirSync(contrastDir, { recursive: false });

  // Child runs maintain these global pointers. Contrast aggregation should not
  // silently replace the user's current P5/gold selections.
  const pointers = savePointers([
    join(runsDir, "LATEST_P5_RUN.txt"),
    join(runsDir, "LATEST_GOLD_RUN.txt"),
  ]);

  const rows: ContrastRow[] = [];
  try {
    for (const seed of seeds) {
      for (const variant of variants) {
        rows.push(runVariant({ contrastId, variant, seed, days }));
      }
    }
  } finally {
    restorePointers(pointers);
  }

  const result = {
    contrastId,
    generatedAt: new Date().toISOString(),
    days,
    endSlots,
    variants,
    seeds,
    runs: rows,
  };
  const jsonPath = join(contrastDir, "contrast_results.json");
  const csvPath = join(contrastDir, "contrast_results.csv");
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8");
  writeCsv(csvPath, rows);
  writeFileSync(join(runsDir, "LATEST_CONTRAST.txt"), contrastId, "utf8");

  console.log(`\nContrast finished: ${contrastDir}`);
  console.log(`  runs=${rows.length} variants=${variants.length} seeds=${seeds.length}`);
  console.log(`  JSON=${jsonPath}`);
  console.log(`  CSV=${csvPath}`);
  console.log(`  CONTRAST_ID=${contrastId}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
