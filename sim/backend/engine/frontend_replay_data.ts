import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentState,
  ConversationRecord,
  LogEntry,
  RelationshipEdge,
  SimTime,
  WorldSnapshot,
} from "../../shared/types/index.js";
import { simTimeKey } from "../../shared/types/index.js";
import {
  emptyCognitiveSummary,
  emptySlotMetrics,
} from "../../shared/replay/reducer.js";
import type {
  ReplayCheckpoint,
  ReplayData,
  ReplayDialogueStep,
  ReplayStep,
  ReplayStepKind,
  ReplayStory,
  ReplayStoryAct,
  ReplayWorldState,
} from "../../shared/replay/types.js";
import { loadAgents } from "../systems/person/loader.js";
import { ReplayEngine } from "../store/replay_engine.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function trimSummary(value: unknown, fallback: string, maxLength = 180): string {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function readJsonIfExists(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function readJsonLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function loadRelationships(path: string): RelationshipEdge[] {
  const raw = asRecord(readJsonIfExists(path));
  return Array.isArray(raw.relationships)
    ? (raw.relationships as RelationshipEdge[])
    : [];
}

function normalizeStory(value: unknown): ReplayStory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as JsonRecord;
  const acts = Array.isArray(source.acts)
    ? source.acts
        .map((actValue): ReplayStoryAct | null => {
          const act = asRecord(actValue);
          const time = asRecord(act.time);
          const day = asNumber(time.day);
          const slot = asString(time.slot);
          const actNumber = asNumber(act.act);
          const title = asString(act.title);
          if (
            day == null ||
            !["AM", "PM", "EVE"].includes(slot ?? "") ||
            actNumber == null ||
            !title
          ) {
            return null;
          }
          return {
            act: actNumber,
            title,
            time: { day, slot: slot as SimTime["slot"] },
            tip: asString(act.tip),
            notes: stringArray(act.notes),
          };
        })
        .filter((act): act is ReplayStoryAct => Boolean(act))
    : [];
  return {
    ...source,
    title: asString(source.title),
    acts,
  };
}

function initialReplayState(
  dataDir: string,
  initialTime: SimTime,
  runAgentIds?: string[],
): ReplayWorldState {
  const loadedAgents = loadAgents(join(dataDir, "agents.json"));
  const allowed = runAgentIds?.length ? new Set(runAgentIds) : null;
  const agents = allowed
    ? Object.fromEntries(
        Object.entries(loadedAgents).filter(([agentId]) => allowed.has(agentId)),
      )
    : loadedAgents;
  const relationships = loadRelationships(join(dataDir, "relationships.json")).filter(
    (edge) => !allowed || (allowed.has(edge.from) && allowed.has(edge.to)),
  );
  return {
    seq: -1,
    simTime: { ...initialTime },
    agents,
    relationships,
    giftLedger: [],
    cognitiveSummary: Object.fromEntries(
      Object.keys(agents).map((agentId) => [agentId, emptyCognitiveSummary()]),
    ),
    petCounts: Object.fromEntries(Object.keys(agents).map((agentId) => [agentId, 0])),
    metrics: emptySlotMetrics(),
  };
}

export function snapshotToReplayCheckpoint(
  snapshot: WorldSnapshot,
): ReplayCheckpoint {
  const cognitiveSummary = Object.fromEntries(
    Object.entries(snapshot.cognitiveTrees ?? {}).map(([agentId, nodes]) => [
      agentId,
      {
        active: nodes.filter((node) => !node.archived).length,
        dialogue: nodes.filter((node) => node.layer === "dialogue" && !node.archived)
          .length,
        relation: nodes.filter((node) => node.layer === "relation" && !node.archived)
          .length,
        archived: nodes.filter((node) => node.archived).length,
        promotions: nodes.filter((node) => node.layer === "relation").length,
      },
    ]),
  );
  for (const agentId of Object.keys(snapshot.agents)) {
    cognitiveSummary[agentId] ??= emptyCognitiveSummary();
  }
  return {
    key: simTimeKey(snapshot.simTime),
    snapshotId: snapshot.snapshotId,
    seq: snapshot.seq,
    simTime: structuredClone(snapshot.simTime),
    agents: structuredClone(snapshot.agents),
    relationships: structuredClone(snapshot.relationships),
    giftLedger: structuredClone(snapshot.giftLedger),
    cognitiveSummary,
    petCounts: Object.fromEntries(
      Object.entries(snapshot.personalEventTables ?? {}).map(([agentId, rows]) => [
        agentId,
        rows.length,
      ]),
    ),
    metrics: structuredClone(snapshot.metrics),
  };
}

function storyActAt(story: ReplayStory | null, time: SimTime): ReplayStoryAct | undefined {
  return story?.acts?.find(
    (act) => act.time.day === time.day && act.time.slot === time.slot,
  );
}

function agentName(agentId: string, agents: Record<string, AgentState>): string {
  return agents[agentId]?.public.name
    ? `${agents[agentId]!.public.name}（${agentId}）`
    : agentId;
}

function collectFocusAgents(logs: LogEntry[]): string[] {
  const values: string[] = [];
  for (const log of logs) {
    values.push(...(log.statePointers?.affectedAgents ?? []));
    const payload = asRecord(log.payload);
    for (const key of ["speakerId", "agentId", "from", "to"] as const) {
      const value = asString(payload[key]);
      if (value) values.push(value);
    }
    values.push(...stringArray(payload.participants), ...stringArray(payload.agents));
    const gift = asRecord(payload.gift);
    const reply = asRecord(payload.reply);
    values.push(
      ...[asString(gift.from), asString(gift.to), asString(reply.from), asString(reply.to)].filter(
        (value): value is string => Boolean(value),
      ),
    );
    const bindings = asRecord(payload.roleBindings);
    for (const roleValues of Object.values(bindings)) values.push(...stringArray(roleValues));
  }
  return unique(values);
}

function collectEdgeKeys(logs: LogEntry[]): string[] {
  const values: string[] = [];
  for (const log of logs) {
    if (log.type !== "relationship.delta") continue;
    const payload = asRecord(log.payload);
    const from = asString(payload.from);
    const to = asString(payload.to);
    if (from && to) values.push(`${from}->${to}`);
  }
  return unique(values);
}

function collectGiftIds(logs: LogEntry[]): string[] {
  const values: string[] = [];
  for (const log of logs) {
    values.push(...(log.statePointers?.affectedGids ?? []));
    const payload = asRecord(log.payload);
    const gift = asRecord(payload.gift);
    const reply = asRecord(payload.reply);
    values.push(
      ...[
        asString(gift.gid),
        asString(reply.gid),
        asString(payload.originalGid),
      ].filter((value): value is string => Boolean(value)),
    );
  }
  return unique(values);
}

function collectEventIds(logs: LogEntry[]): string[] {
  const values: string[] = [];
  for (const log of logs) {
    values.push(...(log.statePointers?.affectedEids ?? []));
    const payload = asRecord(log.payload);
    const eid = asString(payload.eid);
    if (eid) values.push(eid);
    const gift = asRecord(payload.gift);
    const giftEid = asString(gift.eid);
    if (giftEid) values.push(giftEid);
  }
  return unique(values);
}

interface StepDetails {
  title: string;
  summary: string;
  dialogue?: ReplayDialogueStep;
  checkpointSeq?: number;
}

function createStep(
  steps: ReplayStep[],
  kind: ReplayStepKind,
  logs: LogEntry[],
  story: ReplayStory | null,
  details: StepDetails,
): ReplayStep {
  const first = logs[0]!;
  const last = logs[logs.length - 1]!;
  const act = storyActAt(story, first.simTime);
  const step: ReplayStep = {
    id: `step-${steps.length.toString().padStart(4, "0")}-${first.seq}-${last.seq}`,
    index: steps.length,
    kind,
    simTime: { ...first.simTime },
    seqStart: first.seq,
    seqEnd: last.seq,
    logSeqs: logs.map((log) => log.seq),
    title: details.title,
    summary: details.summary,
    focusAgentIds: collectFocusAgents(logs),
    affectedEdgeKeys: collectEdgeKeys(logs),
    affectedGiftIds: collectGiftIds(logs),
    affectedEventIds: collectEventIds(logs),
    act: act?.act,
    actTitle: act?.title,
    dialogue: details.dialogue,
    checkpointSeq: details.checkpointSeq,
  };
  steps.push(step);
  return step;
}

function dialogueFromStart(payload: JsonRecord): ReplayDialogueStep {
  return {
    cid: asString(payload.cid) ?? "unknown",
    participants: stringArray(payload.participants),
    mode: asString(payload.mode),
  };
}

function sameGiftContext(candidate: LogEntry, giftIds: string[]): boolean {
  const candidateGiftIds = collectGiftIds([candidate]);
  if (candidateGiftIds.some((id) => giftIds.includes(id))) return true;
  const reason = asString(asRecord(candidate.payload).reason) ?? "";
  return giftIds.some((id) => reason.includes(id));
}

function describeGift(
  log: LogEntry,
  agents: Record<string, AgentState>,
): StepDetails {
  const payload = asRecord(log.payload);
  const gift = asRecord(payload.gift);
  const reply = asRecord(payload.reply);
  const source = Object.keys(gift).length ? gift : reply;
  const from = asString(source.from) ?? "?";
  const to = asString(source.to) ?? "?";
  const value = asNumber(source.value);
  const description = asString(source.description);
  const action =
    log.type === "gift.given"
      ? "送出礼物"
      : log.type === "gift.replied"
        ? "完成回礼"
        : "礼债违约";
  return {
    title: `${action} · ${agentName(from, agents)} → ${agentName(to, agents)}`,
    summary: trimSummary(
      description,
      `${value != null ? `¥${value}` : "一笔礼物"} · ${asString(payload.reason) ?? action}`,
    ),
  };
}

function genericDetails(log: LogEntry, agents: Record<string, AgentState>): StepDetails {
  const payload = asRecord(log.payload);
  switch (log.type) {
    case "relationship.delta": {
      const from = asString(payload.from) ?? "?";
      const to = asString(payload.to) ?? "?";
      return {
        title: `关系变化 · ${agentName(from, agents)} → ${agentName(to, agents)}`,
        summary: trimSummary(payload.reason, "关系属性发生变化"),
      };
    }
    case "bdi.updated": {
      const id = asString(payload.agentId) ?? "?";
      return {
        title: `BDIE 更新 · ${agentName(id, agents)}`,
        summary: trimSummary(payload.reason, asString(payload.kind) ?? "认知状态更新"),
      };
    }
    case "cognitive.promoted": {
      const id = asString(payload.agentId) ?? "?";
      return {
        title: `认知晋升 · ${agentName(id, agents)}`,
        summary: trimSummary(payload.reason, "对话记忆上升为关系认知"),
      };
    }
    case "rule.rejected":
      return {
        title: "规则拒绝",
        summary: trimSummary(payload.reason, "非法状态变更被规则引擎拒绝"),
      };
    case "economy.monthly":
      return {
        title: "月度经济结算",
        summary: trimSummary(payload.reason, "收入、支出与储蓄完成结算"),
      };
    default:
      return {
        title: log.type,
        summary: trimSummary(payload.summary ?? payload.reason, log.type),
      };
  }
}

/**
 * Turn the append-only causal log into presentation steps without changing log order.
 * Every dialogue.message is kept as a dedicated step; noisy causal updates are grouped.
 */
export function buildSemanticSteps(
  sourceLogs: LogEntry[],
  agents: Record<string, AgentState>,
  story: ReplayStory | null,
): ReplayStep[] {
  const logs = [...sourceLogs].sort((a, b) => a.seq - b.seq);
  const steps: ReplayStep[] = [];
  let activeDialogue:
    | {
        start: ReplayDialogueStep;
        pending: LogEntry[];
      }
    | undefined;

  const flushDialoguePending = (fallbackSummary: string): void => {
    if (!activeDialogue?.pending.length) return;
    const group = activeDialogue.pending.splice(0);
    createStep(steps, "dialogue_result", group, story, {
      title: `对话影响 · ${activeDialogue.start.cid}`,
      summary: fallbackSummary,
      dialogue: { ...activeDialogue.start },
    });
  };

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i]!;
    const payload = asRecord(log.payload);

    if (activeDialogue) {
      if (log.type === "dialogue.message") {
        flushDialoguePending("对话过程中产生了状态变化");
        const speakerId = asString(payload.speakerId);
        createStep(steps, "dialogue_message", [log], story, {
          title: speakerId
            ? `${agentName(speakerId, agents)} 发言`
            : `对话消息 · ${activeDialogue.start.cid}`,
          summary: trimSummary(payload.text, "（空消息）", 360),
          dialogue: {
            ...activeDialogue.start,
            cid: asString(payload.cid) ?? activeDialogue.start.cid,
            speakerId,
            turn: asNumber(payload.turn),
            text: asString(payload.text),
            sentiment: asNumber(asRecord(payload.meta).sentiment),
            politeness: asNumber(asRecord(payload.meta).politeness),
          },
        });
        continue;
      }
      if (log.type === "dialogue.end") {
        const group = [...activeDialogue.pending, log];
        const resultPayload = payload;
        createStep(steps, "dialogue_result", group, story, {
          title: `对话结果 · ${activeDialogue.start.cid}`,
          summary: trimSummary(resultPayload.summary, "对话结束，关系与认知已结算", 360),
          dialogue: {
            ...activeDialogue.start,
            cid: asString(resultPayload.cid) ?? activeDialogue.start.cid,
            summary: asString(resultPayload.summary),
            keyFacts: stringArray(resultPayload.keyFacts),
          },
        });
        activeDialogue = undefined;
        continue;
      }
      if (log.type === "dialogue.start") {
        flushDialoguePending("上一段对话状态已结算");
        activeDialogue = undefined;
        i -= 1;
        continue;
      }
      activeDialogue.pending.push(log);
      continue;
    }

    if (log.type === "dialogue.start") {
      const dialogue = dialogueFromStart(payload);
      createStep(steps, "dialogue_start", [log], story, {
        title: `对话开始 · ${dialogue.cid}`,
        summary: `${dialogue.participants
          .map((id) => agentName(id, agents))
          .join("、")} · ${dialogue.mode ?? "dialogue"} 模式`,
        dialogue,
      });
      activeDialogue = { start: dialogue, pending: [] };
      continue;
    }

    if (log.type === "event.created") {
      const group = [log];
      const eid = asString(payload.eid);
      while (i + 1 < logs.length) {
        const next = logs[i + 1]!;
        const nextPayload = asRecord(next.payload);
        const nextKind = asString(nextPayload.kind);
        const sameEvent =
          !eid ||
          (next.statePointers?.affectedEids ?? []).includes(eid) ||
          asString(nextPayload.eid) === eid;
        if (
          sameEvent &&
          (next.type === "event.propagated" ||
            (next.type === "bdi.updated" && nextKind === "belief"))
        ) {
          group.push(next);
          i += 1;
        } else {
          break;
        }
      }
      createStep(steps, "event", group, story, {
        title: asString(payload.summary) ?? `事务创建 · ${eid ?? "unknown"}`,
        summary: `${asString(payload.templateId) ?? "event"} · 影响 ${collectFocusAgents(group).length} 人`,
      });
      continue;
    }

    if (
      log.type === "gift.given" ||
      log.type === "gift.replied" ||
      log.type === "gift.defaulted"
    ) {
      const group = [log];
      const giftIds = collectGiftIds(group);
      while (i + 1 < logs.length) {
        const next = logs[i + 1]!;
        if (
          ["relationship.delta", "bdi.updated", "cognitive.promoted"].includes(
            next.type,
          ) &&
          sameGiftContext(next, giftIds)
        ) {
          group.push(next);
          i += 1;
        } else {
          break;
        }
      }
      createStep(steps, "gift", group, story, describeGift(log, agents));
      continue;
    }

    if (log.type === "event.propagated" || log.type === "bdi.updated") {
      const group = [log];
      while (i + 1 < logs.length) {
        const next = logs[i + 1]!;
        if (next.type === "event.propagated" || next.type === "bdi.updated") {
          group.push(next);
          i += 1;
        } else {
          break;
        }
      }
      const desireCount = group.filter(
        (entry) => asString(asRecord(entry.payload).kind) === "desire_intention",
      ).length;
      createStep(steps, "intent", group, story, {
        title: desireCount
          ? `行动意图形成 · ${desireCount} 项`
          : `认知传播 · ${collectFocusAgents(group).length} 人`,
        summary: desireCount
          ? "事务目标进入 Desire / Intention，准备执行行动"
          : "Agent 根据事务信息更新 Belief",
      });
      continue;
    }

    if (log.type === "event.completed" || log.type === "event.rejected") {
      createStep(steps, "event_result", [log], story, {
        title:
          log.type === "event.completed"
            ? `事务完成 · ${asString(payload.eid) ?? ""}`
            : `事务被拒绝 · ${asString(payload.eid) ?? ""}`,
        summary: trimSummary(payload.summary ?? payload.reason, log.type),
      });
      continue;
    }

    if (log.type === "timeslot.start") {
      const act = storyActAt(story, log.simTime);
      createStep(steps, "time", [log], story, {
        title: `${simTimeKey(log.simTime)} · ${asString(payload.title) ?? act?.title ?? "新的时间段"}`,
        summary: act?.notes?.[0] ?? `时间推进至 ${simTimeKey(log.simTime)}`,
      });
      continue;
    }

    if (log.type === "timeslot.end") {
      const notes = stringArray(payload.notes);
      createStep(steps, "checkpoint", [log], story, {
        title: `${simTimeKey(log.simTime)} · 状态存档`,
        summary: notes.length
          ? notes.join("；")
          : `该时间段结束，世界状态已写入 ${asString(payload.snapshotId) ?? "快照"}`,
        checkpointSeq: log.seq,
      });
      continue;
    }

    if (log.type === "experiment.start") {
      createStep(steps, "intro", [log], story, {
        title: story?.title ?? "礼物的流动 · 实验开始",
        summary: trimSummary(payload.story, "多智能体社会仿真开始运行", 360),
      });
      continue;
    }

    if (log.type === "experiment.end") {
      createStep(steps, "system", [log], story, {
        title: "实验结束",
        summary: `共完成 ${asNumber(payload.acts) ?? story?.acts?.length ?? 0} 个剧情段落，${asNumber(payload.conversations) ?? 0} 段对话`,
      });
      continue;
    }

    if (log.type === "relationship.delta" || log.type === "cognitive.promoted") {
      const group = [log];
      while (i + 1 < logs.length && logs[i + 1]!.type === log.type) {
        group.push(logs[++i]!);
      }
      const detail = genericDetails(log, agents);
      if (group.length > 1) {
        detail.summary = `${detail.summary}；同组共 ${group.length} 项变化`;
      }
      createStep(steps, "system", group, story, detail);
      continue;
    }

    createStep(steps, "system", [log], story, genericDetails(log, agents));
  }

  if (activeDialogue) {
    flushDialoguePending("对话日志未正常结束，已保留现有状态变化");
  }

  return steps;
}

function loadConversations(
  runDir: string,
  checkpoints: ReplayCheckpoint[],
  engine: ReplayEngine,
  lite = false,
): ConversationRecord[] {
  const fromTable = readJsonLines<ConversationRecord>(
    join(runDir, "conversation_table.jsonl"),
  );
  const raw =
    fromTable.length > 0
      ? fromTable
      : checkpoints.length
        ? engine.seekTo(checkpoints[checkpoints.length - 1]!.simTime).conversations ?? []
        : [];
  if (!lite) return raw;
  // Keep transcript text; drop bulky BDIE/relationship bags for frontend size.
  return raw.map((conv) => ({
    ...conv,
    bdieImpact: {},
    relationshipDeltas: [],
  }));
}

export interface BuildReplayDataOptions {
  runId: string;
  runsRoot: string;
  dataDir: string;
  /**
   * Lite export for 50–100 agent runs: subsample checkpoints, drop bulky logs,
   * slim agent private bags so JSON stays under V8 string limits.
   */
  lite?: boolean;
  /** Keep every Nth snapshot (by sorted key order). Default 1; lite default 7. */
  checkpointStride?: number;
}

const ESSENTIAL_LOG_TYPES = new Set([
  "gift.given",
  "gift.replied",
  "gift.defaulted",
  "relationship.delta",
  "economy.monthly",
  "dialogue.start",
  "dialogue.message",
  "dialogue.end",
  "experiment.start",
  "experiment.end",
]);

function slimAgentForExport(agent: AgentState): AgentState {
  const beliefs = agent.private.beliefs ?? {};
  const desires = agent.private.desires ?? {};
  const beliefKeys = Object.keys(beliefs);
  const desireEntries = Object.entries(desires);
  // Keep lightweight count/sum stubs for focus-mode trajectory charts.
  return {
    ...agent,
    private: {
      ...agent.private,
      beliefs: beliefKeys.length
        ? ({ __count: beliefKeys.length } as AgentState["private"]["beliefs"])
        : {},
      desires: desireEntries.length
        ? ({
            __count: desireEntries.length,
            __sum: desireEntries.reduce((sum, [, value]) => sum + value, 0),
          } as AgentState["private"]["desires"])
        : {},
      intentions: Object.fromEntries(
        Object.entries(agent.private.intentions ?? {}).slice(0, 12),
      ),
    },
  };
}

function slimCheckpoint(cp: ReplayCheckpoint): ReplayCheckpoint {
  const agents: ReplayCheckpoint["agents"] = {};
  for (const [id, agent] of Object.entries(cp.agents)) {
    agents[id] = slimAgentForExport(agent);
  }
  return { ...cp, agents };
}

export function buildFrontendReplayData(
  options: BuildReplayDataOptions,
): ReplayData {
  const engine = new ReplayEngine();
  engine.loadExperiment(options.runId, options.runsRoot);
  const allLogs = engine.allLogs().sort((a, b) => a.seq - b.seq);
  if (!allLogs.length) throw new Error(`run ${options.runId} has no event_log.jsonl entries`);

  const keys = engine.listSnapshotKeys().sort((a, b) => {
    const pa = a.match(/D(\d+)-(AM|PM|EVE)/);
    const pb = b.match(/D(\d+)-(AM|PM|EVE)/);
    if (!pa || !pb) return a.localeCompare(b);
    const sa = { AM: 0, PM: 1, EVE: 2 }[pa[2] as "AM" | "PM" | "EVE"] ?? 0;
    const sb = { AM: 0, PM: 1, EVE: 2 }[pb[2] as "AM" | "PM" | "EVE"] ?? 0;
    return Number(pa[1]) - Number(pb[1]) || sa - sb;
  });

  // Probe agent count from first snapshot
  const firstKey = keys[0]!;
  const [fd, fs] = firstKey.slice(1).split("-") as [string, SimTime["slot"]];
  const firstSnap = engine.seekTo({ day: Number(fd), slot: fs });
  const agentCount = Object.keys(firstSnap.agents ?? {}).length;
  const lite =
    options.lite ??
    (process.env.EXPORT_LITE === "1" ||
      process.env.EXPORT_LITE === "true" ||
      agentCount >= 50);
  const stride = Math.max(
    1,
    options.checkpointStride ??
      (process.env.CHECKPOINT_STRIDE
        ? Number(process.env.CHECKPOINT_STRIDE)
        : lite
          ? 7
          : 1),
  );

  const keepIdx = new Set<number>();
  keepIdx.add(0);
  keepIdx.add(keys.length - 1);
  for (let i = 0; i < keys.length; i += stride) keepIdx.add(i);
  // Prefer EVE samples when striding
  if (lite) {
    for (let i = 0; i < keys.length; i++) {
      if (keys[i]!.endsWith("-EVE") && i % stride === 0) keepIdx.add(i);
    }
  }

  const checkpoints = [...keepIdx]
    .sort((a, b) => a - b)
    .map((i) => {
      const key = keys[i]!;
      const [dayText, slot] = key.slice(1).split("-") as [
        string,
        SimTime["slot"],
      ];
      const cp = snapshotToReplayCheckpoint(
        engine.seekTo({ day: Number(dayText), slot }),
      );
      return lite ? slimCheckpoint(cp) : cp;
    });

  const story = normalizeStory(
    readJsonIfExists(join(options.runsRoot, options.runId, "demo_report.json")),
  );
  const initialState = initialReplayState(
    options.dataDir,
    allLogs[0]!.simTime,
    checkpoints[0] ? Object.keys(checkpoints[0].agents) : undefined,
  );
  if (lite) {
    for (const id of Object.keys(initialState.agents)) {
      initialState.agents[id] = slimAgentForExport(initialState.agents[id]!);
    }
  }

  const stepsFull = buildSemanticSteps(allLogs, initialState.agents, story);
  // Lite: keep narrative/gift/dialogue steps; drop high-volume PET/system noise.
  const steps = lite
    ? stepsFull.filter((step) =>
        [
          "intro",
          "time",
          "event",
          "dialogue_start",
          "dialogue_message",
          "dialogue_result",
          "gift",
          "event_result",
          "checkpoint",
          "intent",
        ].includes(step.kind),
      )
    : stepsFull;

  // Lite: only embed gift/relation/dialogue/economy logs (not full 80k-line PET stream).
  const logs = lite
    ? allLogs.filter((log) => ESSENTIAL_LOG_TYPES.has(log.type))
    : allLogs;

  const metricsValue = readJsonIfExists(
    join(options.runsRoot, options.runId, "metrics.json"),
  );
  const metrics =
    metricsValue && typeof metricsValue === "object" && !Array.isArray(metricsValue)
      ? (metricsValue as Record<string, unknown>)
      : null;

  return {
    schemaVersion: 1,
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    initialState,
    checkpoints,
    logs,
    steps,
    conversations: loadConversations(
      join(options.runsRoot, options.runId),
      checkpoints,
      engine,
      lite,
    ),
    story,
    metrics,
  };
}
