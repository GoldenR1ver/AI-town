/**
 * P5 experiment variant presets (E1–E4 contrast + baseline + ablation A0–A3).
 */
import type { ExperimentConfig, ExperimentVariant, RelationshipEdge } from "../../shared/types/index.js";

export interface VariantSpec {
  id: ExperimentVariant;
  label: string;
  enableGiftMemory: boolean;
  enableReciprocityRules: boolean;
  enableOccasionNorms: boolean;
  stripVertical?: boolean;
  /** Ablation: personal attributes + B/D/I/E drive. */
  enableBdieDrive?: boolean;
  /** Ablation: cognitive tree. */
  enableCognitiveTree?: boolean;
  /** Ablation: unbounded cash → inflated gift expectations. */
  infiniteEconomy?: boolean;
  enableRandomSocialEvents?: boolean;
}

export const VARIANT_SPECS: Record<ExperimentVariant, VariantSpec> = {
  baseline: {
    id: "baseline",
    label: "基线",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
  },
  E1_memory_on: {
    id: "E1_memory_on",
    label: "E1 有礼单记忆",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
  },
  E1_memory_off: {
    id: "E1_memory_off",
    label: "E1 无礼单记忆",
    enableGiftMemory: false,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
  },
  E2_reciprocity_on: {
    id: "E2_reciprocity_on",
    label: "E2 互惠规则开",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
  },
  E2_reciprocity_off: {
    id: "E2_reciprocity_off",
    label: "E2 互惠规则关",
    enableGiftMemory: true,
    enableReciprocityRules: false,
    enableOccasionNorms: true,
  },
  E3_horizontal_only: {
    id: "E3_horizontal_only",
    label: "E3 仅横向",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
    stripVertical: true,
  },
  E3_with_vertical: {
    id: "E3_with_vertical",
    label: "E3 含纵向",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
  },
  E4_occasion_off: {
    id: "E4_occasion_off",
    label: "E4 无场合规范",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: false,
  },
  E4_occasion_on: {
    id: "E4_occasion_on",
    label: "E4 有场合规范",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
  },
  A0_full: {
    id: "A0_full",
    label: "消融对照·全开",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
    enableBdieDrive: true,
    enableCognitiveTree: true,
    infiniteEconomy: false,
    enableRandomSocialEvents: true,
  },
  A1_no_bdie: {
    id: "A1_no_bdie",
    label: "消融·无个人属性/BDIE",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
    enableBdieDrive: false,
    enableCognitiveTree: true,
    infiniteEconomy: false,
    enableRandomSocialEvents: true,
  },
  A2_no_cognitive: {
    id: "A2_no_cognitive",
    label: "消融·无认知树",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
    enableBdieDrive: true,
    enableCognitiveTree: false,
    infiniteEconomy: false,
    enableRandomSocialEvents: true,
  },
  A3_infinite_economy: {
    id: "A3_infinite_economy",
    label: "消融·无限资金",
    enableGiftMemory: true,
    enableReciprocityRules: true,
    enableOccasionNorms: true,
    enableBdieDrive: true,
    enableCognitiveTree: true,
    infiniteEconomy: true,
    enableRandomSocialEvents: true,
  },
};

export const ABLATION_VARIANTS: ExperimentVariant[] = [
  "A0_full",
  "A1_no_bdie",
  "A2_no_cognitive",
  "A3_infinite_economy",
];

export function resolveVariant(raw?: string): ExperimentVariant {
  const v = (raw ?? "baseline") as ExperimentVariant;
  return VARIANT_SPECS[v] ? v : "baseline";
}

export function buildConfig(opts: {
  runId: string;
  name?: string;
  startDay?: number;
  endDay: number;
  seed: number;
  variant: ExperimentVariant;
  llmMode: "mock" | "live";
  enableScheduledEvents?: boolean;
  enableDialogue?: boolean;
  dialogueMaxTurns?: number;
  enableRandomSocialEvents?: boolean;
  maxRandomSocialPerSlot?: number;
}): ExperimentConfig {
  const spec = VARIANT_SPECS[opts.variant];
  return {
    runId: opts.runId,
    name: opts.name ?? spec.label,
    startDay: opts.startDay ?? 1,
    endDay: opts.endDay,
    seed: opts.seed,
    enableReciprocityRules: spec.enableReciprocityRules,
    enableGiftMemory: spec.enableGiftMemory,
    enableScheduledEvents: opts.enableScheduledEvents ?? true,
    enableOccasionNorms: spec.enableOccasionNorms,
    enableAxisReciprocity: spec.enableReciprocityRules,
    enableDialogue: opts.enableDialogue,
    dialogueMaxTurns: opts.dialogueMaxTurns,
    llmMode: opts.llmMode,
    variant: opts.variant,
    enableBdieDrive: spec.enableBdieDrive ?? true,
    enableCognitiveTree: spec.enableCognitiveTree ?? true,
    infiniteEconomy: spec.infiniteEconomy ?? false,
    enableRandomSocialEvents:
      opts.enableRandomSocialEvents ?? spec.enableRandomSocialEvents ?? true,
    maxRandomSocialPerSlot: opts.maxRandomSocialPerSlot,
  };
}

/** E3: optionally flatten vertical axes to horizontal. */
export function applyVariantEdges(
  edges: RelationshipEdge[],
  variant: ExperimentVariant,
): RelationshipEdge[] {
  const spec = VARIANT_SPECS[variant];
  if (!spec.stripVertical) return edges;
  return edges.map((e) =>
    e.relationAxis === "horizontal" ? e : { ...e, relationAxis: "horizontal" as const },
  );
}
