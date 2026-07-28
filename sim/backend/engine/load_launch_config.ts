/**
 * Load experiment parameters from JSON presets (primary) with thin CLI/env overrides.
 *
 * Precedence (later wins):
 *   built-in defaults < params JSON < --params/--preset CLI < explicit env overrides
 *
 * Usage:
 *   npm run sim:run -- --params sim/data/experiment_params/test1.json
 *   npm run sim:run -- --preset test1
 *   SIM_PARAMS=sim/data/experiment_params/baseline_16_30d.json npm run sim:run
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExperimentConfig,
  ExperimentParamsFile,
  ExperimentVariant,
} from "../../shared/types/index.js";
import { buildConfig, resolveVariant, VARIANT_SPECS } from "./experiment_presets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
export const PARAMS_DIR = join(projectRoot, "sim/data/experiment_params");

export interface ResolvedLaunch {
  /** Params after merge (authoring view). */
  params: Required<
    Pick<
      ExperimentParamsFile,
      | "endDay"
      | "seed"
      | "variant"
      | "agentScale"
      | "llmPreference"
      | "enableDialogue"
      | "enableScheduledEvents"
      | "enableRandomSocialEvents"
      | "dialogueMaxTurns"
      | "demoStory"
    >
  > &
    ExperimentParamsFile;
  /** Frozen simulation config written to WorldState / config.json. */
  config: ExperimentConfig;
  /** Absolute run directory name (not full path). */
  runId: string;
  /** Absolute paths for data loading. */
  paths: {
    agents: string;
    relationships: string;
    publicCatalog: string;
    randomCatalog: string;
    templatesDir: string;
    knowledgePath: string;
    dataDir: string;
    runsDir: string;
  };
  wantDemoStory: boolean;
  wantDemoManuals: boolean;
  loadPublicCatalog: boolean;
  loadRandomCatalog: boolean;
  source: string;
}

function parseArgs(argv: string[]): { params?: string; preset?: string } {
  const out: { params?: string; preset?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--params" || a === "-p") out.params = argv[++i];
    else if (a.startsWith("--params=")) out.params = a.slice("--params=".length);
    else if (a === "--preset") out.preset = argv[++i];
    else if (a.startsWith("--preset=")) out.preset = a.slice("--preset=".length);
  }
  return out;
}

function resolveParamsPath(raw: string): string {
  if (isAbsolute(raw)) return raw;
  const fromCwd = resolve(process.cwd(), raw);
  if (existsSync(fromCwd)) return fromCwd;
  const fromRoot = join(projectRoot, raw);
  if (existsSync(fromRoot)) return fromRoot;
  const fromParams = join(PARAMS_DIR, raw.endsWith(".json") ? raw : `${raw}.json`);
  if (existsSync(fromParams)) return fromParams;
  throw new Error(`experiment params not found: ${raw}`);
}

function resolveDataPath(raw: string): string {
  if (isAbsolute(raw)) return raw;
  const fromCwd = resolve(process.cwd(), raw);
  if (existsSync(fromCwd)) return fromCwd;
  const fromRoot = join(projectRoot, raw);
  if (existsSync(fromRoot)) return fromRoot;
  throw new Error(`data path not found: ${raw}`);
}

export function listParamPresets(): string[] {
  if (!existsSync(PARAMS_DIR)) return [];
  return readdirSync(PARAMS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => basename(f, ".json"));
}

export function loadParamsFile(pathOrId: string): ExperimentParamsFile {
  const path = resolveParamsPath(pathOrId);
  return JSON.parse(readFileSync(path, "utf8")) as ExperimentParamsFile;
}

function envSet(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(process.env, name);
}

function envBool(name: string, fallback: boolean): boolean {
  if (!envSet(name)) return fallback;
  const v = process.env[name];
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return fallback;
}

function envNum(name: string, fallback: number): number {
  if (!envSet(name)) return fallback;
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function envStr<T extends string>(name: string, fallback: T): T {
  if (!envSet(name)) return fallback;
  return (process.env[name] as T) || fallback;
}

/**
 * Apply only explicitly-set env vars as overrides (CI / one-shot knobs).
 * Prefer JSON params for normal runs.
 */
export function applyEnvOverrides(base: ExperimentParamsFile): ExperimentParamsFile {
  const next: ExperimentParamsFile = { ...base };
  if (envSet("RUN_ID")) next.runId = process.env.RUN_ID;
  if (envSet("VARIANT")) next.variant = resolveVariant(process.env.VARIANT);
  if (envSet("SEED")) next.seed = envNum("SEED", next.seed ?? 42);
  if (envSet("END_DAY")) next.endDay = envNum("END_DAY", next.endDay ?? 30);
  else if (envSet("DAYS")) next.endDay = envNum("DAYS", next.endDay ?? 30);
  if (envSet("END_SLOTS")) next.endSlots = envNum("END_SLOTS", next.endSlots ?? 0) || undefined;
  if (envSet("P5_LLM_MODE") || envSet("LLM_MODE")) {
    next.llmPreference = envStr(
      "P5_LLM_MODE",
      envStr("LLM_MODE", next.llmPreference ?? "mock"),
    ) as ExperimentParamsFile["llmPreference"];
  }
  if (envSet("ENABLE_DIALOGUE")) next.enableDialogue = envBool("ENABLE_DIALOGUE", true);
  if (envSet("ENABLE_SCHEDULED")) next.enableScheduledEvents = envBool("ENABLE_SCHEDULED", true);
  if (envSet("ENABLE_RANDOM_SOCIAL")) {
    next.enableRandomSocialEvents = envBool("ENABLE_RANDOM_SOCIAL", true);
  }
  if (envSet("DIALOGUE_TURNS")) next.dialogueMaxTurns = envNum("DIALOGUE_TURNS", 4);
  if (envSet("MAX_RANDOM_SOCIAL")) next.maxRandomSocialPerSlot = envNum("MAX_RANDOM_SOCIAL", 8);
  if (envSet("MAX_DIALOGUE_PER_SLOT")) {
    next.maxDialoguePerSlot = envNum("MAX_DIALOGUE_PER_SLOT", 4);
  }
  if (envSet("SNAPSHOT_EVERY_SLOTS")) {
    next.snapshotEverySlots = envNum("SNAPSHOT_EVERY_SLOTS", 1);
  }
  if (envSet("SNAPSHOT_PRETTY")) next.snapshotPretty = envBool("SNAPSHOT_PRETTY", false);
  if (envSet("DEMO_STORY")) {
    next.demoStory = process.env.DEMO_STORY === "auto" ? "auto" : envBool("DEMO_STORY", false);
  }
  if (envSet("AGENTS") || envSet("SCALE")) {
    const scale =
      process.env.AGENTS === "100" || process.env.SCALE === "100" ? 100 : 16;
    next.agentScale = scale;
  }
  return next;
}

function defaultsForScale(scale: 16 | 100): Partial<ExperimentParamsFile> {
  if (scale === 100) {
    return {
      maxRandomSocialPerSlot: 12,
      snapshotEverySlots: 3,
      snapshotPretty: false,
      maxDialoguePerSlot: 4,
      loadPublicCatalog: true,
      loadRandomCatalog: true,
      queueDemoManuals: false,
      demoStory: false,
    };
  }
  return {
    maxRandomSocialPerSlot: 6,
    snapshotEverySlots: 1,
    snapshotPretty: true,
    maxDialoguePerSlot: 8,
    loadPublicCatalog: false,
    loadRandomCatalog: false,
    queueDemoManuals: true,
    demoStory: "auto",
  };
}

export function resolveLaunch(opts: {
  argv?: string[];
  env?: boolean;
  inline?: ExperimentParamsFile;
}): ResolvedLaunch {
  const argv = opts.argv ?? process.argv.slice(2);
  const cli = parseArgs(argv);

  let source = "defaults";
  let file: ExperimentParamsFile = {};

  const paramsRef =
    cli.params ??
    (opts.env !== false ? process.env.SIM_PARAMS : undefined) ??
    cli.preset ??
    (opts.env !== false ? process.env.SIM_PRESET : undefined) ??
    // Default preset when nothing specified (replaces env-soup defaults).
    "baseline_16_30d";

  if (paramsRef) {
    const path = resolveParamsPath(paramsRef);
    file = loadParamsFile(path);
    source = path;
  }
  if (opts.inline) {
    file = { ...file, ...opts.inline };
    source = opts.inline.presetId ? `inline:${opts.inline.presetId}` : `inline+${source}`;
  }

  let merged: ExperimentParamsFile = { ...file };
  if (opts.env !== false) merged = applyEnvOverrides(merged);

  const variant = resolveVariant(merged.variant);
  const agentScale: 16 | 100 = merged.agentScale === 100 ? 100 : 16;
  const scaleDefaults = defaultsForScale(agentScale);
  merged = { ...scaleDefaults, ...merged, variant, agentScale };

  const endDay = merged.endDay ?? 30;
  const seed = merged.seed ?? 42;
  const llmPreference = merged.llmPreference ?? merged.llmMode ?? "mock";
  const enableDialogue = merged.enableDialogue !== false;
  const enableScheduledEvents = merged.enableScheduledEvents !== false;
  const enableRandomSocialEvents = merged.enableRandomSocialEvents !== false;
  const dialogueMaxTurns = merged.dialogueMaxTurns ?? 4;
  const demoStory = merged.demoStory ?? scaleDefaults.demoStory ?? "auto";

  const runId =
    merged.runId ??
    `p5_${variant}_${merged.endSlots ? `${merged.endSlots}s` : `${endDay}d`}_${Date.now()}`;

  // Variant-derived toggles via buildConfig; optional file overrides for ablation knobs.
  const config = buildConfig({
    runId,
    name: merged.label ?? VARIANT_SPECS[variant].label,
    startDay: merged.startDay ?? 1,
    endDay,
    seed,
    llmMode: llmPreference === "live" ? "live" : "mock",
    variant,
    enableScheduledEvents,
    enableDialogue,
    dialogueMaxTurns,
    enableRandomSocialEvents,
    maxRandomSocialPerSlot: merged.maxRandomSocialPerSlot,
  });

  // Allow params file to override variant-derived flags explicitly.
  if (merged.enableGiftMemory != null) config.enableGiftMemory = merged.enableGiftMemory;
  if (merged.enableReciprocityRules != null) {
    config.enableReciprocityRules = merged.enableReciprocityRules;
    config.enableAxisReciprocity = merged.enableReciprocityRules;
  }
  if (merged.enableOccasionNorms != null) {
    config.enableOccasionNorms = merged.enableOccasionNorms;
  }
  if (merged.enableBdieDrive != null) config.enableBdieDrive = merged.enableBdieDrive;
  if (merged.enableCognitiveTree != null) {
    config.enableCognitiveTree = merged.enableCognitiveTree;
  }
  if (merged.infiniteEconomy != null) config.infiniteEconomy = merged.infiniteEconomy;
  if (merged.enableAgentDrivenRepay != null) {
    config.enableAgentDrivenRepay = merged.enableAgentDrivenRepay;
  }
  if (merged.enableVerticalRelations != null) {
    config.enableVerticalRelations = merged.enableVerticalRelations;
  }
  if (merged.maxRepayPerSlot != null) config.maxRepayPerSlot = merged.maxRepayPerSlot;
  if (merged.maxPublicScheduledPerSlot != null) {
    config.maxPublicScheduledPerSlot = merged.maxPublicScheduledPerSlot;
  }
  if (merged.maxPrivateScheduledPerSlot != null) {
    config.maxPrivateScheduledPerSlot = merged.maxPrivateScheduledPerSlot;
  }

  config.agentScale = agentScale;
  config.endSlots = merged.endSlots;
  config.snapshotEverySlots =
    merged.snapshotEverySlots ?? scaleDefaults.snapshotEverySlots ?? 1;
  config.snapshotPretty =
    merged.snapshotPretty ?? scaleDefaults.snapshotPretty ?? agentScale < 100;
  config.maxDialoguePerSlot =
    merged.maxDialoguePerSlot ??
    (llmPreference === "live" ? 4 : scaleDefaults.maxDialoguePerSlot ?? 8);
  config.demoStory = demoStory;
  config.llmPreference = llmPreference;
  config.loadPublicCatalog = merged.loadPublicCatalog ?? agentScale === 100;
  config.loadRandomCatalog = merged.loadRandomCatalog ?? agentScale === 100;
  config.queueDemoManuals = merged.queueDemoManuals ?? agentScale !== 100;
  config.agentsPath = merged.agentsPath;
  config.relationshipsPath = merged.relationshipsPath;

  const dataDir = join(projectRoot, "sim/data");
  const agentsDefault =
    agentScale === 100 && existsSync(join(dataDir, "agents_100.json"))
      ? join(dataDir, "agents_100.json")
      : join(dataDir, "agents.json");
  const relDefault =
    agentScale === 100 && existsSync(join(dataDir, "relationships_100.json"))
      ? join(dataDir, "relationships_100.json")
      : join(dataDir, "relationships.json");

  const wantDemoStory =
    demoStory === true || (demoStory === "auto" && endDay <= 12);

  return {
    params: {
      ...merged,
      endDay,
      seed,
      variant,
      agentScale,
      llmPreference,
      enableDialogue,
      enableScheduledEvents,
      enableRandomSocialEvents,
      dialogueMaxTurns,
      demoStory,
    },
    config,
    runId,
    paths: {
      agents: merged.agentsPath
        ? resolveDataPath(merged.agentsPath)
        : agentsDefault,
      relationships: merged.relationshipsPath
        ? resolveDataPath(merged.relationshipsPath)
        : relDefault,
      publicCatalog: join(dataDir, "event_catalogs", "public_500.json"),
      randomCatalog: join(dataDir, "event_catalogs", "random_500.json"),
      templatesDir: join(dataDir, "event_templates"),
      knowledgePath: join(dataDir, "knowledge", "gift_norms.json"),
      dataDir,
      runsDir: join(dataDir, "runs"),
    },
    wantDemoStory,
    wantDemoManuals: config.queueDemoManuals !== false && agentScale !== 100,
    loadPublicCatalog: config.loadPublicCatalog !== false,
    loadRandomCatalog: config.loadRandomCatalog !== false,
    source,
  };
}

export function variantLabel(variant: ExperimentVariant): string {
  return VARIANT_SPECS[variant]?.label ?? variant;
}
