/**
 * Export one run into the static, semantic replay package consumed by the Pixi frontend.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listRunIds } from "../store/replay_engine.js";
import { buildFrontendReplayData } from "./frontend_replay_data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");
const runsRoot = join(projectRoot, "sim/data/runs");
const outDir = join(projectRoot, "sim/frontend/game/public");
const outPath = join(outDir, "replay_data.json");

function resolveRunId(): string {
  const requested = process.env.RUN_ID?.trim();
  if (requested) {
    const namedPath = join(runsRoot, "NAMED_RUNS.json");
    if (existsSync(namedPath)) {
      const named = JSON.parse(readFileSync(namedPath, "utf8")) as Record<
        string,
        { runId?: string }
      >;
      if (named[requested]?.runId) return named[requested]!.runId!;
    }
    // Accept directory name directly (including junctions like test1).
    if (existsSync(join(runsRoot, requested))) return requested;
    return requested;
  }
  for (const ptr of [
    "LATEST_TEST1.txt",
    "LATEST_DEMO_RUN.txt",
    "LATEST_GOLD_RUN.txt",
    "LATEST_P5_RUN.txt",
    "LATEST_P3_RUN.txt",
    "LATEST_P2_RUN.txt",
    "LATEST_SEED_RUN.txt",
  ]) {
    const latest = join(runsRoot, ptr);
    if (existsSync(latest)) return readFileSync(latest, "utf8").trim();
  }
  const ids = listRunIds(runsRoot).filter(
    (id) =>
      id.startsWith("p5_") ||
      id.startsWith("verify_p5_") ||
      id.startsWith("demo_") ||
      id.startsWith("seed_") ||
      id.startsWith("p3_") ||
      id.startsWith("verify_p3_"),
  );
  if (!ids.length) throw new Error("No run found. Run: npm run sim:run");
  return ids[ids.length - 1]!;
}

function main(): void {
  const runId = resolveRunId();
  const payload = buildFrontendReplayData({ runId, runsRoot, dataDir });
  mkdirSync(outDir, { recursive: true });
  // Compact JSON — pretty-print blows past V8 string limits on 100-agent runs.
  const pretty = process.env.EXPORT_PRETTY === "1";
  writeFileSync(
    outPath,
    pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload),
    "utf8",
  );
  const agentN = payload.checkpoints[0]
    ? Object.keys(payload.checkpoints[0].agents).length
    : Object.keys(payload.initialState.agents).length;
  console.log(
    `Wrote ${outPath} (${payload.steps.length} steps, ${payload.checkpoints.length} checkpoints, agents=${agentN}, run=${runId})`,
  );
  console.log(
    `Dialogue messages=${payload.steps.filter((step) => step.kind === "dialogue_message").length}; events=${payload.steps.filter((step) => step.kind === "event").length}; logs=${payload.logs.length}`,
  );
  if (payload.story) console.log("Embedded demo_report.json story acts for UI");
  if (payload.metrics) console.log("Embedded metrics.json for UI");
}

main();
