import type {
  AgentState,
  GiftRecord,
  IntentionRecord,
  LogEntry,
  RelationshipEdge,
  SimTime,
  SlotMetrics,
} from "../types/index.js";
import type {
  ReplayCheckpoint,
  ReplayCognitiveSummary,
  ReplayData,
  ReplayStep,
  ReplayWorldState,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numericRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function intentionRecord(value: unknown): Record<string, IntentionRecord> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).filter(
      (entry): entry is [string, IntentionRecord] =>
        Boolean(entry[1]) && typeof entry[1] === "object" && !Array.isArray(entry[1]),
    ),
  );
}

export function emptySlotMetrics(): SlotMetrics {
  return {
    giftGiven: 0,
    giftReplied: 0,
    giftDefaulted: 0,
    eventsCreated: 0,
    eventsCompleted: 0,
    eventsRejected: 0,
    dialoguesCompleted: 0,
    dialogueMessages: 0,
    cognitivePromotions: 0,
  };
}

export function emptyCognitiveSummary(): ReplayCognitiveSummary {
  return {
    active: 0,
    dialogue: 0,
    relation: 0,
    archived: 0,
    promotions: 0,
  };
}

export function cloneReplayState<T extends ReplayWorldState>(state: T): T {
  return structuredClone(state);
}

function ensureAgent(state: ReplayWorldState, agentId: string): AgentState | undefined {
  return state.agents[agentId];
}

function ensureCognitive(
  state: ReplayWorldState,
  agentId: string,
): ReplayCognitiveSummary {
  const current = state.cognitiveSummary[agentId];
  if (current) return current;
  const created = emptyCognitiveSummary();
  state.cognitiveSummary[agentId] = created;
  return created;
}

function ensureEdge(
  state: ReplayWorldState,
  from: string,
  to: string,
): RelationshipEdge {
  const existing = state.relationships.find((edge) => edge.from === from && edge.to === to);
  if (existing) return existing;
  const created: RelationshipEdge = {
    from,
    to,
    socialBasis: "other",
    intimacy: 20,
    trust: 20,
    affection: 20,
    authority: 10,
    giftDebt: 0,
    reciprocityScore: 0.3,
    relationAxis: "horizontal",
  };
  state.relationships.push(created);
  return created;
}

function applyPrivatePatch(agent: AgentState, patchValue: unknown): void {
  const patch = asRecord(patchValue);
  if (patch.beliefs) {
    agent.private.beliefs = {
      ...agent.private.beliefs,
      ...numericRecord(patch.beliefs),
    };
  }
  if (patch.desires) {
    agent.private.desires = {
      ...agent.private.desires,
      ...numericRecord(patch.desires),
    };
  }
  if (patch.intentions) {
    agent.private.intentions = {
      ...agent.private.intentions,
      ...intentionRecord(patch.intentions),
    };
  }
  if (patch.emotion) {
    const emotion = asRecord(patch.emotion);
    agent.private.emotion = {
      mood: asNumber(emotion.mood) ?? agent.private.emotion.mood,
      arousal: asNumber(emotion.arousal) ?? agent.private.emotion.arousal,
      stress: asNumber(emotion.stress) ?? agent.private.emotion.stress,
      energy: asNumber(emotion.energy) ?? agent.private.emotion.energy,
    };
  }
}

function applyBdiUpdate(state: ReplayWorldState, payload: JsonRecord): void {
  const agentId = asString(payload.agentId);
  if (!agentId) return;
  const agent = ensureAgent(state, agentId);
  if (!agent) return;

  if (payload.after) applyPrivatePatch(agent, payload.after);
  applyPrivatePatch(agent, payload);

  const kind = asString(payload.kind);
  if (kind === "desire_intention") {
    const goalId = asString(payload.goalId);
    const goalType = asString(payload.goalType);
    const priority = asNumber(payload.priority) ?? 0;
    if (goalId) {
      agent.private.desires[`goal:${goalId}`] = priority / 100;
      if (goalType && (priority >= 70 || goalType === "give_gift" || goalType === "reply_gift")) {
        const eid = goalId.split(":")[0];
        agent.private.intentions[`${goalType}:${goalId}`] = {
          actionType: goalType,
          params: { goalId, eid },
          priority,
          eid,
        };
      }
    }
  }
}

function updateCash(agent: AgentState | undefined, value: unknown): void {
  const cash = asNumber(value);
  if (agent && cash != null) agent.economy.cash = cash;
}

function applySocialSnapshot(agent: AgentState | undefined, value: unknown): void {
  if (!agent) return;
  const social = asRecord(value);
  for (const key of ["face", "prestige", "reputation"] as const) {
    const next = asNumber(social[key]);
    if (next != null) agent.public[key] = next;
  }
}

function applyRelationshipPatch(edge: RelationshipEdge, value: unknown): void {
  const patch = asRecord(value);
  for (const key of [
    "trust",
    "affection",
    "intimacy",
    "authority",
    "giftDebt",
    "reciprocityScore",
  ] as const) {
    const next = asNumber(patch[key]);
    if (next != null) edge[key] = next;
  }
  const socialBasis = asString(patch.socialBasis);
  if (socialBasis) edge.socialBasis = socialBasis as RelationshipEdge["socialBasis"];
  const relationAxis = asString(patch.relationAxis);
  if (relationAxis) edge.relationAxis = relationAxis as RelationshipEdge["relationAxis"];
  const interactionSummary = asString(patch.interactionSummary);
  if (interactionSummary) edge.interactionSummary = interactionSummary;
}

function upsertGift(state: ReplayWorldState, gift: GiftRecord): void {
  const index = state.giftLedger.findIndex((entry) => entry.gid === gift.gid);
  if (index >= 0) state.giftLedger[index] = { ...state.giftLedger[index]!, ...gift };
  else state.giftLedger.push(gift);
}

function isDue(now: SimTime, due: SimTime): boolean {
  if (now.day !== due.day) return now.day > due.day;
  const order = { AM: 0, PM: 1, EVE: 2 } as const;
  return order[now.slot] >= order[due.slot];
}

function syncRepayIntentions(
  state: ReplayWorldState,
  debtorId: string,
): void {
  const debtor = state.agents[debtorId];
  if (!debtor) return;
  const pending = state.giftLedger.filter(
    (gift) => gift.to === debtorId && gift.status === "pending_reply",
  );
  const liveKeys = new Set(pending.map((gift) => `repay:${gift.gid}`));
  for (const key of Object.keys(debtor.private.intentions)) {
    if (key.startsWith("repay:") && !liveKeys.has(key)) {
      delete debtor.private.intentions[key];
      delete debtor.private.desires[`desire:${key}`];
    }
  }
  for (const gift of pending) {
    const key = `repay:${gift.gid}`;
    const priority = isDue(state.simTime, gift.replyWindowEnd) ? 95 : 80;
    debtor.private.intentions[key] = {
      slotDue: gift.replyWindowEnd,
      actionType: "repay_gift",
      params: {
        originalGid: gift.gid,
        to: gift.from,
        minValue: gift.adjustedValue,
      },
      priority,
      eid: gift.eid,
    };
    debtor.private.desires[`desire:${key}`] = priority / 100;
  }
}

function removeRepayIntention(
  state: ReplayWorldState,
  debtorId: string,
  originalGid: string,
  removeDesire = true,
): void {
  const debtor = state.agents[debtorId];
  if (!debtor) return;
  delete debtor.private.intentions[`repay:${originalGid}`];
  if (removeDesire) delete debtor.private.desires[`desire:repay:${originalGid}`];
}

function applyGiftGiven(state: ReplayWorldState, payload: JsonRecord): void {
  const gift = payload.gift as GiftRecord | undefined;
  if (!gift?.gid) return;
  upsertGift(state, structuredClone(gift));
  const after = asRecord(payload.after);
  updateCash(state.agents[gift.from], after.fromCash);
  updateCash(state.agents[gift.to], after.toCash);
  const social = asRecord(after.social);
  applySocialSnapshot(state.agents[gift.from], social.giver);
  applySocialSnapshot(state.agents[gift.to], social.receiver);

  // Legacy flat fields used by older exported runs.
  const hostPrestige = asNumber(after.hostPrestige);
  if (hostPrestige != null && state.agents[gift.to]) {
    state.agents[gift.to]!.public.prestige = hostPrestige;
  }
  const giverFace = asNumber(after.giverFace);
  if (giverFace != null && state.agents[gift.from]) {
    state.agents[gift.from]!.public.face = giverFace;
  }
  const debtorEdge = ensureEdge(state, gift.to, gift.from);
  debtorEdge.reciprocityScore = Math.min(1, debtorEdge.reciprocityScore + 0.05);
  syncRepayIntentions(state, gift.to);
}

function applyGiftReplied(state: ReplayWorldState, payload: JsonRecord): void {
  const originalGid = asString(payload.originalGid);
  const original = originalGid
    ? state.giftLedger.find((gift) => gift.gid === originalGid)
    : undefined;
  const reply = payload.reply as GiftRecord | undefined;
  if (original) original.status = "replied";
  if (reply?.gid) {
    upsertGift(state, structuredClone(reply));
    // Older runs intentionally retained the fulfilled desire as memory while
    // clearing the actionable intention.
    removeRepayIntention(state, reply.from, originalGid ?? "", false);
    const after = asRecord(payload.after);
    updateCash(state.agents[reply.from], after.fromCash);
    updateCash(state.agents[reply.to], after.toCash);
    const social = asRecord(payload.social);
    const socialAfter = asRecord(social.after);
    applySocialSnapshot(state.agents[reply.from], socialAfter.giver);
    applySocialSnapshot(state.agents[reply.to], socialAfter.receiver);

    const forward = ensureEdge(state, reply.from, reply.to);
    const reverse = ensureEdge(state, reply.to, reply.from);
    if (payload.sufficient !== false) {
      for (const edge of [forward, reverse]) {
        edge.reciprocityScore = Math.min(1, edge.reciprocityScore + 0.1);
      }
    } else {
      // Legacy logs omitted relationship reciprocity snapshots for underpayment.
      const reputationDelta = asNumber(asRecord(social.deltas).giverReputation);
      const severity = reputationDelta == null ? undefined : Math.abs(reputationDelta) / 8;
      if (severity != null) {
        forward.reciprocityScore = Math.max(
          0,
          forward.reciprocityScore - 0.15 * severity * 0.65,
        );
      }
      reverse.reciprocityScore = Math.max(0, reverse.reciprocityScore - 0.1);
    }
  }
}

function applyGiftDefaulted(state: ReplayWorldState, payload: JsonRecord): void {
  const gift = payload.gift as GiftRecord | undefined;
  if (!gift?.gid) return;
  upsertGift(state, { ...structuredClone(gift), status: "defaulted" });
  removeRepayIntention(state, gift.to, gift.gid);

  const before = asRecord(payload.before);
  const after = asRecord(payload.after);
  const socialAfter = asRecord(after.social);
  // In default logs, giver is the debtor/defaulting party and receiver is the creditor.
  applySocialSnapshot(state.agents[gift.to], socialAfter.giver);
  applySocialSnapshot(state.agents[gift.from], socialAfter.receiver);

  // Compatibility for runs created before relationship.delta logged both edges fully.
  const debtorEdge = ensureEdge(state, gift.to, gift.from);
  applyRelationshipPatch(debtorEdge, after);
  debtorEdge.giftDebt *= 1.1;
  const beforeTrust = asNumber(before.trust);
  const afterTrust = asNumber(after.trust);
  const severity = asNumber(asRecord(payload.severity).severity);
  const creditorEdge = ensureEdge(state, gift.from, gift.to);
  if (beforeTrust != null && afterTrust != null) {
    creditorEdge.trust = Math.max(
      0,
      Math.min(100, creditorEdge.trust + (afterTrust - beforeTrust) * 0.6),
    );
  }
  if (severity != null) {
    creditorEdge.reciprocityScore = Math.max(
      0,
      creditorEdge.reciprocityScore - 0.1 * severity,
    );
  }
  creditorEdge.lastChangedAt = { ...state.simTime };
}

function applyEconomyMonthly(state: ReplayWorldState, payload: JsonRecord): void {
  const updates = Array.isArray(payload.updates)
    ? payload.updates
    : Array.isArray(payload.agents)
      ? payload.agents
      : [payload];
  for (const updateValue of updates) {
    const update = asRecord(updateValue);
    const agentId = asString(update.agentId) ?? asString(update.id);
    const agent = agentId ? state.agents[agentId] : undefined;
    if (!agent) continue;
    const after = asRecord(update.after ?? update);
    for (const key of [
      "cash",
      "deposit",
      "debt",
      "creditLimit",
      "income",
      "essentialExpenseRatio",
      "savingsRatio",
      "lastSettlementDay",
    ] as const) {
      const value = asNumber(after[key]);
      if (value != null) agent.economy[key] = value;
    }
  }
}

function incrementMetric(state: ReplayWorldState, key: keyof SlotMetrics): void {
  const current = state.metrics[key];
  if (typeof current === "number") {
    state.metrics[key] = current + 1;
  }
}

function clearCompletedGoals(state: ReplayWorldState, payload: JsonRecord): void {
  if (!Array.isArray(payload.goals)) return;
  for (const goalValue of payload.goals) {
    const goal = asRecord(goalValue);
    const agentId = asString(goal.agentId);
    const goalId = asString(goal.goalId);
    const goalType = asString(goal.type) ?? asString(goal.goalType);
    const status = asString(goal.status);
    const agent = agentId ? state.agents[agentId] : undefined;
    if (!agent || !goalId || status !== "completed") continue;
    delete agent.private.desires[`goal:${goalId}`];
    if (goalType) delete agent.private.intentions[`${goalType}:${goalId}`];
  }
}

/**
 * Apply the observable state mutation represented by one append-only log entry.
 * Slot checkpoints correct fields that an older run did not log explicitly.
 */
export function applyReplayLog(state: ReplayWorldState, log: LogEntry): ReplayWorldState {
  state.seq = Math.max(state.seq, log.seq);
  state.simTime = { ...log.simTime };
  const payload = asRecord(log.payload);

  switch (log.type) {
    case "event.created":
      incrementMetric(state, "eventsCreated");
      break;
    case "event.completed":
      incrementMetric(state, "eventsCompleted");
      clearCompletedGoals(state, payload);
      break;
    case "event.rejected":
      incrementMetric(state, "eventsRejected");
      break;
    case "event.propagated": {
      const agents = Array.isArray(payload.agents)
        ? payload.agents.filter((id): id is string => typeof id === "string")
        : [];
      for (const id of agents) state.petCounts[id] = (state.petCounts[id] ?? 0) + 1;
      break;
    }
    case "dialogue.message":
      incrementMetric(state, "dialogueMessages");
      break;
    case "dialogue.end":
      incrementMetric(state, "dialoguesCompleted");
      break;
    case "relationship.delta": {
      const from = asString(payload.from);
      const to = asString(payload.to);
      if (!from || !to) break;
      const edge = ensureEdge(state, from, to);
      const before = asRecord(payload.before);
      const after = asRecord(payload.after);
      applyRelationshipPatch(edge, after);
      edge.lastChangedAt = { ...log.simTime };

      // Legacy underpay logs omitted the reverse-edge trust delta.
      const reason = asString(payload.reason);
      const formula = asString(payload.formula);
      if (
        reason?.startsWith("repay ") &&
        formula?.startsWith("underpay ") &&
        asNumber(after.reciprocityScore) == null
      ) {
        const beforeTrust = asNumber(before.trust);
        const afterTrust = asNumber(after.trust);
        if (beforeTrust != null && afterTrust != null) {
          const reverse = ensureEdge(state, to, from);
          reverse.trust = Math.max(
            0,
            Math.min(100, reverse.trust + (afterTrust - beforeTrust) * 0.6),
          );
          reverse.lastChangedAt = { ...log.simTime };
        }
      }
      break;
    }
    case "bdi.updated":
      applyBdiUpdate(state, payload);
      break;
    case "gift.given":
      applyGiftGiven(state, payload);
      incrementMetric(state, "giftGiven");
      break;
    case "gift.replied":
      applyGiftReplied(state, payload);
      incrementMetric(state, "giftReplied");
      break;
    case "gift.defaulted":
      applyGiftDefaulted(state, payload);
      incrementMetric(state, "giftDefaulted");
      break;
    case "economy.monthly":
      applyEconomyMonthly(state, payload);
      break;
    case "cognitive.promoted": {
      const agentId = asString(payload.agentId);
      if (agentId) {
        const summary = ensureCognitive(state, agentId);
        summary.promotions += 1;
        summary.relation += 1;
        summary.active += 1;
      }
      incrementMetric(state, "cognitivePromotions");
      break;
    }
    default:
      break;
  }
  return state;
}

export function applyReplayLogs(
  source: ReplayWorldState,
  logs: LogEntry[],
): ReplayWorldState {
  const state = cloneReplayState(source);
  for (const log of logs) applyReplayLog(state, log);
  return state;
}

function checkpointBefore(
  checkpoints: ReplayCheckpoint[],
  targetSeq: number,
): ReplayCheckpoint | undefined {
  return checkpoints
    .filter((checkpoint) => checkpoint.seq <= targetSeq)
    .sort((a, b) => b.seq - a.seq)[0];
}

export function replayStateAtSeq(data: ReplayData, targetSeq: number): ReplayWorldState {
  const checkpoint = checkpointBefore(data.checkpoints, targetSeq);
  const base = checkpoint ?? data.initialState;
  const logs = data.logs.filter((log) => log.seq > base.seq && log.seq <= targetSeq);
  return applyReplayLogs(base, logs);
}

export function replayStateAtStep(data: ReplayData, stepIndex: number): ReplayWorldState {
  if (stepIndex < 0 || !data.steps.length) return cloneReplayState(data.initialState);
  const step = data.steps[Math.min(stepIndex, data.steps.length - 1)]!;
  return replayStateAtSeq(data, step.seqEnd);
}

export function logsForStep(data: ReplayData, step: ReplayStep): LogEntry[] {
  const seqs = new Set(step.logSeqs);
  return data.logs.filter((log) => seqs.has(log.seq));
}

export function simTimeLabel(time: SimTime): string {
  return `D${time.day}-${time.slot}`;
}
