/**
 * Apply ablation transforms to a loaded world (A1/A2/A3).
 * Call after agents + edges are loaded, before the clock starts.
 */
import type { AgentState, ExperimentConfig } from "../../shared/types/index.js";
import type { WorldState } from "../store/world_state.js";

const INFINITE_CASH = 1e12;

const FLAT_BIG_FIVE = { O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 };
const FLAT_EMOTION = { mood: 0.5, arousal: 0.3, stress: 0.2, energy: 0.7 };

/** A1: neutralize personal attributes + B/D/I/E so drive becomes near-uniform. */
export function flattenBdieAndAttributes(agent: AgentState): void {
  agent.private.bigFive = { ...FLAT_BIG_FIVE };
  agent.private.beliefs = {};
  agent.private.desires = {};
  agent.private.intentions = {};
  agent.private.emotion = { ...FLAT_EMOTION };
  agent.public.face = 50;
  agent.public.prestige = 50;
  agent.public.reputation = 50;
}

/** A3: unbound liquidity so cash clamp no longer binds gift size. */
export function applyInfiniteEconomy(agent: AgentState): void {
  agent.economy.cash = INFINITE_CASH;
  agent.economy.deposit = INFINITE_CASH;
  agent.economy.debt = 0;
  agent.economy.creditLimit = INFINITE_CASH;
}

export function applyAblationToWorld(world: WorldState, config: ExperimentConfig = world.config): void {
  for (const agent of Object.values(world.agents)) {
    if (config.enableBdieDrive === false) flattenBdieAndAttributes(agent);
    if (config.infiniteEconomy) applyInfiniteEconomy(agent);
  }
  if (config.enableCognitiveTree === false) {
    for (const id of Object.keys(world.agents)) {
      world.cognitiveTrees[id] = [];
    }
  }
}
