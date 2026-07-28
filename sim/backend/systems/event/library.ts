import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EventTemplate } from "../../../shared/types/event_template.js";
import { isRandomSocialTemplate } from "./social_drive.js";

interface CatalogFile {
  templates?: EventTemplate[];
}

export class EventTemplateLibrary {
  private byId = new Map<string, EventTemplate>();

  loadFromDir(dir: string): number {
    if (!existsSync(dir)) return 0;
    const entries = readdirSync(dir);
    let n = 0;
    for (const f of entries) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) {
        n += this.loadFromDir(full);
        continue;
      }
      if (!f.endsWith(".json")) continue;
      const raw = JSON.parse(readFileSync(full, "utf8")) as EventTemplate | CatalogFile;
      if (Array.isArray((raw as CatalogFile).templates)) {
        n += this.load((raw as CatalogFile).templates!);
      } else if ((raw as EventTemplate).templateId) {
        this.byId.set((raw as EventTemplate).templateId, raw as EventTemplate);
        n += 1;
      }
    }
    return n;
  }

  /** Load a catalog JSON `{ templates: EventTemplate[] }`. */
  loadCatalog(path: string): number {
    if (!existsSync(path)) return 0;
    const raw = JSON.parse(readFileSync(path, "utf8")) as CatalogFile | EventTemplate[];
    const list = Array.isArray(raw) ? raw : (raw.templates ?? []);
    return this.load(list);
  }

  load(templates: EventTemplate[]): number {
    let n = 0;
    for (const t of templates) {
      this.byId.set(t.templateId, t);
      n++;
    }
    return n;
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

  /** Agent-driven / random social pool (串门、闲谈等). */
  randomSocialTemplates(): EventTemplate[] {
    return this.all().filter(isRandomSocialTemplate);
  }

  size(): number {
    return this.byId.size;
  }
}
