import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LogEntry, SimTime, WorldSnapshot } from "../../shared/types/index.js";
import { simTimeKey } from "../../shared/types/index.js";

export interface ReplayIndexRow {
  snapshotId: string;
  simTime: SimTime;
  seq: number;
  path: string;
}

/**
 * ReplayEngine v0: load run artifacts; seek by simTime or seq.
 * Strategy: pick latest snapshot with seq <= target (slot-end snapshots cover state).
 */
export class ReplayEngine {
  private runDir = "";
  private index: ReplayIndexRow[] = [];
  private logs: LogEntry[] = [];

  loadExperiment(runIdOrDir: string, runsRoot?: string): void {
    const runDir = existsSync(runIdOrDir)
      ? runIdOrDir
      : join(runsRoot ?? "", runIdOrDir);
    if (!existsSync(runDir)) {
      throw new Error(`run not found: ${runDir}`);
    }
    this.runDir = runDir;
    const indexPath = join(runDir, "replay_index.json");
    this.index = existsSync(indexPath)
      ? (JSON.parse(readFileSync(indexPath, "utf8")) as ReplayIndexRow[])
      : [];
    const logPath = join(runDir, "event_log.jsonl");
    this.logs = existsSync(logPath)
      ? readFileSync(logPath, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as LogEntry)
      : [];
  }

  listSnapshotKeys(): string[] {
    return this.index.map((r) => simTimeKey(r.simTime));
  }

  seekTo(simTime: SimTime): WorldSnapshot {
    const key = simTimeKey(simTime);
    const row = this.index.find((r) => simTimeKey(r.simTime) === key);
    if (!row) throw new Error(`no snapshot for ${key}`);
    return this.readSnapshot(row.path);
  }

  seekToSeq(seq: number): WorldSnapshot {
    const candidates = this.index.filter((r) => r.seq <= seq).sort((a, b) => b.seq - a.seq);
    if (!candidates.length) {
      // fall back to first snapshot
      if (!this.index.length) throw new Error("no snapshots in run");
      return this.readSnapshot(this.index[0]!.path);
    }
    return this.readSnapshot(candidates[0]!.path);
  }

  /** Logs with seq in (afterSeq, toSeq]. */
  logsBetween(afterSeq: number, toSeq: number): LogEntry[] {
    return this.logs.filter((e) => e.seq > afterSeq && e.seq <= toSeq);
  }

  allLogs(): LogEntry[] {
    return this.logs;
  }

  traceAgent(agentId: string): LogEntry[] {
    return this.logs.filter((e) => e.statePointers?.affectedAgents?.includes(agentId));
  }

  traceGift(gid: string): LogEntry[] {
    return this.logs.filter((e) => e.statePointers?.affectedGids?.includes(gid));
  }

  get runDirectory(): string {
    return this.runDir;
  }

  private readSnapshot(relPath: string): WorldSnapshot {
    const path = join(this.runDir, relPath);
    if (!existsSync(path)) throw new Error(`snapshot missing: ${path}`);
    return JSON.parse(readFileSync(path, "utf8")) as WorldSnapshot;
  }
}

export function listRunIds(runsRoot: string): string[] {
  if (!existsSync(runsRoot)) return [];
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}
