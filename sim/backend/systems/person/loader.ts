import { readFileSync } from "node:fs";
import type { AgentState, PublicProfile, PrivateState, EconomyState } from "../../../shared/types/index.js";

interface AgentSeed {
  public: PublicProfile;
  private?: Partial<PrivateState>;
  economy: Omit<EconomyState, "agentId" | "lastSettlementDay"> & { lastSettlementDay?: number };
}

interface AgentsFile {
  agents: AgentSeed[];
}

function defaultPrivate(): PrivateState {
  return {
    bigFive: { O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 },
    beliefs: {},
    beliefLearnedDay: {},
    desires: {},
    intentions: {},
    emotion: { mood: 0.5, arousal: 0.3, stress: 0.2, energy: 0.7 },
  };
}

export function loadAgents(path: string): Record<string, AgentState> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as AgentsFile;
  const out: Record<string, AgentState> = {};
  for (const seed of raw.agents) {
    const id = seed.public.id;
    const face = seed.public.face ?? 50;
    const prestige = seed.public.prestige ?? face;
    const reputation = seed.public.reputation ?? Math.round((face + prestige) / 2);
    out[id] = {
      public: { ...seed.public, face, prestige, reputation },
      private: {
        ...defaultPrivate(),
        ...seed.private,
        bigFive: { ...defaultPrivate().bigFive, ...seed.private?.bigFive },
        emotion: { ...defaultPrivate().emotion, ...seed.private?.emotion },
        personality: seed.private?.personality
          ? { ...seed.private.personality }
          : undefined,
        beliefLearnedDay: {
          ...(defaultPrivate().beliefLearnedDay ?? {}),
          ...(seed.private?.beliefLearnedDay ?? {}),
        },
      },
      economy: {
        agentId: id,
        cash: seed.economy.cash,
        deposit: seed.economy.deposit,
        debt: seed.economy.debt,
        creditLimit: seed.economy.creditLimit,
        income: seed.economy.income,
        essentialExpenseRatio: seed.economy.essentialExpenseRatio,
        savingsRatio: seed.economy.savingsRatio,
        lastSettlementDay: seed.economy.lastSettlementDay ?? 0,
      },
    };
  }
  return out;
}
