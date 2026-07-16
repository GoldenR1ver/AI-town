/**
 * Complex narrative demo — gift flow / relations / cognitive tree across ~5 days.
 *
 * Story arc:
 *   D1-AM  赵家婚礼：多宾客随礼 + 双人/主持人对话 + R5 声望
 *   D1-PM  邻里冲突调解（主持人模式）
 *   D1-EVE 周强→钱大伟 工具性送礼
 *   D2-AM  道路养护公共事务 + 居民群聊
 *   D2-PM  钱大伟回礼周强（互惠闭环）
 *   D2-EVE 郑浩短窗送礼给吴芳（故意不还 → 违约）
 *   D3-AM  卫生宣传 + 二次对话加深认知树
 *   D3-PM  赵建国对部分礼债回礼；其余进入窗检
 *   D4-AM  窗检结算违约；收束快照
 *
 * Usage:
 *   npm run sim:demo
 *   DEMO_LLM_MODE=live npm run sim:demo
 *   npm run demo          # run + export frontend
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  EventInstance,
  ExperimentConfig,
  RelationshipEdge,
  SimTime,
} from "../../shared/types/index.js";
import { nextSimTime, simTimeKey } from "../../shared/types/index.js";
import { createLlmClient, describeLlmClient } from "../llm/client.js";
import { loadAgents } from "../systems/person/loader.js";
import { PersonalEventTableManager } from "../systems/event/pet.js";
import {
  ConversationTable,
  DialogueController,
  KnowledgeBase,
} from "../systems/dialogue/index.js";
import { listActionableIntentions } from "../cognition/bdi.js";
import { Experiment } from "./experiment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

interface Beat {
  act: number;
  title: string;
  time: SimTime;
  notes: string[];
}

function loadEdges(path: string): RelationshipEdge[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { relationships: RelationshipEdge[] })
    .relationships;
}

function advanceTo(from: SimTime, target: SimTime): SimTime {
  let t = { ...from };
  let guard = 0;
  while ((t.day !== target.day || t.slot !== target.slot) && guard++ < 40) {
    t = nextSimTime(t);
  }
  return t;
}

async function main(): Promise<void> {
  const runId = process.env.RUN_ID ?? `demo_${Date.now()}`;
  const llm = createLlmClient(
    (process.env.DEMO_LLM_MODE as "mock" | "live" | "auto" | undefined) ?? "mock",
  );
  const config: ExperimentConfig = {
    runId,
    name: "complex-gift-flow-demo",
    startDay: 1,
    endDay: 4,
    seed: Number(process.env.SEED ?? 7),
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    llmMode: llm.mode,
  };

  const runDir = join(dataDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "config.json"),
    JSON.stringify({ ...config, llm: describeLlmClient(llm), script: "run_demo.ts" }, null, 2),
    "utf8",
  );

  const exp = new Experiment(config, {
    runDir,
    templatesDir: join(dataDir, "event_templates"),
  });
  exp.world.agents = loadAgents(join(dataDir, "agents.json"));
  exp.world.relationships = loadEdges(join(dataDir, "relationships.json"));
  for (const id of Object.keys(exp.world.agents)) {
    exp.world.personalEventTables[id] = [];
    exp.world.cognitiveTrees[id] = [];
  }

  const pet = new PersonalEventTableManager(exp.log);
  const knowledge = new KnowledgeBase();
  knowledge.load(join(dataDir, "knowledge", "gift_norms.json"));
  const table = new ConversationTable(join(runDir, "conversation_table.jsonl"));
  const dialogue = new DialogueController(llm, exp.rules, knowledge, table, exp.log);

  const beats: Beat[] = [];
  let time: SimTime = { day: 1, slot: "AM" };
  const prestige0 = exp.world.agents.a01!.public.prestige ?? 0;

  exp.log.append(time, "experiment.start", {
    config,
    llm: describeLlmClient(llm),
    phase: "demo",
    story: "赵家婚礼 → 调解 → 工具礼 → 公共事务 → 回礼/违约 → 认知树上呈",
  });

  // ─── helpers ───────────────────────────────────────────────
  const beginSlot = (t: SimTime, act: number, title: string): Beat => {
    exp.log.append(t, "timeslot.start", { day: t.day, slot: t.slot, act, title });
    const beat: Beat = { act, title, time: { ...t }, notes: [] };
    beats.push(beat);
    console.log(`\n[Act ${act}] ${simTimeKey(t)} · ${title}`);
    return beat;
  };

  const endSlot = (t: SimTime, beat: Beat): void => {
    const snap = exp.world.snapshot(t, exp.log.nextSeq());
    exp.snapshots.write(snap);
    exp.log.append(
      t,
      "timeslot.end",
      { snapshotId: snap.snapshotId, act: beat.act, title: beat.title, notes: beat.notes },
      { snapshotId: snap.snapshotId },
    );
  };

  const makeEvent = (
    templateId: string,
    t: SimTime,
    opts: {
      roleOverrides?: Record<string, string[]>;
      payload?: Record<string, unknown>;
      sourceAgentId?: string;
    },
  ): EventInstance => {
    const ev = exp.generator.generateManual(exp.world, templateId, t, exp.rng, opts);
    if (!ev) throw new Error(`failed to generate ${templateId}`);
    exp.world.eventQueue.push(ev);
    return ev;
  };

  const prepKnowledge = (ev: EventInstance): string[] => {
    const affected = pet.propagate(exp.world, time, ev);
    pet.syncBeliefs(exp.world, time, affected);
    return affected;
  };

  // ─── Act 1: Wedding ────────────────────────────────────────
  {
    const beat = beginSlot(time, 1, "赵家婚礼：随礼、对话与声望");
    const wedding = makeEvent("private.wedding", time, {
      roleOverrides: {
        host: ["a01"],
        kin: ["a02", "a03"],
        guests: ["a04", "a05", "a06", "a10"],
      },
      payload: { occasion: "wedding", minGiftNorm: 200, replyWindowSlots: 6 },
      sourceAgentId: "a01",
    });
    prepKnowledge(wedding);
    beat.notes.push(`wedding eid=${wedding.eid} guests=a04,a05,a06,a10`);

    await dialogue.run({
      world: exp.world,
      event: wedding,
      time,
      participants: ["a01", "a04"],
      mode: "dialogue",
      minTurns: 6,
      maxTurns: 6,
    });
    beat.notes.push("dialogue a01↔a04 (6 turns)");

    await dialogue.run({
      world: exp.world,
      event: wedding,
      time,
      participants: ["a01", "a02", "a04", "a10"],
      mode: "host",
      minTurns: 5,
      maxTurns: 6,
    });
    beat.notes.push("host dialogue with kin+broker");

    await dialogue.run({
      world: exp.world,
      event: wedding,
      time,
      participants: ["a04", "a05", "a06"],
      mode: "random",
      minTurns: 4,
      maxTurns: 5,
    });
    beat.notes.push("guest random chatter");

    exp.pipeline.process(exp.world, time, wedding);
    wedding.status = "completed";
    exp.world.metrics.eventsCompleted += 1;
    const prestige1 = exp.world.agents.a01!.public.prestige ?? 0;
    beat.notes.push(
      `gifts=${exp.world.giftLedger.length} hostPrestige ${prestige0}→${prestige1}`,
    );
    endSlot(time, beat);
  }

  // ─── Act 2: Conflict mediation ─────────────────────────────
  time = nextSimTime(time);
  {
    const beat = beginSlot(time, 2, "邻里冲突调解");
    const mediation = makeEvent("public.conflict_mediation", time, {
      roleOverrides: {
        initiator: ["a01"],
        parties: ["a04", "a09"],
      },
      sourceAgentId: "a01",
    });
    prepKnowledge(mediation);

    await dialogue.run({
      world: exp.world,
      event: mediation,
      time,
      participants: ["a01", "a04", "a09"],
      mode: "host",
      minTurns: 6,
      maxTurns: 6,
    });
    beat.notes.push("host mediation a01/a04/a09");

    exp.pipeline.process(exp.world, time, mediation);
    mediation.status = "completed";
    exp.world.metrics.eventsCompleted += 1;
    endSlot(time, beat);
  }

  // ─── Act 3: Instrumental gift ──────────────────────────────
  time = nextSimTime(time);
  {
    const beat = beginSlot(time, 3, "工具性送礼：周强→钱大伟");
    const gift = makeEvent("private.instrumental_gift", time, {
      roleOverrides: { initiator: ["a06"], receiver: ["a04"] },
      payload: { occasion: "instrumental", replyWindowSlots: 4 },
      sourceAgentId: "a06",
    });
    prepKnowledge(gift);

    await dialogue.run({
      world: exp.world,
      event: gift,
      time,
      participants: ["a06", "a04"],
      mode: "dialogue",
      minTurns: 4,
      maxTurns: 5,
    });
    beat.notes.push("instrumental dialogue a06→a04");

    exp.pipeline.process(exp.world, time, gift);
    gift.status = "completed";
    exp.world.metrics.eventsCompleted += 1;
    const open = exp.world.giftLedger.filter((g) => g.status === "pending_reply");
    beat.notes.push(`pending debts=${open.length}`);
    endSlot(time, beat);
  }

  // ─── Act 4: Road maintenance ───────────────────────────────
  time = nextSimTime(time); // D2-AM
  {
    const beat = beginSlot(time, 4, "道路养护：公共捐款与群聊");
    const road = makeEvent("public.road_maintenance", time, {
      roleOverrides: {
        initiator: ["a01"],
        affected_residents: ["a02", "a04", "a05", "a07", "a09"],
      },
      sourceAgentId: "a01",
    });
    prepKnowledge(road);

    await dialogue.run({
      world: exp.world,
      event: road,
      time,
      participants: ["a01", "a02", "a07", "a09"],
      mode: "random",
      minTurns: 5,
      maxTurns: 6,
    });
    beat.notes.push("community random talk on road fund");

    exp.pipeline.process(exp.world, time, road);
    road.status = "completed";
    exp.world.metrics.eventsCompleted += 1;
    beat.notes.push(`donations/gifts total=${exp.world.giftLedger.length}`);
    endSlot(time, beat);
  }

  // ─── Act 5: Repay instrumental gift ────────────────────────
  time = nextSimTime(time); // D2-PM
  {
    const beat = beginSlot(time, 5, "互惠闭环：钱大伟回礼周强");
    const repay = makeEvent("private.repay_gift", time, {
      roleOverrides: { debtor: ["a04"], creditor: ["a06"] },
      sourceAgentId: "a04",
    });
    prepKnowledge(repay);

    await dialogue.run({
      world: exp.world,
      event: repay,
      time,
      participants: ["a04", "a06"],
      mode: "dialogue",
      minTurns: 4,
      maxTurns: 4,
    });
    beat.notes.push("repay dialogue a04→a06");

    exp.pipeline.process(exp.world, time, repay);
    repay.status = "completed";
    exp.world.metrics.eventsCompleted += 1;
    beat.notes.push(`giftReplied=${exp.world.metrics.giftReplied}`);
    endSlot(time, beat);
  }

  // ─── Act 6: Short-window gift that will default ────────────
  time = nextSimTime(time); // D2-EVE
  {
    const beat = beginSlot(time, 6, "短窗送礼：郑浩→吴芳（将违约）");
    const r = exp.rules.commit(exp.world, time, {
      kind: "give_gift",
      from: "a08",
      to: "a07",
      value: 150,
      expressiveScore: 0.35,
      description: "demo short-window gift (will default)",
      replyWindowSlots: 2,
      occasion: undefined,
    });
    if (!r.ok) throw new Error(`short gift failed: ${r.reason}`);
    beat.notes.push(`probe gift ok; window=2 slots; pending on a07`);

    // Optional thin dialogue so cognitive tree also sees this pair
    const probeEv = makeEvent("private.instrumental_gift", time, {
      roleOverrides: { initiator: ["a08"], receiver: ["a07"] },
      payload: { occasion: "instrumental", replyWindowSlots: 2 },
      sourceAgentId: "a08",
    });
    // Don't double-gift via pipeline — only dialogue + mark event narrative
    prepKnowledge(probeEv);
    await dialogue.run({
      world: exp.world,
      event: probeEv,
      time,
      participants: ["a08", "a07"],
      mode: "dialogue",
      minTurns: 4,
      maxTurns: 4,
    });
    // Skip pipeline gifts for probeEv (already committed manually); just complete goals as waived
    for (const g of probeEv.goals) g.status = "waived";
    probeEv.status = "completed";
    exp.world.metrics.eventsCompleted += 1;
    beat.notes.push("dialogue a08↔a07 without second gift settlement");
    endSlot(time, beat);
  }

  // ─── Act 7: Health campaign + deepen cognition ─────────────
  time = nextSimTime(time); // D3-AM
  {
    const beat = beginSlot(time, 7, "卫生宣传 + 认知树加深（婚礼对谈复盘）");
    const health = makeEvent("public.health_campaign", time, {
      roleOverrides: {
        initiator: ["a07"],
        affected_residents: ["a01", "a03", "a05", "a08"],
      },
      sourceAgentId: "a07",
    });
    prepKnowledge(health);

    await dialogue.run({
      world: exp.world,
      event: health,
      time,
      participants: ["a07", "a01", "a05"],
      mode: "host",
      minTurns: 5,
      maxTurns: 5,
    });
    beat.notes.push("health host talk");

    // Re-engage wedding pair to push more influence into cognitive tree
    await dialogue.run({
      world: exp.world,
      event: health,
      time,
      participants: ["a01", "a04"],
      mode: "dialogue",
      minTurns: 5,
      maxTurns: 6,
    });
    beat.notes.push("a01↔a04 revisit (cognitive deepen)");

    exp.pipeline.process(exp.world, time, health);
    health.status = "completed";
    exp.world.metrics.eventsCompleted += 1;
    endSlot(time, beat);
  }

  // ─── Act 8: Host repays one wedding gift ───────────────────
  time = nextSimTime(time); // D3-PM
  {
    const beat = beginSlot(time, 8, "主办回礼：赵建国偿还部分礼债");
    const openHost = exp.world.giftLedger.find(
      (g) => g.to === "a01" && g.from === "a04" && g.status === "pending_reply",
    );
    if (openHost) {
      const repay = makeEvent("private.repay_gift", time, {
        roleOverrides: { debtor: ["a01"], creditor: ["a04"] },
        payload: { minAdjustedValue: openHost.adjustedValue },
        sourceAgentId: "a01",
      });
      prepKnowledge(repay);
      await dialogue.run({
        world: exp.world,
        event: repay,
        time,
        participants: ["a01", "a04"],
        mode: "dialogue",
        minTurns: 4,
        maxTurns: 4,
      });
      exp.pipeline.process(exp.world, time, repay);
      repay.status = "completed";
      exp.world.metrics.eventsCompleted += 1;
      beat.notes.push(`repaid ${openHost.gid} to a04`);
    } else {
      beat.notes.push("no pending a04→a01 gift to repay (skipped)");
    }

    const intentions = listActionableIntentions(exp.world.agents.a01!.private, time);
    beat.notes.push(`a01 actionable intentions=${intentions.length}`);
    endSlot(time, beat);
  }

  // ─── Act 9: Advance + window checks (defaults) ─────────────
  // Need to be strictly after short-window gift (D2-EVE + 2 = D3-PM end).
  // Advance to D4-AM for clear default of a08→a07 and any expired wedding windows.
  time = advanceTo(time, { day: 4, slot: "AM" });
  {
    const beat = beginSlot(time, 9, "窗检结算：违约落地");
    // Fill intermediate empty slots with start/end so replay timeline is continuous
    // (already jumped; write sparse markers only at D4-AM)
    const beforeDefault = exp.world.metrics.giftDefaulted;
    exp.rules.commit(exp.world, time, { kind: "gift_window_check" });
    const newly = exp.world.metrics.giftDefaulted - beforeDefault;
    beat.notes.push(`newly defaulted=${newly} totalDefaulted=${exp.world.metrics.giftDefaulted}`);
    endSlot(time, beat);
  }

  // ─── Act 10: Closing summary slot ──────────────────────────
  time = nextSimTime(time); // D4-PM
  {
    const beat = beginSlot(time, 10, "收束：指标与认知树快照");
    const prestigeEnd = exp.world.agents.a01!.public.prestige ?? 0;
    const trees = Object.entries(exp.world.cognitiveTrees).map(([id, nodes]) => ({
      id,
      name: exp.world.agents[id]?.public.name,
      dialogue: nodes.filter((n) => n.layer === "dialogue" && !n.archived).length,
      relation: nodes.filter((n) => n.layer === "relation" && !n.archived).length,
      archived: nodes.filter((n) => n.archived).length,
    }));
    const topEdges = [...exp.world.relationships]
      .sort((a, b) => b.trust + b.intimacy - (a.trust + a.intimacy))
      .slice(0, 8)
      .map(
        (e) =>
          `${e.from}→${e.to} trust=${e.trust.toFixed(0)} intimacy=${e.intimacy.toFixed(0)} debt=${e.giftDebt.toFixed(0)}`,
      );

    beat.notes.push(
      `conversations=${exp.world.conversations.length}`,
      `cognitivePromotions=${exp.world.metrics.cognitivePromotions}`,
      `gifts=${exp.world.giftLedger.length} replied=${exp.world.metrics.giftReplied} defaulted=${exp.world.metrics.giftDefaulted}`,
      `hostPrestige ${prestige0}→${prestigeEnd}`,
    );
    endSlot(time, beat);

    const report = {
      runId,
      title: "礼物的流动 · 复杂叙事 Demo",
      llm: describeLlmClient(llm),
      acts: beats,
      metrics: exp.world.metrics,
      hostPrestige: { before: prestige0, after: prestigeEnd },
      giftLedger: exp.world.giftLedger.map((g) => ({
        gid: g.gid,
        from: g.from,
        to: g.to,
        value: g.value,
        status: g.status,
        occasion: g.occasion,
      })),
      cognitiveTrees: trees,
      topEdges,
      howToView: [
        "npm run frontend:export  # uses LATEST_DEMO_RUN",
        "npm run frontend:serve",
        `inspect runDir: ${runDir}`,
      ],
    };

    writeFileSync(join(runDir, "demo_report.json"), JSON.stringify(report, null, 2), "utf8");
    writeFileSync(
      join(runDir, "DEMO_STORY.md"),
      renderStoryMd(report),
      "utf8",
    );
  }

  exp.log.append(time, "experiment.end", {
    metrics: exp.world.metrics,
    acts: beats.length,
    conversations: exp.world.conversations.length,
    cognitivePromotions: exp.world.metrics.cognitivePromotions,
  });

  writeFileSync(join(dataDir, "runs", "LATEST_DEMO_RUN.txt"), runId, "utf8");
  writeFileSync(join(dataDir, "runs", "LATEST_P3_RUN.txt"), runId, "utf8");

  console.log("\n======== DEMO COMPLETE ========");
  console.log(`runDir: ${runDir}`);
  console.log(`acts=${beats.length} conversations=${exp.world.conversations.length}`);
  console.log(
    `gifts=${exp.world.giftLedger.length} replied=${exp.world.metrics.giftReplied} defaulted=${exp.world.metrics.giftDefaulted}`,
  );
  console.log(`cognitivePromotions=${exp.world.metrics.cognitivePromotions}`);
  console.log(
    `hostPrestige ${prestige0}→${exp.world.agents.a01!.public.prestige}`,
  );
  console.log(`report: ${join(runDir, "demo_report.json")}`);
  console.log(`story:  ${join(runDir, "DEMO_STORY.md")}`);
  console.log(`RUN_ID=${runId}`);
  console.log("Next: npm run frontend:export && npm run frontend:serve");
}

function renderStoryMd(report: {
  runId: string;
  title: string;
  acts: Beat[];
  metrics: Record<string, number> | object;
  hostPrestige: { before: number; after: number };
  giftLedger: Array<{ gid: string; from: string; to: string; value: number; status: string; occasion?: string }>;
  cognitiveTrees: Array<{ id: string; name?: string; dialogue: number; relation: number; archived: number }>;
  topEdges: string[];
}): string {
  const lines: string[] = [
    `# ${report.title}`,
    "",
    `runId: \`${report.runId}\``,
    "",
    "## 剧情节拍",
    "",
  ];
  for (const a of report.acts) {
    lines.push(`### Act ${a.act} · ${simTimeKey(a.time)} · ${a.title}`);
    for (const n of a.notes) lines.push(`- ${n}`);
    lines.push("");
  }
  lines.push("## 指标");
  lines.push("```");
  lines.push(JSON.stringify(report.metrics, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`主办声望: ${report.hostPrestige.before} → ${report.hostPrestige.after}`);
  lines.push("");
  lines.push("## 礼单");
  lines.push("");
  for (const g of report.giftLedger) {
    lines.push(
      `- \`${g.gid}\` ${g.from}→${g.to} ¥${g.value} [${g.status}] ${g.occasion ?? ""}`,
    );
  }
  lines.push("");
  lines.push("## 认知树（活跃层计数）");
  lines.push("");
  for (const t of report.cognitiveTrees.filter((x) => x.dialogue + x.relation + x.archived > 0)) {
    lines.push(
      `- ${t.id} ${t.name ?? ""} · dialogue=${t.dialogue} relation=${t.relation} archived=${t.archived}`,
    );
  }
  lines.push("");
  lines.push("## 关系边 Top");
  lines.push("");
  for (const e of report.topEdges) lines.push(`- ${e}`);
  lines.push("");
  lines.push("## 回放");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run frontend:export");
  lines.push("npm run frontend:serve");
  lines.push("```");
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
