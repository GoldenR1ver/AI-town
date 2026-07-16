import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyReplayLogs,
  cloneReplayState,
} from "../../shared/replay/reducer.js";
import type {
  ReplayCheckpoint,
  ReplayWorldState,
} from "../../shared/replay/types.js";
import type { RelationshipEdge } from "../../shared/types/index.js";
import { buildFrontendReplayData } from "./frontend_replay_data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");
const runsRoot = join(dataDir, "runs");

function resolveRunId(): string {
  if (process.env.RUN_ID) return process.env.RUN_ID;
  for (const pointer of [
    "LATEST_DEMO_RUN.txt",
    "LATEST_GOLD_RUN.txt",
    "LATEST_P5_RUN.txt",
  ]) {
    const path = join(runsRoot, pointer);
    if (existsSync(path)) return readFileSync(path, "utf8").trim();
  }
  throw new Error("No replay run pointer found");
}

function near(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-7,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function edgeMap(edges: RelationshipEdge[]): Map<string, RelationshipEdge> {
  return new Map(edges.map((edge) => [`${edge.from}->${edge.to}`, edge]));
}

function compareCheckpointState(
  actual: ReplayWorldState,
  expected: ReplayCheckpoint,
): void {
  assert.deepEqual(
    Object.keys(actual.agents).sort(),
    Object.keys(expected.agents).sort(),
    `${expected.key}: agent ids`,
  );

  for (const [agentId, expectedAgent] of Object.entries(expected.agents)) {
    const actualAgent = actual.agents[agentId];
    assert.ok(actualAgent, `${expected.key}: missing agent ${agentId}`);
    near(actualAgent.economy.cash, expectedAgent.economy.cash, `${expected.key} ${agentId} cash`);
    near(
      actualAgent.public.face ?? 50,
      expectedAgent.public.face ?? 50,
      `${expected.key} ${agentId} face`,
    );
    near(
      actualAgent.public.prestige ?? actualAgent.public.face ?? 50,
      expectedAgent.public.prestige ?? expectedAgent.public.face ?? 50,
      `${expected.key} ${agentId} prestige`,
    );
    assert.deepEqual(
      actualAgent.private.beliefs,
      expectedAgent.private.beliefs,
      `${expected.key} ${agentId} beliefs`,
    );
    assert.deepEqual(
      actualAgent.private.desires,
      expectedAgent.private.desires,
      `${expected.key} ${agentId} desires`,
    );
    for (const emotionKey of ["mood", "arousal", "stress", "energy"] as const) {
      near(
        actualAgent.private.emotion[emotionKey],
        expectedAgent.private.emotion[emotionKey],
        `${expected.key} ${agentId} emotion.${emotionKey}`,
      );
    }
    assert.deepEqual(
      Object.keys(actualAgent.private.intentions).sort(),
      Object.keys(expectedAgent.private.intentions).sort(),
      `${expected.key} ${agentId} intention keys`,
    );
    for (const [key, expectedIntention] of Object.entries(
      expectedAgent.private.intentions,
    )) {
      const actualIntention = actualAgent.private.intentions[key];
      assert.ok(actualIntention, `${expected.key} ${agentId} missing intention ${key}`);
      assert.equal(
        actualIntention.actionType,
        expectedIntention.actionType,
        `${expected.key} ${agentId} ${key} actionType`,
      );
      assert.equal(
        actualIntention.priority,
        expectedIntention.priority,
        `${expected.key} ${agentId} ${key} priority`,
      );
    }
  }

  const actualEdges = edgeMap(actual.relationships);
  const expectedEdges = edgeMap(expected.relationships);
  assert.deepEqual(
    [...actualEdges.keys()].sort(),
    [...expectedEdges.keys()].sort(),
    `${expected.key}: relationship keys`,
  );
  for (const [key, expectedEdge] of expectedEdges) {
    const actualEdge = actualEdges.get(key)!;
    for (const metric of [
      "trust",
      "affection",
      "intimacy",
      "giftDebt",
      "reciprocityScore",
    ] as const) {
      near(actualEdge[metric], expectedEdge[metric], `${expected.key} ${key} ${metric}`);
    }
  }

  const actualGifts = new Map(actual.giftLedger.map((gift) => [gift.gid, gift]));
  const expectedGifts = new Map(expected.giftLedger.map((gift) => [gift.gid, gift]));
  assert.deepEqual(
    [...actualGifts.keys()].sort(),
    [...expectedGifts.keys()].sort(),
    `${expected.key}: gift ids`,
  );
  for (const [gid, expectedGift] of expectedGifts) {
    const actualGift = actualGifts.get(gid)!;
    assert.equal(actualGift.status, expectedGift.status, `${expected.key} ${gid} status`);
    near(actualGift.value, expectedGift.value, `${expected.key} ${gid} value`);
  }
}

function main(): void {
  const runId = resolveRunId();
  const data = buildFrontendReplayData({ runId, runsRoot, dataDir });
  assert.ok(data.steps.length > 0, "semantic steps should not be empty");
  assert.ok(data.checkpoints.length > 0, "checkpoints should not be empty");

  data.steps.forEach((step, index) => {
    assert.equal(step.index, index, `step index ${index}`);
    assert.ok(step.seqStart <= step.seqEnd, `${step.id}: invalid seq range`);
    if (index > 0) {
      assert.ok(
        data.steps[index - 1]!.seqEnd < step.seqStart,
        `${step.id}: semantic steps overlap or are out of order`,
      );
    }
  });

  const messageLogs = data.logs.filter((log) => log.type === "dialogue.message");
  const messageSteps = data.steps.filter((step) => step.kind === "dialogue_message");
  assert.equal(messageSteps.length, messageLogs.length, "one step per dialogue.message");
  assert.deepEqual(
    messageSteps.flatMap((step) => step.logSeqs),
    messageLogs.map((log) => log.seq),
    "dialogue.message order",
  );

  const eventLogs = data.logs.filter((log) => log.type === "event.created");
  const eventSteps = data.steps.filter((step) => step.kind === "event");
  assert.equal(eventSteps.length, eventLogs.length, "one semantic step per event");

  const representedSeqs = data.steps.flatMap((step) => step.logSeqs);
  assert.deepEqual(
    representedSeqs,
    data.logs.map((log) => log.seq),
    "every log must appear exactly once and in order",
  );

  let base = cloneReplayState(data.initialState);
  for (const checkpoint of data.checkpoints) {
    const logs = data.logs.filter(
      (log) => log.seq > base.seq && log.seq <= checkpoint.seq,
    );
    const reconstructed = applyReplayLogs(base, logs);
    compareCheckpointState(reconstructed, checkpoint);
    base = cloneReplayState(checkpoint);
  }

  console.log(
    `verify:frontend PASS run=${runId} steps=${data.steps.length} messages=${messageSteps.length} checkpoints=${data.checkpoints.length}`,
  );
}

main();
