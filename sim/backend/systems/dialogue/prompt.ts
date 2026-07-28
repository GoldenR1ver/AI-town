import type {
  AgentState,
  ConversationMessage,
  DialogueMode,
  EventInstance,
  KnowledgeEntry,
  RelationshipEdge,
  StyleProfile,
} from "../../../shared/types/index.js";
import type { WorldState } from "../../store/world_state.js";
import { CognitiveTreeManager } from "../../cognition/cognitive_tree.js";
import { derivePersonality } from "../../cognition/personality.js";
import { RelationshipSummarizer } from "../relationship/summarizer.js";
import { deriveStyleProfile, styleInstruction } from "./style.js";
import { buildPersonalStateNarrative } from "./state_narrative.js";
import { formatGiftDebtNarrative } from "../../cognition/gift_debt_align.js";

export class PublicPromptBuilder {
  build(agent: AgentState): string {
    const p = agent.public;
    return JSON.stringify({
      id: p.id,
      name: p.name,
      age: p.age,
      gender: p.gender,
      occupation: p.occupation,
      education: p.education,
      hobbies: p.hobbies ?? [],
      habits: p.habits ?? [],
      kinship: p.kinship ?? [],
      socialTags: p.socialTags ?? [],
      face: p.face ?? 50,
      prestige: p.prestige ?? p.face ?? 50,
    });
  }
}

export class PrivatePromptBuilder {
  build(agent: AgentState): string {
    return JSON.stringify({
      bigFive: agent.private.bigFive,
      personality: derivePersonality(agent),
      svo: { angle: agent.private.svoAngle ?? 30, length: agent.private.svoLength ?? 1 },
      beliefs: agent.private.beliefs,
      desires: agent.private.desires,
      intentions: agent.private.intentions,
      emotion: agent.private.emotion,
    });
  }
}

export interface DialogPromptArgs {
  world: WorldState;
  selfId: string;
  otherIds: string[];
  event: EventInstance;
  mode: DialogueMode;
  history: ConversationMessage[];
  knowledge: KnowledgeEntry[];
}

export interface BuiltPrompt {
  system: string;
  user: string;
  style: StyleProfile;
}

export class DialogPromptBuilder {
  private readonly pub = new PublicPromptBuilder();
  private readonly priv = new PrivatePromptBuilder();
  private readonly relationSummary = new RelationshipSummarizer();

  build(args: DialogPromptArgs): BuiltPrompt {
    const self = args.world.agents[args.selfId];
    if (!self) throw new Error(`unknown self ${args.selfId}`);
    const others = args.otherIds.map((id) => args.world.agents[id]).filter(Boolean);
    const edges = args.otherIds
      .map((id) => args.world.relationships.find((e) => e.from === args.selfId && e.to === id))
      .filter((e): e is RelationshipEdge => Boolean(e));
    const pet = (args.world.personalEventTables[args.selfId] ?? [])
      .filter((r) => r.confidence >= 0.6)
      .slice(-8);
    const debts = args.world.giftLedger.filter(
      (g) =>
        g.status === "pending_reply" &&
        (g.from === args.selfId || g.to === args.selfId) &&
        args.otherIds.includes(g.from === args.selfId ? g.to : g.from),
    );
    const style = deriveStyleProfile(self);
    const modeText =
      args.mode === "host"
        ? "你是主持人，协调参与者，避免垄断发言。"
        : args.mode === "random"
          ? "你是群体随机发言者，只回应与当前场合相关的内容。"
          : "你在进行双人社会互动，回应对方并保持角色一致。";
    const relationText = this.relationSummary.summarizeForPrompt(edges, args.world.agents);
    const cognitionEnabled = args.world.config.enableCognitiveTree !== false;
    const cognition = cognitionEnabled
      ? new CognitiveTreeManager(args.world.cognitiveTrees).summarizeForPrompt(
          args.selfId,
          args.otherIds,
        )
      : "(认知树已消融)";
    const privateText =
      args.world.config.enableBdieDrive === false
        ? JSON.stringify({
            bigFive: { O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 },
            emotion: { mood: 0.5, arousal: 0.3, stress: 0.2, energy: 0.7 },
            note: "BDIE消融",
          })
        : this.priv.build(self);

    const stateNarrative =
      args.world.config.enableBdieDrive === false
        ? "- BDIE 已消融，按中性状态互动。"
        : buildPersonalStateNarrative({
            agent: self,
            edges,
            infiniteEconomy: args.world.config.infiniteEconomy === true,
            extraLines: formatGiftDebtNarrative(
              args.world,
              args.selfId,
              args.event.time ?? { day: 1, slot: "AM" },
            ),
          });

    const system = [
      `你扮演${self.public.name}。${modeText}`,
      "只能生成话语和影响建议；不得声称已修改现金、关系、礼单或事件状态。",
      "必须遵守下方【个人状态约束】；高压/缺钱/内向时不得表现成热心主动出资或主动邀约。",
      "若存在【欠情未还】，说话时可流露还礼压力，但不要主动请客加码；婚丧场合仍须体面。",
      "严格输出 JSON：{\"utterance\":\"...\",\"sentiment\":-1到1,\"politeness\":0到1,\"mentionedEids\":[\"...\"]}",
      `风格：${styleInstruction(style)}`,
    ].join("\n");

    const user = [
      `[Self公开] ${this.pub.build(self)}`,
      `[Self私人] ${privateText}`,
      `[个人状态约束]\n${stateNarrative}`,
      `[Other公开] ${others.map((a) => this.pub.build(a)).join("\n")}`,
      `[关系摘要] ${relationText}`,
      `[关系边] ${JSON.stringify(edges)}`,
      `[认知树] ${cognition}`,
      `[PET] ${JSON.stringify(pet)}`,
      `[礼债] ${JSON.stringify(debts)}`,
      `[事务] ${JSON.stringify({
        eid: args.event.eid,
        subType: args.event.subType,
        summary: args.event.summary,
      })}`,
      `[礼俗知识] ${args.knowledge.map((k) => `${k.key}:${k.content}`).join("；")}`,
      `[历史] ${args.history.map((m) => `${m.speakerId}:${m.text}`).join("\n") || "(无)"}`,
      "请生成本轮发言。",
    ].join("\n");
    return { system, user, style };
  }
}
