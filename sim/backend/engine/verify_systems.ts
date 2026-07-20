/**
 * Top-down static + runtime audit for the nine core simulation subsystems.
 *
 * Usage: npm run verify:systems
 * Set KEEP_SYSTEM_AUDIT_RUNS=1 to retain verifier-generated run directories.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventInstance, ExperimentConfig, SimTime } from "../../shared/types/index.js";
import { EventScheduler, processQueuedEvents } from "../systems/event/scheduler.js";
import { WorldState } from "../store/world_state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const runsDir = join(projectRoot, "sim/data/runs");

interface CommandResult {
  ok: boolean;
  detail: string;
  stdout: string;
  stderr: string;
}

interface SavedFile {
  path: string;
  existed: boolean;
  content: string;
}

interface SubsystemResult {
  name: string;
  staticOk: boolean;
  runtimeOk: boolean;
  evidence: string;
  note?: string;
}

const POINTER_FILES = [
  "LATEST_CONTRAST.txt",
  "LATEST_DEMO_RUN.txt",
  "LATEST_EMPTY_RUN.txt",
  "LATEST_GOLD_RUN.txt",
  "LATEST_P1_RUN.txt",
  "LATEST_P2_RUN.txt",
  "LATEST_P3_RUN.txt",
  "LATEST_P4_RUN.txt",
  "LATEST_P5_RUN.txt",
  "LATEST_SEED_RUN.txt",
].map((name) => join(runsDir, name));

const GENERATED_FILES = [
  ...POINTER_FILES,
  join(projectRoot, "sim/frontend/game/public/replay_data.json"),
];

const STATIC_FILES: Record<string, string[]> = {
  "事务调度器": [
    "sim/backend/engine/scheduler.ts",
    "sim/backend/systems/event/scheduler.ts",
    "sim/backend/systems/event/pipeline.ts",
  ],
  "个人事件表": ["sim/backend/systems/event/pet.ts", "sim/backend/cognition/bdi.ts"],
  "总对话表": ["sim/backend/systems/dialogue/table.ts"],
  "认知树": ["sim/backend/cognition/cognitive_tree.ts"],
  "个人 BDIE 更新机制": ["sim/backend/cognition/bdi.ts", "sim/backend/rules/rule_engine.ts"],
  "对话生成器": [
    "sim/backend/systems/dialogue/controller.ts",
    "sim/backend/systems/dialogue/prompt.ts",
    "sim/backend/systems/dialogue/summarizer.ts",
  ],
  "关系网更新机制": [
    "sim/backend/systems/relationship/graph.ts",
    "sim/backend/rules/rule_engine.ts",
  ],
  "经济系统": ["sim/backend/systems/economy/manager.ts"],
  "礼物的礼单": ["sim/backend/systems/gift/ledger.ts", "sim/backend/rules/rule_engine.ts"],
};

function saveFiles(paths: string[]): SavedFile[] {
  return paths.map((path) => ({
    path,
    existed: existsSync(path),
    content: existsSync(path) ? readFileSync(path, "utf8") : "",
  }));
}

function restoreFiles(files: SavedFile[]): void {
  for (const file of files) {
    if (file.existed) writeFileSync(file.path, file.content, "utf8");
    else rmSync(file.path, { force: true });
  }
}

function listRunDirs(): Set<string> {
  if (!existsSync(runsDir)) return new Set();
  return new Set(
    readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

function cleanupAuditRuns(before: Set<string>): void {
  if (process.env.KEEP_SYSTEM_AUDIT_RUNS === "1" || !existsSync(runsDir)) return;
  const auditPrefix = /^(verify_p[0-4]|verify_d2)_/;
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || before.has(entry.name) || !auditPrefix.test(entry.name)) continue;
    rmSync(join(runsDir, entry.name), { recursive: true, force: true });
  }
}

function runNpm(script: string): CommandResult {
  const result = spawnSync("npm", ["run", script], {
    cwd: projectRoot,
    env: { ...process.env },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const ok = result.status === 0 && !result.error;
  const lastLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return {
    ok,
    detail: result.error?.message ?? lastLine ?? `exit=${result.status ?? "unknown"}`,
    stdout,
    stderr,
  };
}

function makeConfig(): ExperimentConfig {
  return {
    runId: "verify_systems_unit",
    name: "verify systems unit",
    startDay: 1,
    endDay: 1,
    seed: 1,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: false,
    llmMode: "mock",
  };
}

function makeEvent(eid: string, priority: number, requiredAgentIds: string[]): EventInstance {
  return {
    eid,
    templateId: "unit.scheduler",
    category: "private",
    subType: "unit",
    visibility: "private",
    time: { day: 1, slot: "AM" },
    location: "unit",
    status: "queued",
    roleBindings: {},
    goals: [],
    summary: eid,
    payload: {},
    source: "manual",
    requiredAgentIds,
    priority,
    dialogue: {
      mode: "dialogue",
      minParticipants: 2,
      maxParticipants: 2,
      maxTurns: 4,
      forced: false,
    },
  };
}

async function probeEventScheduler(): Promise<{ ok: boolean; detail: string }> {
  const world = new WorldState(makeConfig());
  const scheduler = new EventScheduler();
  const low = makeEvent("e_low", 1, ["a01"]);
  const high = makeEvent("e_high", 9, ["a02"]);
  const conflict = makeEvent("e_conflict", 5, ["a01"]);

  const acceptedLow = scheduler.enqueue(world, low).accepted;
  const acceptedHigh = scheduler.enqueue(world, high).accepted;
  const conflictResult = scheduler.enqueue(world, conflict);
  const order: string[] = [];
  const time: SimTime = { day: 1, slot: "AM" };
  await processQueuedEvents(scheduler, world, time, (_state, _time, event) => {
    order.push(event.eid);
  });
  const nextSlotAccepted = scheduler.enqueue(
    world,
    makeEvent("e_next_slot", 1, ["a01"]),
  ).accepted;

  const ok =
    acceptedLow &&
    acceptedHigh &&
    !conflictResult.accepted &&
    conflict.status === "rejected" &&
    order.join(",") === "e_high,e_low" &&
    low.status === "completed" &&
    high.status === "completed" &&
    world.metrics.eventsRejected === 1 &&
    world.metrics.eventsCompleted === 2 &&
    nextSlotAccepted;
  return {
    ok,
    detail: ok
      ? "priority 顺序、occupancy 冲突拒绝、串行完成及下一 slot busy reset 均通过"
      : JSON.stringify({
          acceptedLow,
          acceptedHigh,
          conflictAccepted: conflictResult.accepted,
          conflictStatus: conflict.status,
          order,
          eventsRejected: world.metrics.eventsRejected,
          eventsCompleted: world.metrics.eventsCompleted,
          nextSlotAccepted,
        }),
  };
}

function staticFilesOk(name: string): { ok: boolean; detail: string } {
  const files = STATIC_FILES[name] ?? [];
  const missing = files.filter((path) => !existsSync(join(projectRoot, path)));
  return {
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${files.length} 个实现文件存在` : `缺少 ${missing.join(", ")}`,
  };
}

function printCommandFailure(name: string, result: CommandResult): void {
  if (result.ok) return;
  console.error(`\n--- ${name} stdout ---\n${result.stdout.slice(-8000)}`);
  console.error(`\n--- ${name} stderr ---\n${result.stderr.slice(-8000)}`);
}

async function main(): Promise<void> {
  const savedFiles = saveFiles(GENERATED_FILES);
  const beforeRuns = listRunDirs();
  const commands = new Map<string, CommandResult>();
  let schedulerProbe = { ok: false, detail: "未执行" };

  try {
    console.log("[static] npm run typecheck");
    commands.set("typecheck", runNpm("typecheck"));

    console.log("[runtime] EventScheduler unit probe");
    schedulerProbe = await probeEventScheduler();

    for (const script of ["verify:p0", "verify:p1", "verify:p2", "verify:p3", "verify:p4", "verify:d2"]) {
      console.log(`[runtime] npm run ${script}`);
      commands.set(script, runNpm(script));
    }
  } finally {
    restoreFiles(savedFiles);
    cleanupAuditRuns(beforeRuns);
  }

  for (const [name, result] of commands) printCommandFailure(name, result);

  const typecheckOk = commands.get("typecheck")?.ok === true;
  const p0 = commands.get("verify:p0")?.ok === true;
  const p1 = commands.get("verify:p1")?.ok === true;
  const p2 = commands.get("verify:p2")?.ok === true;
  const p3 = commands.get("verify:p3")?.ok === true;
  const p4 = commands.get("verify:p4")?.ok === true;
  const d2 = commands.get("verify:d2")?.ok === true;

  const specs: Array<{
    name: string;
    runtimeOk: boolean;
    evidence: string;
    note?: string;
  }> = [
    {
      name: "事务调度器",
      runtimeOk: schedulerProbe.ok && p0 && p1,
      evidence: `${schedulerProbe.detail}；P0 时钟/快照；P1 事务管线`,
      note: "同优先级的代码注释写“按 deadline”，当前实现实际用 eid 作为 tie-break；仓库 DoD 只要求队列与 occupancy 冲突。",
    },
    {
      name: "个人事件表",
      runtimeOk: p1,
      evidence: "P1 验证 event.propagated、PET 写入、PET → Belief",
    },
    {
      name: "总对话表",
      runtimeOk: p2,
      evidence: "P2 验证 append-only conversation_table、CID 记录、三种 mode、4–8 turns 与 snapshot",
    },
    {
      name: "认知树",
      runtimeOk: p3,
      evidence: "P3 验证 dialogue 节点达到阈值后上呈 relation，并写 cognitive.promoted",
      note: "MVP 仅实现 dialogue → relation；relation → circle 与 circle → social 明确暂缓到 P6。",
    },
    {
      name: "个人 BDIE 更新机制",
      runtimeOk: p1 && p2 && p3,
      evidence: "P1 验证 PET→B、Goals→D/I；P2 验证 dialogue_bdie clamp；P3 验证回礼 Intention",
      note: "对话路径直接更新 B/E；D/I 由事务目标、礼债与违约路径维护，不是一次对话同时改四项。",
    },
    {
      name: "对话生成器",
      runtimeOk: p2,
      evidence: "P2 mock 验证 dialogue/host/random、Prompt、知识库、摘要及 dialogue.start/message/end",
    },
    {
      name: "关系网更新机制",
      runtimeOk: p2 && p3 && p4,
      evidence: "P2 对话通道；P3 对话/送礼/违约三通道；P4 规则公式与现金/礼物联动",
    },
    {
      name: "经济系统",
      runtimeOk: p4 && d2,
      evidence: "P4 月结公式回归；D2 验证经济状态及送礼双边现金转移",
    },
    {
      name: "礼物的礼单",
      runtimeOk: p1 && p4 && d2,
      evidence: "P1 事务触发礼物流；P4 查询/礼种/回礼；D2 pending→replied/defaulted 与 replay",
    },
  ];

  const results: SubsystemResult[] = specs.map((spec) => {
    const source = staticFilesOk(spec.name);
    return {
      name: spec.name,
      staticOk: typecheckOk && source.ok,
      runtimeOk: spec.runtimeOk,
      evidence: `${source.detail}；${spec.evidence}`,
      note: spec.note,
    };
  });

  console.log("\n=== 九层系统静态 + runtime 验收 ===");
  for (const result of results) {
    const ok = result.staticOk && result.runtimeOk;
    console.log(`${ok ? "PASS" : "FAIL"}  ${result.name}`);
    console.log(`      static=${result.staticOk ? "OK" : "FAIL"} runtime=${result.runtimeOk ? "OK" : "FAIL"}`);
    console.log(`      ${result.evidence}`);
    if (result.note) console.log(`      范围说明：${result.note}`);
  }

  const commandSummary = [...commands.entries()]
    .map(([name, result]) => `${name}=${result.ok ? "PASS" : "FAIL"}`)
    .join(" ");
  console.log(`\ncommands: ${commandSummary}`);
  console.log(`generated runs: ${process.env.KEEP_SYSTEM_AUDIT_RUNS === "1" ? "保留" : "已清理"}`);
  console.log("LATEST 指针与 replay_data.json：已恢复");

  if (results.some((result) => !result.staticOk || !result.runtimeOk)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
