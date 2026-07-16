import { mkdirSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LogEntry, LogEventType, SimTime } from "../../shared/types/index.js";

export class LogWriter {
  private seq = 0;
  private readonly logPath: string;

  constructor(private readonly runDir: string) {
    mkdirSync(runDir, { recursive: true });
    this.logPath = join(runDir, "event_log.jsonl");
    if (!existsSync(this.logPath)) {
      writeFileSync(this.logPath, "", "utf8");
    }
  }

  nextSeq(): number {
    return this.seq;
  }

  append(simTime: SimTime, type: LogEventType, payload: unknown, statePointers?: LogEntry["statePointers"]): LogEntry {
    const entry: LogEntry = {
      seq: this.seq++,
      simTime,
      type,
      payload,
      statePointers,
    };
    appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  get path(): string {
    return this.logPath;
  }
}
