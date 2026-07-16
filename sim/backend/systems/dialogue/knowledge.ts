import { readFileSync } from "node:fs";
import type { KnowledgeEntry } from "../../../shared/types/index.js";

export class KnowledgeBase {
  constructor(private entries: KnowledgeEntry[] = []) {}

  load(path: string): number {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { entries: KnowledgeEntry[] };
    this.entries = raw.entries;
    return this.entries.length;
  }

  search(subType: string, occupations: string[], limit = 5): KnowledgeEntry[] {
    const terms = [subType.toLowerCase(), ...occupations.map((x) => x.toLowerCase())];
    return this.entries
      .map((entry) => ({
        entry,
        score: entry.tags.filter((tag) =>
          terms.some((term) => term.includes(tag.toLowerCase()) || tag.toLowerCase().includes(term)),
        ).length + (entry.key.toLowerCase().includes(subType.toLowerCase()) ? 2 : 0),
      }))
      .filter((x) => x.score > 0 || x.entry.category === "norm")
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.entry);
  }
}
