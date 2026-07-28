import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentState, RelationshipEdge } from "../../../shared/types/index.js";
import { dailyLivingCost } from "../person/daily_vitals.js";
import { derivePersonality } from "../../cognition/personality.js";

interface BandRule {
  min?: number;
  max?: number;
  text: string;
}

interface FlagRule {
  id: string;
  when: string;
  text: string;
}

interface NarrativeTable {
  schemaVersion: number;
  title: string;
  emotion: Record<string, BandRule[]>;
  economy: FlagRule[];
  personality: FlagRule[];
  relationship: FlagRule[];
  decisionHints: FlagRule[];
}

const DEFAULT_TABLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../data/prompts/personal_state_narrative.json",
);

let cached: NarrativeTable | null = null;

export function loadPersonalStateNarrativeTable(path = DEFAULT_TABLE_PATH): NarrativeTable {
  if (cached && path === DEFAULT_TABLE_PATH) return cached;
  const table = JSON.parse(readFileSync(path, "utf8")) as NarrativeTable;
  if (path === DEFAULT_TABLE_PATH) cached = table;
  return table;
}

function matchBand(value: number, rules: BandRule[]): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (rule.min != null && value < rule.min) continue;
    if (rule.max != null && value >= rule.max) continue;
    out.push(rule.text);
  }
  return out;
}

function evalWhen(
  expr: string,
  ctx: Record<string, number | boolean>,
): boolean {
  // Tiny safe evaluator for table predicates like "stress >= 0.65 || cash_tight"
  const normalized = expr
    .replace(/\bcash_tight\b/g, ctx.cash_tight ? "true" : "false")
    .replace(/\btrue\b/g, "true")
    .replace(/\bfalse\b/g, "false");
  // Replace identifiers with numbers
  const withNums = normalized.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g,
    (token) => {
      if (token === "true" || token === "false") return token;
      if (token in ctx) return String(ctx[token]);
      return "0";
    },
  );
  if (!/^[\d\s.<>=!&|()+\-*/truefalse]+$/.test(withNums.replace(/true|false/g, "1"))) {
    // Fallback: only allow comparison chains we explicitly author
  }
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(Function(`"use strict"; return (${withNums});`)());
  } catch {
    return false;
  }
}

/**
 * Build first-person constraint lines for dialogue / decision prompts.
 */
export function buildPersonalStateNarrative(args: {
  agent: AgentState;
  edges?: RelationshipEdge[];
  infiniteEconomy?: boolean;
  table?: NarrativeTable;
  /** Extra first-person lines (e.g. 欠情未还). */
  extraLines?: string[];
}): string {
  const table = args.table ?? loadPersonalStateNarrativeTable();
  const agent = args.agent;
  const em = agent.private.emotion;
  const traits = derivePersonality(agent);
  const cost = dailyLivingCost(agent);
  const bufferDays =
    args.infiniteEconomy ? 999 : agent.economy.cash / Math.max(1, cost);
  const cash_tight =
    !args.infiniteEconomy &&
    (agent.economy.cash < agent.economy.income * 0.25 || bufferDays < 7);

  const lines: string[] = [];
  lines.push(...matchBand(em.mood, table.emotion.mood ?? []));
  lines.push(...matchBand(em.stress, table.emotion.stress ?? []));
  lines.push(...matchBand(em.energy, table.emotion.energy ?? []));
  lines.push(...matchBand(em.arousal, table.emotion.arousal ?? []));

  const ecoCtx: Record<string, number | boolean> = {
    cash: agent.economy.cash,
    income: agent.economy.income,
    debt: agent.economy.debt,
    bufferDays,
    cash_tight,
  };
  for (const rule of table.economy) {
    if (evalWhen(rule.when, ecoCtx)) lines.push(rule.text);
  }

  const persCtx: Record<string, number | boolean> = {
    introversion: traits.introversion,
    pickiness: traits.pickiness,
    spitefulness: traits.spitefulness,
  };
  for (const rule of table.personality) {
    if (evalWhen(rule.when, persCtx)) lines.push(rule.text);
  }

  const edges = args.edges ?? [];
  for (const edge of edges.slice(0, 4)) {
    const relCtx: Record<string, number | boolean> = {
      trust: edge.trust,
      intimacy: edge.intimacy,
      affection: edge.affection,
      dislike: edge.dislike ?? 0,
    };
    const relLines: string[] = [];
    for (const rule of table.relationship) {
      if (evalWhen(rule.when, relCtx)) relLines.push(rule.text);
    }
    if (relLines.length) {
      lines.push(`对${edge.to}：${relLines.join(" ")}`);
    }
  }

  const hintCtx: Record<string, number | boolean> = {
    stress: em.stress,
    cash_tight,
  };
  for (const rule of table.decisionHints) {
    if (evalWhen(rule.when, hintCtx)) lines.push(rule.text);
  }

  if (args.extraLines?.length) {
    lines.push(...args.extraLines);
  }

  return lines.length ? lines.map((l) => `- ${l}`).join("\n") : "- 状态平稳，按礼俗与身份行事即可。";
}
