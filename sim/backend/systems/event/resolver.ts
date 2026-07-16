import type { WorldState } from "../../store/world_state.js";
import type { ResolveContext, RoleResolverSpec, RoleSlot } from "../../../shared/types/event_template.js";

function cardinalityMax(c: RoleSlot["cardinality"]): number {
  return typeof c === "number" ? c : c.max;
}

function cardinalityMin(c: RoleSlot["cardinality"]): number {
  return typeof c === "number" ? c : c.min;
}

function pickN<T>(items: T[], n: number, rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, Math.max(0, n));
}

/**
 * RoleResolver: fill roleSlots → agentId lists.
 * Supports: fixed, self, kinship, relationship, neighbor, same_community,
 * same_workplace, random_adult, tag_match.
 */
export class RoleResolver {
  resolveAll(
    world: WorldState,
    slots: RoleSlot[],
    ctx: ResolveContext,
  ): { bindings: Record<string, string[]>; error?: string } {
    const bindings: Record<string, string[]> = {};

    // Pass 1: slots without ofSlot dependencies (or with overrides)
    const pending = [...slots];
    let guard = 0;
    while (pending.length && guard++ < 20) {
      let progressed = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const slot = pending[i]!;
        if (ctx.roleOverrides?.[slot.slotId]) {
          bindings[slot.slotId] = [...ctx.roleOverrides[slot.slotId]!];
          pending.splice(i, 1);
          progressed = true;
          continue;
        }
        const needs = dependsOnSlot(slot.resolver);
        if (needs && !bindings[needs]) continue;
        const ids = this.resolveOne(world, slot, bindings, ctx);
        if (slot.required && ids.length < cardinalityMin(slot.cardinality)) {
          return {
            bindings,
            error: `role ${slot.slotId}: need ≥${cardinalityMin(slot.cardinality)}, got ${ids.length}`,
          };
        }
        bindings[slot.slotId] = ids.slice(0, cardinalityMax(slot.cardinality));
        pending.splice(i, 1);
        progressed = true;
      }
      if (!progressed) {
        return { bindings, error: `unresolvable slots: ${pending.map((s) => s.slotId).join(",")}` };
      }
    }
    return { bindings };
  }

  private resolveOne(
    world: WorldState,
    slot: RoleSlot,
    bindings: Record<string, string[]>,
    ctx: ResolveContext,
  ): string[] {
    const r = slot.resolver;
    const max = cardinalityMax(slot.cardinality);
    switch (r.type) {
      case "fixed":
        return world.agents[r.agentId] ? [r.agentId] : [];
      case "self":
        return ctx.sourceAgentId && world.agents[ctx.sourceAgentId] ? [ctx.sourceAgentId] : [];
      case "tag_match": {
        const hits = Object.values(world.agents)
          .filter((a) => a.public.socialTags?.includes(r.tag))
          .map((a) => a.public.id);
        return pickN(hits, Math.min(max, r.count), ctx.rng);
      }
      case "kinship": {
        const anchors = bindings[r.ofSlot] ?? [];
        const kin = new Set<string>();
        for (const id of anchors) {
          for (const k of world.agents[id]?.public.kinship ?? []) kin.add(k);
        }
        return pickN([...kin].filter((id) => world.agents[id]), max, ctx.rng);
      }
      case "relationship": {
        const anchors = bindings[r.ofSlot] ?? [];
        const scores = new Map<string, number>();
        for (const from of anchors) {
          for (const e of world.relationships.filter((x) => x.from === from)) {
            const metric = r.metric === "trust" ? e.trust : e.affection;
            scores.set(e.to, Math.max(scores.get(e.to) ?? 0, metric));
          }
        }
        return [...scores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, Math.min(max, r.topK))
          .map(([id]) => id);
      }
      case "neighbor": {
        const anchors = bindings[r.ofSlot] ?? [];
        const topK = r.topK ?? max;
        const ids = new Set<string>();
        for (const from of anchors) {
          for (const e of world.relationships.filter(
            (x) => x.from === from && (x.socialBasis === "neighbor" || x.socialBasis === "friend"),
          )) {
            ids.add(e.to);
          }
        }
        return pickN([...ids], Math.min(max, topK), ctx.rng);
      }
      case "same_community": {
        const community =
          r.communityId ??
          Object.values(world.agents).find((a) => a.public.communityId)?.public.communityId ??
          "village";
        const hits = Object.values(world.agents)
          .filter((a) => (a.public.communityId ?? "village") === community)
          .map((a) => a.public.id);
        return pickN(hits, max, ctx.rng);
      }
      case "same_workplace": {
        const anchors = bindings[r.ofSlot] ?? [];
        const workplaces = new Set(
          anchors.map((id) => world.agents[id]?.public.workplaceId).filter(Boolean) as string[],
        );
        const hits = Object.values(world.agents)
          .filter((a) => a.public.workplaceId && workplaces.has(a.public.workplaceId))
          .map((a) => a.public.id)
          .filter((id) => !anchors.includes(id));
        return pickN(hits, max, ctx.rng);
      }
      case "random_adult": {
        const exclude = new Set<string>();
        for (const s of r.excludeSlots ?? []) {
          for (const id of bindings[s] ?? []) exclude.add(id);
        }
        const minAge = r.minAge ?? 18;
        const maxAge = r.maxAge ?? 80;
        const hits = Object.values(world.agents)
          .filter((a) => a.public.age >= minAge && a.public.age <= maxAge && !exclude.has(a.public.id))
          .map((a) => a.public.id);
        return pickN(hits, max, ctx.rng);
      }
      default: {
        const _e: never = r;
        void _e;
        return [];
      }
    }
  }
}

function dependsOnSlot(r: RoleResolverSpec): string | null {
  if (
    r.type === "kinship" ||
    r.type === "relationship" ||
    r.type === "neighbor" ||
    r.type === "same_workplace"
  ) {
    return r.ofSlot;
  }
  return null;
}
