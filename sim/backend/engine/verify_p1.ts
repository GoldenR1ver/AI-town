/**
 * Phase 1 acceptance — event pipeline + PET/BDI + gift via events.
 * Usage: npm run verify:p1
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { LogEntry, WorldSnapshot } from "../../shared/types/index.js";
import { EventTemplateLibrary } from "../systems/event/library.js";
import { RoleResolver } from "../systems/event/resolver.js";
import { createRng } from "../systems/event/rng.js";
import { WorldState } from "../store/world_state.js";
import { loadAgents } from "../systems/person/loader.js";
import { ReplayEngine } from "../store/replay_engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../..");
const dataDir = join(projectRoot, "sim/data");

interface Check { id: string; ok: boolean; detail: string }
const checks: Check[] = [];
function pass(id: string, detail: string) { checks.push({ id, ok: true, detail }); }
function fail(id: string, detail: string) { checks.push({ id, ok: false, detail }); }

function main(): void {
  const lib = new EventTemplateLibrary();
  lib.loadFromDir(join(dataDir, "event_templates"));
  if (lib.get("private.wedding") && lib.get("public.road_maintenance")) {
    pass("P1-01.library", "wedding + road_maintenance loaded");
  } else fail("P1-01.library", "missing core templates");

  // RoleResolver unit: kinship + tag_match + neighbor
  const world = new WorldState({
    runId: "tmp",
    name: "tmp",
    startDay: 1,
    endDay: 1,
    seed: 1,
    enableReciprocityRules: true,
    enableGiftMemory: true,
    enableScheduledEvents: true,
    llmMode: "mock",
  });
  world.agents = loadAgents(join(dataDir, "agents.json"));
  world.relationships = (
    JSON.parse(readFileSync(join(dataDir, "relationships.json"), "utf8")) as {
      relationships: WorldState["relationships"];
    }
  ).relationships;

  const resolver = new RoleResolver();
  const wedding = lib.get("private.wedding")!;
  const resolved = resolver.resolveAll(world, wedding.roleSlots, {
    time: { day: 1, slot: "AM" },
    rng: createRng(7),
  });
  if (!resolved.error && (resolved.bindings.host?.length ?? 0) === 1 && (resolved.bindings.kin?.length ?? 0) >= 1) {
    pass("P1-02.resolver", `host=${resolved.bindings.host} kin=${resolved.bindings.kin?.length} guests=${resolved.bindings.guests?.length}`);
  } else fail("P1-02.resolver", resolved.error ?? "bindings incomplete");

  const runId = `verify_p1_${Date.now()}`;
  const r = spawnSync("npm", ["run", "sim:p1"], {
    cwd: projectRoot,
    env: { ...process.env, RUN_ID: runId, END_SLOTS: "6", LLM_MODE: "mock", SEED: "42" },
    encoding: "utf8",
    shell: true,
  });
  if (r.status === 0) pass("P1.run", runId);
  else {
    fail("P1.run", (r.stderr || r.stdout).slice(0, 800));
    print();
    process.exit(1);
  }

  const runDir = join(dataDir, "runs", runId);
  if (!existsSync(join(runDir, "event_log.jsonl"))) {
    fail("P1.log", "missing log");
    print();
    process.exit(1);
  }

  const logs = readFileSync(join(runDir, "event_log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);
  const types = new Set(logs.map((e) => e.type));

  for (const t of [
    "event.created",
    "event.propagated",
    "event.completed",
    "bdi.updated",
    "gift.given",
    "relationship.delta",
  ] as const) {
    if (types.has(t)) pass(`P1.log.${t}`, "present");
    else fail(`P1.log.${t}`, "missing");
  }

  // defaulted and/or replied expected in 6-slot wedding+instrumental+repay
  if (types.has("gift.defaulted") || types.has("gift.replied")) {
    pass("P1.giftLifecycle", `defaulted=${types.has("gift.defaulted")} replied=${types.has("gift.replied")}`);
  } else fail("P1.giftLifecycle", "neither defaulted nor replied");

  const engine = new ReplayEngine();
  engine.loadExperiment(runId, join(dataDir, "runs"));
  const d1am = engine.seekTo({ day: 1, slot: "AM" });
  if (d1am.giftLedger.length >= 1) pass("P1-09.giftsViaEvent", `D1-AM gifts=${d1am.giftLedger.length}`);
  else fail("P1-09.giftsViaEvent", "no gifts after wedding slot");

  const petAgents = Object.values(d1am.personalEventTables).filter((t) => t.length > 0).length;
  if (petAgents >= 2) pass("P1-07.pet", `agents with PET=${petAgents}`);
  else fail("P1-07.pet", `PET sparse: ${petAgents}`);

  const beliefHit = Object.values(d1am.agents).some((a) =>
    Object.keys(a.private.beliefs).some((k) => k.startsWith("event:")),
  );
  if (beliefHit) pass("P1-08.belief", "event:* belief present");
  else fail("P1-08.belief", "no belief sync");

  // conflict: enqueue two required events for same leader in one slot — unit style via log optional
  const completed = logs.filter((e) => e.type === "event.completed").length;
  if (completed >= 2) pass("P1-06.pipeline", `completed=${completed}`);
  else fail("P1-06.pipeline", `completed=${completed}`);

  const endSnap = JSON.parse(
    readFileSync(join(runDir, "snapshots", "D2-EVE.json"), "utf8"),
  ) as WorldSnapshot;
  if (endSnap.metrics.eventsCreated >= 2) {
    pass("P1.metrics", JSON.stringify(endSnap.metrics));
  } else fail("P1.metrics", JSON.stringify(endSnap.metrics));

  print();
  if (checks.some((c) => !c.ok)) process.exit(1);
  console.log(`\nP1 PASSED. Inspect: ${runDir}`);
}

function print() {
  console.log("\n=== P1 verify ===");
  for (const c of checks) console.log(`${c.ok ? "OK" : "FAIL"}  ${c.id} — ${c.detail}`);
}

main();
