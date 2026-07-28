import type { AgentState, PersonalityTraits } from "../../shared/types/index.js";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Derive temperament from BigFive when explicit personality is absent. */
export function derivePersonality(agent: AgentState): PersonalityTraits {
  const explicit = agent.private.personality;
  if (
    explicit &&
    Number.isFinite(explicit.introversion) &&
    Number.isFinite(explicit.pickiness) &&
    Number.isFinite(explicit.spitefulness)
  ) {
    return {
      introversion: clamp01(explicit.introversion),
      pickiness: clamp01(explicit.pickiness),
      spitefulness: clamp01(explicit.spitefulness),
    };
  }
  const { E, A, N, C } = agent.private.bigFive;
  return {
    introversion: clamp01(1 - E),
    pickiness: clamp01(0.45 * (1 - A) + 0.35 * N + 0.2 * C),
    spitefulness: clamp01(0.55 * N + 0.45 * (1 - A)),
  };
}

export function isIntroverted(traits: PersonalityTraits, threshold = 0.62): boolean {
  return traits.introversion >= threshold;
}

export function isPicky(traits: PersonalityTraits, threshold = 0.58): boolean {
  return traits.pickiness >= threshold;
}

export function isSpiteful(traits: PersonalityTraits, threshold = 0.55): boolean {
  return traits.spitefulness >= threshold;
}
