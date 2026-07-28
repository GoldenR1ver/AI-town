import { join } from "node:path";
import type { ExperimentConfig, SimTime } from "../../shared/types/index.js";
import { LogWriter } from "../log/log_writer.js";
import { SnapshotStore } from "../store/snapshot_store.js";
import { WorldState } from "../store/world_state.js";
import { RuleEngine } from "../rules/rule_engine.js";
import { createLlmClient, type LlmClient } from "../llm/client.js";
import {
  ConversationTable,
  DialogueController,
  KnowledgeBase,
} from "../systems/dialogue/index.js";
import { TimeScheduler, type SlotHandlers } from "./scheduler.js";
import {
  EventTemplateLibrary,
  EventGenerator,
  EventScheduler,
  EventPipeline,
  processQueuedEvents,
  createRng,
  resetEidCounter,
  generateStateDrivenSocial,
  generateRepayFromDebts,
} from "../systems/event/index.js";

export interface ManualEventSpec {
  templateId: string;
  roleOverrides?: Record<string, string[]>;
  payload?: Record<string, unknown>;
  sourceAgentId?: string;
  /** If set, fire only at this simTime; else fire once on first slot. */
  onlyAt?: SimTime;
  fired?: boolean;
}

export interface ExperimentPaths {
  runDir: string;
  templatesDir: string;
  knowledgePath?: string;
}

export interface ExperimentInit {
  /** Override LLM client (default: mock/live from config.llmMode). */
  llm?: LlmClient;
}

/**
 * Phase 0–5 experiment: clock + event pipeline + (optional) dialogue + rules + logs/snapshots.
 * Single slot order (plan.md §5): month → generate → process(dialogue→PET→goals→rules) → gift window → snapshot.
 */
export class Experiment {
  readonly world: WorldState;
  readonly log: LogWriter;
  readonly snapshots: SnapshotStore;
  readonly rules: RuleEngine;
  readonly library: EventTemplateLibrary;
  readonly generator: EventGenerator;
  readonly eventScheduler: EventScheduler;
  readonly pipeline: EventPipeline;
  readonly rng: () => number;
  readonly scheduler: TimeScheduler;
  readonly manualQueue: ManualEventSpec[] = [];
  readonly knowledge: KnowledgeBase;
  readonly conversations: ConversationTable;
  readonly dialogue: DialogueController | null;
  readonly llm: LlmClient | null;

  constructor(
    readonly config: ExperimentConfig,
    paths: ExperimentPaths,
    init: ExperimentInit = {},
  ) {
    resetEidCounter();
    this.world = new WorldState(config);
    this.log = new LogWriter(paths.runDir);
    const agentScale = config.agentScale ?? 16;
    const scaleRun = agentScale >= 100;
    const snapshotEverySlots = Math.max(
      1,
      config.snapshotEverySlots ?? (scaleRun ? 3 : 1),
    );
    this.snapshots = new SnapshotStore(paths.runDir, {
      pretty: config.snapshotPretty ?? !scaleRun,
    });
    this.rules = new RuleEngine({
      log: this.log,
      enableReciprocityRules: config.enableReciprocityRules,
      enableOccasionNorms: config.enableOccasionNorms !== false,
      enableAxisReciprocity: config.enableAxisReciprocity ?? config.enableReciprocityRules,
    });
    this.library = new EventTemplateLibrary();
    const n = this.library.loadFromDir(paths.templatesDir);
    if (n < 1) throw new Error(`no templates in ${paths.templatesDir}`);
    this.generator = new EventGenerator(this.library, this.log);
    this.eventScheduler = new EventScheduler(this.log);
    this.rng = createRng(config.seed);
    this.pipeline = new EventPipeline(this.rules, this.log, this.rng);

    this.knowledge = new KnowledgeBase();
    const knowledgePath =
      paths.knowledgePath ?? join(paths.templatesDir, "../knowledge/gift_norms.json");
    try {
      this.knowledge.load(knowledgePath);
    } catch {
      /* knowledge optional for non-dialogue runs */
    }
    this.conversations = new ConversationTable(join(paths.runDir, "conversation_table.jsonl"));

    const wantDialogue = config.enableDialogue !== false;
    if (wantDialogue) {
      this.llm =
        init.llm ??
        createLlmClient(config.llmMode === "live" ? "live" : "mock");
      this.dialogue = new DialogueController(
        this.llm,
        this.rules,
        this.knowledge,
        this.conversations,
        this.log,
      );
    } else {
      this.llm = init.llm ?? null;
      this.dialogue = null;
    }

    const handlers: SlotHandlers = {
      onDayStart: (w, t) => {
        this.rules.commit(w, t, { kind: "daily_vitals" });
        this.rules.commit(w, t, {
          kind: "belief_forget",
          rngSeed: this.config.seed ^ (t.day * 9973),
        });
      },
      onMonthStart: (w, t) => {
        this.rules.commit(w, t, { kind: "economy_monthly" });
      },
      onGenerateEvents: (w, t) => this.generate(w, t),
      onProcessEvents: (w, t) => this.process(w, t),
      onGiftWindowCheck: (w, t) => {
        this.rules.commit(w, t, { kind: "gift_window_check" });
      },
    };

    this.scheduler = new TimeScheduler(this.world, this.log, this.snapshots, this.rules, handlers, {
      snapshotEverySlots,
      alwaysSnapshotSlot: scaleRun ? "EVE" : undefined,
    });
  }

  queueManual(spec: ManualEventSpec): void {
    this.manualQueue.push({ ...spec, fired: false });
  }

  private generate(world: WorldState, time: SimTime): void {
    this.eventScheduler.resetSlotBusy();

    for (const m of this.manualQueue) {
      if (m.fired) continue;
      if (m.onlyAt && (m.onlyAt.day !== time.day || m.onlyAt.slot !== time.slot)) continue;
      const ev = this.generator.generateManual(world, m.templateId, time, this.rng, {
        roleOverrides: m.roleOverrides,
        payload: m.payload,
        sourceAgentId: m.sourceAgentId,
      });
      if (ev) this.eventScheduler.enqueue(world, ev);
      m.fired = true;
    }

    if (world.config.enableScheduledEvents) {
      for (const ev of this.generator.generateScheduled(world, time, this.rng)) {
        this.eventScheduler.enqueue(world, ev);
      }
    }

    if (world.config.enableRandomSocialEvents !== false) {
      const social = generateStateDrivenSocial({
        world,
        time,
        library: this.library,
        generator: this.generator,
        rng: this.rng,
        log: this.log,
        options: {
          enableBdieDrive: world.config.enableBdieDrive !== false,
          maxPerSlot: world.config.maxRandomSocialPerSlot ?? 8,
        },
      });
      for (const ev of social) {
        this.eventScheduler.enqueue(world, ev);
      }
    }

    // Intention → repay events (before window check in same slot pipeline)
    if (world.config.enableAgentDrivenRepay !== false) {
      const repay = generateRepayFromDebts({
        world,
        time,
        generator: this.generator,
        rng: this.rng,
        log: this.log,
        options: {
          maxPerSlot: world.config.maxRepayPerSlot ?? 12,
        },
      });
      for (const ev of repay) {
        this.eventScheduler.enqueue(world, ev);
      }
    }
  }

  /**
   * P5-02: for each queued event → dialogue (if enabled) → EventPipeline (PET/BDI/gifts).
   * Live LLM: forced dialogues always run; other templated dialogues run under a per-slot budget.
   */
  private async process(world: WorldState, time: SimTime): Promise<void> {
    let dialoguesThisSlot = 0;
    const maxDlgPerSlot = Math.max(
      0,
      world.config.maxDialoguePerSlot ?? (world.config.llmMode === "live" ? 4 : 8),
    );
    await processQueuedEvents(this.eventScheduler, world, time, async (w, t, event) => {
      const dlg = event.dialogue;
      const want =
        this.dialogue &&
        dlg &&
        (dlg.forced ||
          (world.config.enableDialogue !== false &&
            dialoguesThisSlot < maxDlgPerSlot &&
            (event.templateId.includes("gift") ||
              event.templateId.includes("wedding") ||
              event.templateId.includes("repay") ||
              event.category === "public")));
      if (want && this.dialogue) {
        const maxTurns = Math.min(
          8,
          Math.max(2, this.config.dialogueMaxTurns ?? dlg.maxTurns ?? 4),
        );
        try {
          await this.dialogue.run({
            world: w,
            event,
            time: t,
            mode: dlg.mode,
            minTurns: Math.min(2, maxTurns),
            maxTurns,
          });
          dialoguesThisSlot += 1;
        } catch (err) {
          this.log.append(
            t,
            "rule.rejected",
            {
              kind: "dialogue_failed",
              eid: event.eid,
              reason: err instanceof Error ? err.message : String(err),
            },
            { affectedEids: [event.eid] },
          );
        }
      }
      this.pipeline.process(w, t, event);
    });
  }
}
