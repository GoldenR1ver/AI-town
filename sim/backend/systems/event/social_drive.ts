/**
 * State-driven random social events (串门 / 闲谈 / …).
 * Scores initiator from BDIE + BigFive + relationship, then materializes templates.
 */
import type {
  AgentState,
  EmotionState,
  EventInstance,
  RelationshipEdge,
  SimTime,
} from "../../../shared/types/index.js";
import type { EventTemplate } from "../../../shared/types/event_template.js";
import type { WorldState } from "../../store/world_state.js";
import type { LogWriter } from "../../log/log_writer.js";
import type { EventGenerator } from "./generator.js";
import type { EventTemplateLibrary } from "./library.js";

export interface SocialEffects {
  moodDelta: number;
  stressDelta: number;
  energyDelta: number;
  arousalDelta: number;
  trustDelta: number;
  affectionDelta: number;
  intimacyDelta: number;
  valence: "positive" | "negative" | "mixed";
}

export interface SocialDriveOptions {
  enableBdieDrive: boolean;
  maxPerSlot: number;
  /** Per-agent attempt probability before scoring (after personality modulation). */
  baseAttemptRate: number;
}

const DEFAULT_OPTS: SocialDriveOptions = {
  enableBdieDrive: true,
  maxPerSlot: 8,
  baseAttemptRate: 0.12,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function personalityDrive(agent: AgentState, enableAttrs: boolean): number {
  if (!enableAttrs) return 0.5;
  const { E, A, N, O } = agent.private.bigFive;
  const introversion = agent.private.personality?.introversion ?? 1 - E;
  return clamp01(0.45 * E + 0.2 * A + 0.15 * O - 0.2 * N + 0.4 - introversion * 0.35);
}

function emotionDrive(em: EmotionState): number {
  // High energy + mood, low stress → more social; very high stress suppresses initiation.
  const base = clamp01(0.35 * em.mood + 0.4 * em.energy - 0.25 * em.stress + 0.15 * em.arousal);
  if (em.stress >= 0.65) return clamp01(base * 0.35);
  return base;
}

function intentionSocialBonus(agent: AgentState, enableBdie: boolean): number {
  if (!enableBdie) return 0;
  const keys = Object.keys(agent.private.intentions);
  let bonus = 0;
  for (const k of keys) {
    if (/chat|visit|social|gift|reply/i.test(k)) bonus += 0.08;
  }
  const desireSum = Object.values(agent.private.desires).reduce((s, v) => s + v, 0);
  return clamp01(bonus + Math.min(0.2, desireSum * 0.05));
}

/** Probability an agent initiates a social event this slot. */
export function initiatorProbability(
  agent: AgentState,
  opts: SocialDriveOptions,
): number {
  const enable = opts.enableBdieDrive;
  const p =
    opts.baseAttemptRate *
    (0.4 + 0.6 * personalityDrive(agent, enable)) *
    (0.5 + 0.5 * (enable ? emotionDrive(agent.private.emotion) : 0.5)) *
    (1 + intentionSocialBonus(agent, enable));
  return clamp01(p);
}

/** Score a directed pair for selecting the counterpart. */
export function pairScore(
  from: AgentState,
  to: AgentState,
  edge: RelationshipEdge | undefined,
  opts: SocialDriveOptions,
  mode: "social" | "gossip" = "social",
): number {
  if (!edge) return 0.05;
  const dislike = edge.dislike ?? 0;
  if (mode === "gossip") {
    // Prefer disliked / low-affection targets to badmouth.
    return Math.max(
      0.01,
      dislike * 1.4 +
        Math.max(0, 55 - edge.affection) * 0.4 +
        Math.max(0, 50 - edge.trust) * 0.25 +
        (from.private.personality?.spitefulness ?? from.private.bigFive.N) * 20,
    );
  }
  const rel =
    edge.affection * 0.35 +
    edge.intimacy * 0.3 +
    edge.trust * 0.25 -
    dislike * 0.55 +
    (edge.socialBasis === "kin" ? 12 : edge.socialBasis === "friend" ? 8 : 0);
  const prestigePull = (to.public.prestige ?? 50) * 0.15 + (to.public.face ?? 50) * 0.08;
  const wealthPull = Math.log10(1 + to.economy.cash + to.economy.deposit) * 4;
  let moodSeek = 0;
  if (opts.enableBdieDrive && from.private.emotion.stress > 0.55) {
    // Stressed agents prefer high-A / high-affection targets (comfort), avoid disliked.
    moodSeek = (to.private.bigFive.A ?? 0.5) * 10 + edge.affection * 0.1 - dislike * 0.3;
  }
  return Math.max(0.01, rel + prestigePull + wealthPull * 0.5 + moodSeek);
}

function sampleWeighted<T>(items: T[], weights: number[], rng: () => number): T | null {
  if (items.length === 0) return null;
  let sum = 0;
  for (const w of weights) sum += Math.max(0, w);
  if (sum <= 0) return items[Math.floor(rng() * items.length)] ?? null;
  let r = rng() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]!);
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/** Resolve outcome valence from personalities + relation quality. */
export function resolveSocialEffects(
  template: EventTemplate,
  from: AgentState,
  to: AgentState,
  edge: RelationshipEdge | undefined,
  opts: SocialDriveOptions,
  rng: () => number,
): SocialEffects {
  const base = (template.params?.socialEffects as Partial<SocialEffects> | undefined) ?? {};
  const intimacy = edge?.intimacy ?? 30;
  const affection = edge?.affection ?? 20;
  const agree = opts.enableBdieDrive
    ? ((from.private.bigFive.A + to.private.bigFive.A) / 2)
    : 0.5;
  const neurotic = opts.enableBdieDrive
    ? ((from.private.bigFive.N + to.private.bigFive.N) / 2)
    : 0.5;
  const quality = clamp01((intimacy + affection) / 200 + agree * 0.3 - neurotic * 0.25);
  const flipNeg = rng() > quality + 0.15;
  const sign = flipNeg ? -1 : 1;
  const mag = 0.6 + rng() * 0.8;
  const valence: SocialEffects["valence"] =
    sign > 0 ? "positive" : quality > 0.35 ? "mixed" : "negative";

  return {
    moodDelta: (base.moodDelta ?? 0.04 * sign) * mag,
    stressDelta: (base.stressDelta ?? -0.03 * sign) * mag,
    energyDelta: (base.energyDelta ?? (sign > 0 ? -0.02 : -0.05)) * mag,
    arousalDelta: (base.arousalDelta ?? 0.02) * mag,
    trustDelta: (base.trustDelta ?? 1.2 * sign) * mag,
    affectionDelta: (base.affectionDelta ?? 1.8 * sign) * mag,
    intimacyDelta: (base.intimacyDelta ?? 1.0 * Math.abs(sign === -1 ? 0.4 : 1)) * mag,
    valence,
  };
}

export function isRandomSocialTemplate(t: EventTemplate): boolean {
  return (
    t.trigger.method === "agent_driven" ||
    Boolean(t.params?.randomSocial) ||
    t.subType.startsWith("social_")
  );
}

/**
 * Generate up to maxPerSlot agent-driven social events for this slot.
 */
export function generateStateDrivenSocial(args: {
  world: WorldState;
  time: SimTime;
  library: EventTemplateLibrary;
  generator: EventGenerator;
  rng: () => number;
  log?: LogWriter;
  options?: Partial<SocialDriveOptions>;
}): EventInstance[] {
  const opts: SocialDriveOptions = { ...DEFAULT_OPTS, ...args.options };
  const templates = args.library.randomSocialTemplates();
  if (templates.length === 0) return [];

  const agentIds = Object.keys(args.world.agents);
  const candidates: { fromId: string; weight: number }[] = [];
  for (const id of agentIds) {
    const agent = args.world.agents[id]!;
    const p = initiatorProbability(agent, opts);
    if (args.rng() < p) candidates.push({ fromId: id, weight: p });
  }
  // Shuffle-ish by weight and take attempts
  candidates.sort((a, b) => b.weight - a.weight);

  const out: EventInstance[] = [];
  const usedPair = new Set<string>();

  for (const c of candidates) {
    if (out.length >= opts.maxPerSlot) break;
    const from = args.world.agents[c.fromId]!;
    const edges = args.world.relationships.filter((e) => e.from === c.fromId);
    const targets = edges.length
      ? edges.map((e) => e.to)
      : agentIds.filter((id) => id !== c.fromId).slice(0, 12);
    if (targets.length === 0) continue;

    const spite =
      from.private.personality?.spitefulness ??
      Math.max(0, from.private.bigFive.N * 0.6 + (1 - from.private.bigFive.A) * 0.4);
    const disliked = edges.filter((e) => (e.dislike ?? 0) >= 20 || e.affection < 32);
    const wantGossip =
      opts.enableBdieDrive &&
      spite >= 0.5 &&
      disliked.length > 0 &&
      args.rng() < 0.22 + spite * 0.25;

    const gossipTemplates = templates.filter(
      (t) => t.subType === "social_gossip" || Boolean(t.params?.gossip),
    );
    const normalTemplates = templates.filter(
      (t) => t.subType !== "social_gossip" && !t.params?.gossip,
    );
    const pool =
      wantGossip && gossipTemplates.length
        ? gossipTemplates
        : normalTemplates.length
          ? normalTemplates
          : templates;
    const tpl = pool[Math.floor(args.rng() * pool.length)]!;
    const isGossip = tpl.subType === "social_gossip" || Boolean(tpl.params?.gossip);

    let toId: string | null = null;
    let gossipTargetId: string | null = null;

    if (isGossip) {
      const gWeights = disliked.map((e) =>
        pairScore(from, args.world.agents[e.to]!, e, opts, "gossip"),
      );
      gossipTargetId = sampleWeighted(
        disliked.map((e) => e.to),
        gWeights,
        args.rng,
      );
      // Listener: prefer friends/kin with low dislike
      const listeners = edges.filter(
        (e) =>
          e.to !== gossipTargetId &&
          (e.dislike ?? 0) < 30 &&
          (e.socialBasis === "friend" || e.socialBasis === "kin" || e.affection >= 40),
      );
      const listenPool = listeners.length ? listeners : edges.filter((e) => e.to !== gossipTargetId);
      const lWeights = listenPool.map((e) =>
        pairScore(from, args.world.agents[e.to]!, e, opts, "social"),
      );
      toId = sampleWeighted(
        listenPool.map((e) => e.to),
        lWeights,
        args.rng,
      );
    } else {
      const weights = targets.map((tid) =>
        pairScore(from, args.world.agents[tid]!, edges.find((e) => e.to === tid), opts, "social"),
      );
      toId = sampleWeighted(targets, weights, args.rng);
    }

    if (!toId) continue;
    if (isGossip && !gossipTargetId) continue;
    const pairKey = isGossip
      ? `g|${c.fromId}|${toId}|${gossipTargetId}`
      : [c.fromId, toId].sort().join("|");
    if (usedPair.has(pairKey)) continue;
    usedPair.add(pairKey);

    const edge = edges.find((e) => e.to === toId);
    const effects = resolveSocialEffects(
      tpl,
      from,
      args.world.agents[toId]!,
      edge,
      opts,
      args.rng,
    );

    const ev = args.generator.generateManual(
      args.world,
      tpl.templateId,
      args.time,
      args.rng,
      {
        source: "agent_driven",
        sourceAgentId: c.fromId,
        roleOverrides: {
          initiator: [c.fromId],
          partner: [toId],
          host: [c.fromId],
          guest: [toId],
          ...(gossipTargetId ? { target: [gossipTargetId] } : {}),
        },
        payload: {
          ...(tpl.params ?? {}),
          randomSocial: true,
          socialEffects: effects,
          partnerId: toId,
          ...(gossipTargetId
            ? { gossip: true, targetId: gossipTargetId, drive: "spite_gossip" }
            : { drive: "bdie_social" }),
        },
      },
    );
    if (!ev) continue;
    out.push(ev);
  }

  return out;
}
