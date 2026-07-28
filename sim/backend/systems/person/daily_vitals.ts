import type { AgentState, EmotionState } from "../../../shared/types/index.js";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

const OCCUPATION_COST_MULT: Record<string, number> = {
  村支书: 1.2,
  村长: 1.15,
  教师: 1.08,
  医生: 1.1,
  个体户: 1.05,
  司机: 1.0,
  工人: 0.95,
  农民: 0.88,
  务农: 0.88,
  家务: 0.85,
};

/**
 * Daily living cost in [20, 90] (tuned down after test2 over-drain).
 * Leaves headroom for gifts after monthly wage (~2–4.7k).
 */
export function dailyLivingCost(agent: AgentState): number {
  const income = Math.max(0, agent.economy.income);
  const prestige = agent.public.prestige ?? 50;
  const face = agent.public.face ?? 50;
  const status = (prestige + face) / 2;
  // ~income/60 ≈ daily essential share; status adds a small premium.
  const fromIncome = 18 + income / 60;
  const statusPremium = (status - 50) * 0.25;
  const occKey = Object.keys(OCCUPATION_COST_MULT).find((k) =>
    agent.public.occupation.includes(k),
  );
  const mult = occKey ? OCCUPATION_COST_MULT[occKey]! : 1;
  const ratioTilt = 0.9 + agent.economy.essentialExpenseRatio * 0.15;
  return clamp((fromIncome + statusPremium) * mult * ratioTilt, 20, 90);
}

export interface DailyVitalsResult {
  cost: number;
  cashBefore: number;
  cashAfter: number;
  emotionBefore: EmotionState;
  emotionAfter: EmotionState;
  economicStressDelta: number;
}

/**
 * Morning vitals: pay living cost (deposit buffer before debt), recover energy,
 * gentle mood mean-reversion, light economic stress (tuned after test2).
 */
export function applyDailyVitals(agent: AgentState, infiniteEconomy: boolean): DailyVitalsResult {
  const emotionBefore = { ...agent.private.emotion };
  const cashBefore = agent.economy.cash;
  const cost = infiniteEconomy ? 0 : dailyLivingCost(agent);

  if (!infiniteEconomy && cost > 0) {
    let need = cost;
    const fromCash = Math.min(agent.economy.cash, need);
    agent.economy.cash -= fromCash;
    need -= fromCash;
    if (need > 0) {
      const fromDeposit = Math.min(agent.economy.deposit, need);
      agent.economy.deposit -= fromDeposit;
      need -= fromDeposit;
    }
    // Residual shortfall → soft debt (not full compounding of previous over-cost).
    if (need > 0) agent.economy.debt += need;
  }

  const em = agent.private.emotion;
  // Daily energy recovery ≈ +0.18, soft-capped.
  em.energy = clamp01(Math.min(0.88, em.energy + 0.18));
  // Mild mood pull toward a slightly positive village baseline (0.55), not hard 0.5.
  em.mood = clamp01(em.mood + 0.06 * (0.55 - em.mood));
  // Mild overnight stress relief (keep some residual pressure).
  em.stress = clamp01(em.stress * 0.9);
  em.arousal = clamp01(em.arousal * 0.92);

  const liquid = agent.economy.cash + agent.economy.deposit;
  const income = Math.max(1, agent.economy.income);
  const bufferDays = liquid / Math.max(1, cost || dailyLivingCost(agent));
  // Baseline village load → equilibrium stress ≈ base/(1-0.9) ≈ 0.30 when cash OK.
  let economicStressDelta = 0.028;
  if (bufferDays < 5) economicStressDelta += 0.04;
  else if (bufferDays < 10) economicStressDelta += 0.022;
  else if (bufferDays < 20) economicStressDelta += 0.01;
  if (agent.economy.debt > income * 0.6) economicStressDelta += 0.03;
  else if (agent.economy.debt > income * 0.25) economicStressDelta += 0.015;
  if (liquid < income * 0.12) economicStressDelta += 0.02;
  if (bufferDays > 40 && agent.economy.debt < income * 0.1) economicStressDelta -= 0.008;

  em.stress = clamp01(em.stress + economicStressDelta);
  if (economicStressDelta > 0) {
    em.mood = clamp01(em.mood - economicStressDelta * 0.18);
  }

  return {
    cost,
    cashBefore,
    cashAfter: agent.economy.cash,
    emotionBefore,
    emotionAfter: { ...em },
    economicStressDelta,
  };
}
