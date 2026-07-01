import { invoke } from "@tauri-apps/api/core";
import type {
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryKind,
  MemoryListQuery,
  MemoryStats,
} from "../models/MemoryTypes";

const EMPTY_STATS: MemoryStats = {
  total: 0,
  turns: 0,
  facts: 0,
  summaries: 0,
  pinned: 0,
  databasePath: "Browser preview memory",
  encryptedAtRest: false,
};

export class MemoryStore {
  private readonly previewEntries = new Map<string, MemoryEntry>();

  get nativeAvailable(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  async initialize(): Promise<MemoryStats> {
    if (!this.nativeAvailable) return this.previewStats();
    return invoke<MemoryStats>("memory_initialize");
  }

  async upsert(entry: MemoryEntryInput): Promise<MemoryEntry> {
    if (!this.nativeAvailable) {
      this.previewEntries.set(entry.id, entry);
      return entry;
    }
    return invoke<MemoryEntry>("memory_upsert_entry", { entry });
  }

  async list(query: MemoryListQuery = {}): Promise<readonly MemoryEntry[]> {
    if (!this.nativeAvailable) {
      return [...this.previewEntries.values()]
        .filter(entry => !query.kind || entry.kind === query.kind)
        .filter(entry => !query.sessionId || entry.sessionId === query.sessionId)
        .sort(sortRecent)
        .slice(0, query.limit ?? 100);
    }
    return invoke<MemoryEntry[]>("memory_list_entries", { query });
  }

  async search(query: string, limit = 30): Promise<readonly MemoryEntry[]> {
    if (!this.nativeAvailable) {
      const normalized = query.trim().toLocaleLowerCase();
      return [...this.previewEntries.values()]
        .filter(entry => !normalized || `${entry.normalized} ${entry.content.toLocaleLowerCase()}`.includes(normalized))
        .sort(sortRecent)
        .slice(0, limit);
    }
    return invoke<MemoryEntry[]>("memory_search_entries", { query, limit });
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    const updatedAt = Date.now();
    if (!this.nativeAvailable) {
      const current = this.previewEntries.get(id);
      if (current) this.previewEntries.set(id, { ...current, pinned, updatedAt });
      return;
    }
    await invoke("memory_set_pinned", { id, pinned, updatedAt });
  }

  async delete(id: string): Promise<void> {
    if (!this.nativeAvailable) {
      this.previewEntries.delete(id);
      return;
    }
    await invoke("memory_delete_entry", { id });
  }

  async clear(scope: "all" | "turns" | "facts" | "summaries"): Promise<MemoryStats> {
    if (!this.nativeAvailable) {
      if (scope === "all") this.previewEntries.clear();
      else {
        const kindByScope: Record<"turns" | "facts" | "summaries", MemoryEntryKind> = {
          turns: "turn",
          facts: "fact",
          summaries: "summary",
        };
        const kind = kindByScope[scope];
        for (const [id, entry] of this.previewEntries) if (entry.kind === kind) this.previewEntries.delete(id);
      }
      return this.previewStats();
    }
    return invoke<MemoryStats>("memory_clear", { scope });
  }

  async stats(): Promise<MemoryStats> {
    if (!this.nativeAvailable) return this.previewStats();
    return invoke<MemoryStats>("memory_stats");
  }

  private previewStats(): MemoryStats {
    const entries = [...this.previewEntries.values()];
    return {
      ...EMPTY_STATS,
      total: entries.length,
      turns: entries.filter(entry => entry.kind === "turn").length,
      facts: entries.filter(entry => entry.kind === "fact").length,
      summaries: entries.filter(entry => entry.kind === "summary").length,
      pinned: entries.filter(entry => entry.pinned).length,
    };
  }
}

function sortRecent(left: MemoryEntry, right: MemoryEntry): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return right.updatedAt - left.updatedAt;
}
