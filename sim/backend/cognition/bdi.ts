import type {
  GiftRecord,
  IntentionRecord,
  PersonalGoal,
  PersonalEventRecord,
  PrivateState,
  SimTime,
} from "../../shared/types/index.js";

/** Sync Belief from a PET row (B ← PET). */
export function syncBeliefFromPet(
  beliefs: Record<string, number>,
  eid: string,
  confidence: number,
): Record<string, number> {
  const key = `event:${eid}`;
  const prev = beliefs[key] ?? 0;
  return { ...beliefs, [key]: Math.max(prev, Math.min(1, confidence)) };
}

/** Instantiate Desire from a PersonalGoal (D ← Goals). */
export function desireFromGoal(goal: PersonalGoal): { key: string; priority: number } {
  return {
    key: `goal:${goal.goalId}`,
    priority: goal.priority / 100,
  };
}

/** High-priority / due goals become Intentions (I). */
export function intentionFromGoal(goal: PersonalGoal): { key: string; record: IntentionRecord } {
  return {
    key: `${goal.goalType}:${goal.goalId}`,
    record: {
      slotDue: goal.deadline,
      actionType: goal.goalType,
      params: { ...goal.params, eid: goal.eid, goalId: goal.goalId },
      priority: goal.priority,
      eid: goal.eid,
    },
  };
}

export function applyGoalsToBdi(privateState: PrivateState, goals: PersonalGoal[]): PrivateState {
  const desires = { ...privateState.desires };
  const intentions = { ...privateState.intentions };
  for (const g of goals) {
    if (g.status !== "pending" && g.status !== "in_progress") continue;
    const d = desireFromGoal(g);
    desires[d.key] = d.priority;
    if (g.priority >= 70 || g.goalType === "give_gift" || g.goalType === "reply_gift") {
      const i = intentionFromGoal(g);
      intentions[i.key] = i.record;
    }
  }
  return { ...privateState, desires, intentions };
}

export function applyPetBeliefs(
  privateState: PrivateState,
  pets: PersonalEventRecord[],
): { next: PrivateState; changed: string[] } {
  let beliefs = { ...privateState.beliefs };
  const changed: string[] = [];
  for (const p of pets) {
    const before = beliefs[`event:${p.eid}`] ?? 0;
    beliefs = syncBeliefFromPet(beliefs, p.eid, p.confidence);
    if ((beliefs[`event:${p.eid}`] ?? 0) !== before) changed.push(p.eid);
  }
  return { next: { ...privateState, beliefs }, changed };
}

export function isDue(now: SimTime, due?: SimTime): boolean {
  if (!due) return false;
  if (now.day !== due.day) return now.day >= due.day;
  const order = { AM: 0, PM: 1, EVE: 2 } as const;
  return order[now.slot] >= order[due.slot];
}

/**
 * P3-07: keep repay Intentions aligned with pending gift ledger (I ← reply window).
 * Boosts priority when the window is due / near due.
 */
export function syncRepayIntentionsFromLedger(
  privateState: PrivateState,
  agentId: string,
  ledger: GiftRecord[],
  now: SimTime,
): { next: PrivateState; added: string[]; removed: string[] } {
  const intentions = { ...privateState.intentions };
  const desires = { ...privateState.desires };
  const added: string[] = [];
  const removed: string[] = [];

  const pendingOwed = ledger.filter(
    (g) => g.to === agentId && g.status === "pending_reply",
  );
  const liveKeys = new Set(pendingOwed.map((g) => `repay:${g.gid}`));

  for (const key of Object.keys(intentions)) {
    if (key.startsWith("repay:") && !liveKeys.has(key)) {
      delete intentions[key];
      delete desires[`desire:${key}`];
      removed.push(key);
    }
  }

  for (const g of pendingOwed) {
    const key = `repay:${g.gid}`;
    const due = isDue(now, g.replyWindowEnd);
    const priority = due ? 95 : 80;
    if (!intentions[key]) added.push(key);
    intentions[key] = {
      slotDue: { ...g.replyWindowEnd },
      actionType: "repay_gift",
      params: {
        originalGid: g.gid,
        to: g.from,
        minValue: g.adjustedValue,
      },
      priority,
      eid: g.eid,
    };
    desires[`desire:${key}`] = priority / 100;
  }

  return { next: { ...privateState, intentions, desires }, added, removed };
}

/**
 * Window-default BDIE update (rule-of-return-gift R16–R20 + rule-of-gift-flow §3.2.D20).
 * - Debtor: clear repay I/D; Belief of default; stress↑ mood↓; optional repair desire
 * - Creditor: Belief that counterpart defaulted; mild emotion hit
 * Emotion/belief magnitudes scale with `severity` ∈ [0,1] (default 0.7 ≈ legacy).
 */
export function applyGiftDefaultToBdi(
  privateState: PrivateState,
  role: "debtor" | "creditor",
  gift: GiftRecord,
  otherId: string,
  severity = 0.7,
): {
  next: PrivateState;
  before: {
    beliefs: Record<string, number>;
    desires: Record<string, number>;
    intentions: Record<string, IntentionRecord>;
    emotion: PrivateState["emotion"];
  };
  after: {
    beliefs: Record<string, number>;
    desires: Record<string, number>;
    intentions: Record<string, IntentionRecord>;
    emotion: PrivateState["emotion"];
  };
  formula: string;
} {
  const s = Math.max(0, Math.min(1, severity));
  const before = {
    beliefs: { ...privateState.beliefs },
    desires: { ...privateState.desires },
    intentions: { ...privateState.intentions },
    emotion: { ...privateState.emotion },
  };
  const beliefs = { ...privateState.beliefs };
  const desires = { ...privateState.desires };
  const intentions = { ...privateState.intentions };
  const emotion = { ...privateState.emotion };
  const formulas: string[] = [];

  if (role === "debtor") {
    const repayKey = `repay:${gift.gid}`;
    delete intentions[repayKey];
    delete desires[`desire:${repayKey}`];
    beliefs[`gift_defaulted:${gift.gid}`] = 1;
    beliefs[`broke_reciprocity:${otherId}`] = Math.min(
      1,
      (beliefs[`broke_reciprocity:${otherId}`] ?? 0) + 0.45 * s,
    );
    // R20: repair desire rises with normCompliance proxy (Agreeableness / prior desire)
    const repairBase = 0.5 + 0.3 * s;
    desires[`desire:repair_relationship:${otherId}`] = Math.max(
      desires[`desire:repair_relationship:${otherId}`] ?? 0,
      repairBase,
    );
    desires[`desire:repair_face:${otherId}`] = Math.max(
      desires[`desire:repair_face:${otherId}`] ?? 0,
      0.65 * s,
    );
    // R16: stress += 15×severity mapped onto [0,1] emotion scale → 0.15×s baseline×legacy
    emotion.stress = Math.min(1, emotion.stress + 0.15 * s + 0.03);
    emotion.mood = Math.max(0, emotion.mood - 0.12 * s - 0.03);
    emotion.energy = Math.max(0, emotion.energy - 0.05 * s);
    formulas.push(
      `debtor: clear repay I/D; B[gift_defaulted]=1; D[repair]; stress/mood×severity(${s.toFixed(2)})`,
    );
  } else {
    beliefs[`gift_defaulted_by:${otherId}:${gift.gid}`] = 1;
    // R19: "B 不可靠" +0.3×severity
    beliefs[`untrustworthy:${otherId}`] = Math.min(
      1,
      (beliefs[`untrustworthy:${otherId}`] ?? 0) + 0.3 * s,
    );
    // R20: maintain_relationship desire drops
    const maintainKey = `desire:maintain_relationship:${otherId}`;
    if (desires[maintainKey] != null) {
      desires[maintainKey] = Math.max(0, desires[maintainKey]! * (1 - 0.4 * s));
    }
    // R18: low-priority confront / distance intentions
    if (s >= 0.3) {
      intentions[`distance:${otherId}`] = {
        slotDue: gift.replyWindowEnd,
        actionType: "custom",
        params: { reason: "gift_default", gid: gift.gid },
        priority: Math.round(40 + 30 * s),
      };
    }
    // R17: creditor stress += 8×severity → ~0.08×s on [0,1]
    const neuro = privateState.bigFive?.N ?? 0.5;
    const neuroMul = 1 + Math.max(0, neuro - 0.5);
    emotion.stress = Math.min(1, emotion.stress + 0.08 * s * neuroMul);
    emotion.mood = Math.max(0, emotion.mood - 0.1 * s);
    formulas.push(
      `creditor: B[untrustworthy]+=${(0.3 * s).toFixed(2)}; stress/mood×severity; optional distance I`,
    );
  }

  const next: PrivateState = {
    ...privateState,
    beliefs,
    desires,
    intentions,
    emotion,
  };
  return {
    next,
    before,
    after: {
      beliefs: { ...beliefs },
      desires: { ...desires },
      intentions: { ...intentions },
      emotion: { ...emotion },
    },
    formula: formulas.join("; "),
  };
}

/** List high-priority / due intentions (observable for agent_driven in P6). */
export function listActionableIntentions(
  privateState: PrivateState,
  now: SimTime,
  minPriority = 70,
): Array<{ key: string; record: IntentionRecord; due: boolean }> {
  return Object.entries(privateState.intentions)
    .map(([key, record]) => ({
      key,
      record,
      due: isDue(now, record.slotDue),
    }))
    .filter((x) => (x.record.priority ?? 0) >= minPriority || x.due)
    .sort((a, b) => (b.record.priority ?? 0) - (a.record.priority ?? 0));
}
