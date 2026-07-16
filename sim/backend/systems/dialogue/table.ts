import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConversationRecord } from "../../../shared/types/index.js";

/** Append-only persisted conversation table, indexed in memory by cid. */
export class ConversationTable {
  private readonly rows = new Map<string, ConversationRecord>();

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, "", "utf8");
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const row = JSON.parse(line) as ConversationRecord;
      this.rows.set(row.cid, row);
    }
  }

  append(record: ConversationRecord): void {
    if (this.rows.has(record.cid)) throw new Error(`duplicate cid ${record.cid}`);
    this.rows.set(record.cid, structuredClone(record));
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  get(cid: string): ConversationRecord | undefined {
    const row = this.rows.get(cid);
    return row ? structuredClone(row) : undefined;
  }

  all(): ConversationRecord[] {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
}
