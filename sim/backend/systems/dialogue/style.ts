import type { AgentState, StyleProfile } from "../../../shared/types/index.js";

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Deterministic attribute → speaking-style projection. It never changes world state. */
export function deriveStyleProfile(agent: AgentState): StyleProfile {
  const { bigFive: b, emotion: e } = agent.private;
  const ageFormality = Math.min(1, agent.public.age / 75);
  const authority = agent.public.socialTags?.includes("authority") ? 0.15 : 0;
  const svoCooperation = clamp01(((agent.private.svoAngle ?? 30) + 15) / 75);
  return {
    talkativeness: clamp01(0.45 * b.E + 0.25 * e.mood + 0.3 * e.energy),
    formality: clamp01(0.5 * ageFormality + authority + 0.25 * b.C),
    directness: clamp01(0.45 * (1 - b.N) + 0.35 * e.arousal + 0.2 * b.E),
    cooperationBias: clamp01(0.5 * b.A + 0.3 * svoCooperation + 0.2 * (1 - e.stress)),
    riskTolerance: clamp01(0.45 * e.mood + 0.35 * (1 - b.N) + 0.2 * b.O),
    emotionalExpressiveness: clamp01(0.55 * e.arousal + 0.45 * b.E),
  };
}

export function styleInstruction(s: StyleProfile): string {
  return [
    `健谈度=${s.talkativeness.toFixed(2)}`,
    `正式度=${s.formality.toFixed(2)}`,
    `直接度=${s.directness.toFixed(2)}`,
    `合作倾向=${s.cooperationBias.toFixed(2)}`,
    `风险容忍=${s.riskTolerance.toFixed(2)}`,
    `情感表达=${s.emotionalExpressiveness.toFixed(2)}`,
    "以上仅控制措辞，不得自行修改关系、现金或礼单。",
  ].join("；");
}
