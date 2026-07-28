import type { PrivateState } from "../../shared/types/index.js";

const META_KEYS = new Set(["__count", "__sum"]);

/**
 * Stamp belief ages when keys appear / are reinforced.
 * Existing keys keep their first-learned day unless `reinforce` is true.
 */
export function stampBeliefDays(
  privateState: PrivateState,
  keys: string[],
  day: number,
  opts: { reinforce?: boolean } = {},
): PrivateState {
  const learned = { ...(privateState.beliefLearnedDay ?? {}) };
  for (const key of keys) {
    if (!key || META_KEYS.has(key)) continue;
    if (opts.reinforce || learned[key] == null) learned[key] = day;
  }
  return { ...privateState, beliefLearnedDay: learned };
}

export interface ForgetBeliefsResult {
  next: PrivateState;
  forgotten: string[];
}

/**
 * Randomly forget beliefs older than `maxAgeDays` (default 30).
 * Higher age → higher forget chance; protected keys (repay/abandon) are skipped.
 */
export function forgetOldBeliefs(
  privateState: PrivateState,
  day: number,
  rng: () => number,
  opts: { maxAgeDays?: number; baseRate?: number } = {},
): ForgetBeliefsResult {
  const maxAgeDays = opts.maxAgeDays ?? 30;
  const baseRate = opts.baseRate ?? 0.2;
  const beliefs = { ...privateState.beliefs };
  const learned = { ...(privateState.beliefLearnedDay ?? {}) };
  const forgotten: string[] = [];

  // Backfill missing ages conservatively as "old enough" once.
  for (const key of Object.keys(beliefs)) {
    if (META_KEYS.has(key)) continue;
    if (learned[key] == null) learned[key] = Math.max(1, day - maxAgeDays - 1);
  }

  for (const key of Object.keys(beliefs)) {
    if (META_KEYS.has(key)) continue;
    if (key.startsWith("repay:") || key.startsWith("abandon_repay:")) continue;
    const learnedDay = learned[key] ?? day;
    const age = day - learnedDay;
    if (age < maxAgeDays) continue;
    const over = age - maxAgeDays;
    const p = Math.min(0.75, baseRate + over * 0.02);
    if (rng() < p) {
      delete beliefs[key];
      delete learned[key];
      forgotten.push(key);
    }
  }

  return {
    next: { ...privateState, beliefs, beliefLearnedDay: learned },
    forgotten,
  };
}
