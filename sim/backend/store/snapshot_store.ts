import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SimTime, WorldSnapshot } from "../../shared/types/index.js";
import { simTimeKey } from "../../shared/types/index.js";

export interface SnapshotIndexRow {
  snapshotId: string;
  simTime: SimTime;
  seq: number;
  path: string;
}

export interface SnapshotStoreOptions {
  /** Pretty-print JSON (default true). Compact for large-scale runs. */
  pretty?: boolean;
}

export class SnapshotStore {
  private readonly dir: string;
  private readonly indexPath: string;
  private readonly pretty: boolean;
  private index: SnapshotIndexRow[] = [];

  constructor(runDir: string, opts: SnapshotStoreOptions = {}) {
    this.dir = join(runDir, "snapshots");
    mkdirSync(this.dir, { recursive: true });
    this.indexPath = join(runDir, "replay_index.json");
    this.pretty = opts.pretty !== false;
    if (existsSync(this.indexPath)) {
      try {
        this.index = JSON.parse(readFileSync(this.indexPath, "utf8")) as SnapshotIndexRow[];
      } catch {
        this.index = [];
      }
    } else {
      writeFileSync(this.indexPath, "[]\n", "utf8");
    }
  }

  write(snapshot: WorldSnapshot): string {
    const file = `${simTimeKey(snapshot.simTime)}.json`;
    const path = join(this.dir, file);
    writeFileSync(
      path,
      this.pretty ? JSON.stringify(snapshot, null, 2) : JSON.stringify(snapshot),
      "utf8",
    );
    this.appendIndex({
      snapshotId: snapshot.snapshotId,
      simTime: snapshot.simTime,
      seq: snapshot.seq,
      path: `snapshots/${file}`,
    });
    return path;
  }

  load(simTime: SimTime): WorldSnapshot | null {
    const path = join(this.dir, `${simTimeKey(simTime)}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as WorldSnapshot;
  }

  private appendIndex(row: SnapshotIndexRow): void {
    this.index.push(row);
    // Flush periodically to limit rewrite cost on long runs.
    if (this.index.length % 10 === 0 || this.index.length <= 2) {
      writeFileSync(this.indexPath, JSON.stringify(this.index), "utf8");
    } else {
      writeFileSync(this.indexPath, JSON.stringify(this.index), "utf8");
    }
  }

  /** Force flush index (call at run end). */
  flushIndex(): void {
    writeFileSync(this.indexPath, JSON.stringify(this.index), "utf8");
  }
}

