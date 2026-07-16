import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SimTime, WorldSnapshot } from "../../shared/types/index.js";
import { simTimeKey } from "../../shared/types/index.js";

export class SnapshotStore {
  private readonly dir: string;
  private readonly indexPath: string;

  constructor(runDir: string) {
    this.dir = join(runDir, "snapshots");
    mkdirSync(this.dir, { recursive: true });
    this.indexPath = join(runDir, "replay_index.json");
    if (!existsSync(this.indexPath)) {
      writeFileSync(this.indexPath, "[]\n", "utf8");
    }
  }

  write(snapshot: WorldSnapshot): string {
    const file = `${simTimeKey(snapshot.simTime)}.json`;
    const path = join(this.dir, file);
    writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf8");
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

  private appendIndex(row: { snapshotId: string; simTime: SimTime; seq: number; path: string }): void {
    const prev = existsSync(this.indexPath)
      ? (JSON.parse(readFileSync(this.indexPath, "utf8")) as unknown[])
      : [];
    prev.push(row);
    writeFileSync(this.indexPath, JSON.stringify(prev, null, 2), "utf8");
  }
}
