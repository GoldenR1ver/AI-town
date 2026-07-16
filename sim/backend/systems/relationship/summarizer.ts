import type { AgentState, RelationshipEdge } from "../../../shared/types/index.js";
import { round2 } from "../../../shared/format.js";

/** Human-readable relationship summary injected into dialogue prompts (P3-04). */
export class RelationshipSummarizer {
  summarizeEdge(
    edge: RelationshipEdge,
    self?: AgentState,
    other?: AgentState,
  ): string {
    const selfName = self?.public.name ?? edge.from;
    const otherName = other?.public.name ?? edge.to;
    const axisLabel =
      edge.relationAxis === "horizontal"
        ? "横向对等"
        : edge.relationAxis === "vertical_up"
          ? "纵向（向上）"
          : "纵向（向下）";
    const debt =
      edge.giftDebt > 0
        ? `对${otherName}尚有礼债约¥${round2(edge.giftDebt).toFixed(2)}`
        : "无礼债";
    const warmth =
      edge.affection >= 60
        ? "关系较热络"
        : edge.affection >= 35
          ? "关系平常"
          : "关系偏冷";
    const trustWord =
      edge.trust >= 70 ? "高度信任" : edge.trust >= 40 ? "基本信任" : "信任不足";
    const basis = edge.socialBasis;
    const tip = edge.interactionSummary
      ? `近期印象：${edge.interactionSummary}`
      : "";
    return [
      `${selfName}→${otherName}（${basis}/${axisLabel}）`,
      `${trustWord} trust=${round2(edge.trust).toFixed(2)}`,
      `亲密=${round2(edge.intimacy).toFixed(2)} 好感=${round2(edge.affection).toFixed(2)}`,
      `互惠分=${round2(edge.reciprocityScore).toFixed(2)}；${debt}`,
      warmth,
      tip,
    ]
      .filter(Boolean)
      .join("；");
  }

  summarizeForPrompt(
    edges: RelationshipEdge[],
    agents: Record<string, AgentState>,
  ): string {
    if (!edges.length) return "(无直接关系边)";
    return edges
      .map((e) => this.summarizeEdge(e, agents[e.from], agents[e.to]))
      .join("\n");
  }
}
