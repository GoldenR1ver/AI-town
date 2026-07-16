import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventTemplate } from "../../../shared/types/event_template.js";

export class EventTemplateLibrary {
  private byId = new Map<string, EventTemplate>();

  loadFromDir(dir: string): number {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    let n = 0;
    for (const f of files) {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as EventTemplate;
      this.byId.set(raw.templateId, raw);
      n++;
    }
    return n;
  }

  load(templates: EventTemplate[]): void {
    for (const t of templates) this.byId.set(t.templateId, t);
  }

  get(id: string): EventTemplate | undefined {
    return this.byId.get(id);
  }

  all(): EventTemplate[] {
    return [...this.byId.values()];
  }

  byCategory(category: "public" | "private"): EventTemplate[] {
    return this.all().filter((t) => t.category === category);
  }

  scheduledTemplates(): EventTemplate[] {
    return this.all().filter((t) => t.trigger.method === "scheduled");
  }
}
