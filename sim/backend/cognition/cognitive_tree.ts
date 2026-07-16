/**
 * Individual cognitive tree — four layers (social → circle → relation → dialogue).
 * Phase 3 MVP: dialogue → relation promotion when influenceSum ≥ threshold.
 * Circle/social promotion is stubbed for Phase 6.
 */
import type { CognitiveLayer, CognitiveNode, SimTime } from "../../shared/types/index.js";
import type { LogWriter } from "../log/log_writer.js";

export type { CognitiveLayer, CognitiveNode };

/** dialogue → relation promotion threshold (simulation-development-plan §2.2). */
export const DIALOGUE_TO_RELATION_THRESHOLD = 15;

/** relation → circle / circle → social — deferred to P6. */
export const RELATION_TO_CIRCLE_THRESHOLD = 40;
export const CIRCLE_TO_SOCIAL_THRESHOLD = 100;

let nodeCounter = 0;

function makeNodeId(agentId: string, layer: CognitiveLayer): string {
  return `ct_${agentId}_${layer}_${++nodeCounter}`;
}

export interface ArchiveDialogueArgs {
  agentId: string;
  /** Counterpart agent (relation scope). */
  scope: string;
  cid: string;
  summary: string;
  keyFacts: string[];
  influenceScore: number;
  time: SimTime;
}

export interface PromoteResult {
  promoted: boolean;
  dialogueNode?: CognitiveNode;
  relationNode?: CognitiveNode;
}

export class CognitiveTreeManager {
  constructor(
    private trees: Record<string, CognitiveNode[]> = {},
    private readonly log?: LogWriter,
    private readonly dialogueThreshold = DIALOGUE_TO_RELATION_THRESHOLD,
  ) {}

  setTrees(trees: Record<string, CognitiveNode[]>): void {
    this.trees = trees;
  }

  all(): Record<string, CognitiveNode[]> {
    return this.trees;
  }

  nodesOf(agentId: string): CognitiveNode[] {
    return this.trees[agentId] ?? [];
  }

  activeNodes(agentId: string, layer?: CognitiveLayer): CognitiveNode[] {
    return this.nodesOf(agentId).filter(
      (n) => !n.archived && (layer === undefined || n.layer === layer),
    );
  }

  /** Relation/circle summaries for dialogue prompt injection. */
  summarizeForPrompt(agentId: string, otherIds: string[], maxNodes = 6): string {
    const nodes = this.activeNodes(agentId).filter(
      (n) =>
        (n.layer === "relation" || n.layer === "circle") &&
        (!n.scope || otherIds.includes(n.scope) || n.layer === "circle"),
    );
    const picked = nodes
      .sort((a, b) => b.influenceSum - a.influenceSum)
      .slice(0, maxNodes);
    if (!picked.length) return "(无已上呈认知)";
    return picked
      .map((n) => `[${n.layer}${n.scope ? `:${n.scope}` : ""}] ${n.content}`)
      .join("；");
  }

  /**
   * Archive a dialogue into the dialogue layer; promote to relation if threshold met.
   * Returns promotion result for the caller / RuleEngine logging path.
   */
  archiveDialogue(args: ArchiveDialogueArgs): PromoteResult {
    const list = (this.trees[args.agentId] ??= []);
    let dialogue = list.find(
      (n) =>
        n.layer === "dialogue" &&
        !n.archived &&
        n.scope === args.scope,
    );
    const contentBits = [args.summary, ...args.keyFacts].filter(Boolean);
    const snippet = contentBits.join(" | ").slice(0, 280);

    if (!dialogue) {
      dialogue = {
        nodeId: makeNodeId(args.agentId, "dialogue"),
        agentId: args.agentId,
        layer: "dialogue",
        scope: args.scope,
        content: snippet,
        influenceSum: 0,
        sourceRefs: [],
        childIds: [],
        createdAt: { ...args.time },
        updatedAt: { ...args.time },
        archived: false,
      };
      list.push(dialogue);
    } else {
      dialogue.content = mergeText(dialogue.content, snippet, 280);
      dialogue.updatedAt = { ...args.time };
    }

    dialogue.influenceSum += Math.max(0, args.influenceScore);
    if (!dialogue.sourceRefs.includes(args.cid)) dialogue.sourceRefs.push(args.cid);

    if (dialogue.influenceSum < this.dialogueThreshold) {
      return { promoted: false, dialogueNode: { ...dialogue } };
    }
    return this.promoteDialogueToRelation(args.agentId, dialogue, args.time);
  }

  /**
   * Merge dialogue node into relation layer; archive the dialogue node.
   * Circle/social left for P6 (stub never fires in MVP).
   */
  promoteDialogueToRelation(
    agentId: string,
    dialogue: CognitiveNode,
    time: SimTime,
  ): PromoteResult {
    const list = (this.trees[agentId] ??= []);
    const scope = dialogue.scope ?? "unknown";
    let relation = list.find(
      (n) => n.layer === "relation" && !n.archived && n.scope === scope,
    );
    const merged = mergeText(
      relation?.content ?? "",
      `关于${scope}：${dialogue.content}`,
      360,
    );
    const beforeInfluence = relation?.influenceSum ?? 0;

    if (!relation) {
      relation = {
        nodeId: makeNodeId(agentId, "relation"),
        agentId,
        layer: "relation",
        scope,
        content: merged,
        influenceSum: dialogue.influenceSum,
        sourceRefs: [...dialogue.sourceRefs],
        childIds: [dialogue.nodeId],
        createdAt: { ...time },
        updatedAt: { ...time },
        archived: false,
      };
      list.push(relation);
    } else {
      relation.content = merged;
      relation.influenceSum += dialogue.influenceSum;
      for (const ref of dialogue.sourceRefs) {
        if (!relation.sourceRefs.includes(ref)) relation.sourceRefs.push(ref);
      }
      if (!relation.childIds.includes(dialogue.nodeId)) {
        relation.childIds.push(dialogue.nodeId);
      }
      relation.updatedAt = { ...time };
    }

    dialogue.parentId = relation.nodeId;
    dialogue.archived = true;
    dialogue.updatedAt = { ...time };

    this.log?.append(
      time,
      "cognitive.promoted",
      {
        agentId,
        fromLayer: "dialogue",
        toLayer: "relation",
        scope,
        dialogueNodeId: dialogue.nodeId,
        relationNodeId: relation.nodeId,
        influenceSum: dialogue.influenceSum,
        threshold: this.dialogueThreshold,
        before: { relationInfluence: beforeInfluence, content: relation.content.slice(0, 80) },
        after: {
          relationInfluence: relation.influenceSum,
          content: relation.content.slice(0, 160),
        },
        reason: `dialogue influenceSum ${dialogue.influenceSum} ≥ ${this.dialogueThreshold}`,
        formula: "promote when dialogue.influenceSum >= DIALOGUE_TO_RELATION_THRESHOLD",
      },
      { affectedAgents: [agentId, scope].filter(Boolean) },
    );

    return {
      promoted: true,
      dialogueNode: { ...dialogue },
      relationNode: { ...relation },
    };
  }

  /**
   * Archive a gift-default sanction into dialogue layer (may promote to relation).
   * Spec: rule-of-gift-flow §3.2.D20 — moral default becomes subjective memory.
   */
  archiveGiftDefault(args: {
    agentId: string;
    scope: string;
    gid: string;
    summary: string;
    time: SimTime;
    /** Defaults high enough that a single default can tip dialogue→relation. */
    influenceScore?: number;
  }): PromoteResult {
    return this.archiveDialogue({
      agentId: args.agentId,
      scope: args.scope,
      cid: `default:${args.gid}`,
      summary: args.summary,
      keyFacts: [`回礼违约 ${args.gid}`, `对方=${args.scope}`],
      influenceScore: args.influenceScore ?? 12,
      time: args.time,
    });
  }

  /** P6 stub: never promotes in Phase 3. */
  tryPromoteRelationToCircle(_agentId: string, _time: SimTime): PromoteResult {
    return { promoted: false };
  }
}

function mergeText(prev: string, next: string, maxLen: number): string {
  const joined = prev ? `${prev}；${next}` : next;
  return joined.slice(0, maxLen);
}
