export type MemoryEntryKind = "turn" | "fact" | "summary";
export type MemoryRole = "user" | "assistant" | "system" | null;
export type MemoryMode = "normal" | "private";

export interface MemoryEntry {
  readonly id: string;
  readonly kind: MemoryEntryKind;
  readonly role: MemoryRole;
  readonly content: string;
  readonly normalized: string;
  readonly source: string;
  readonly sessionId: string | null;
  readonly importance: number;
  readonly pinned: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly metadataJson: string;
}

export interface MemoryEntryInput extends MemoryEntry {}

export interface MemoryStats {
  readonly total: number;
  readonly turns: number;
  readonly facts: number;
  readonly summaries: number;
  readonly pinned: number;
  readonly databasePath: string;
  readonly encryptedAtRest: boolean;
}

export interface MemorySnapshot {
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly query: string;
  readonly entries: readonly MemoryEntry[];
  readonly stats: MemoryStats;
  readonly error: string | null;
}

export interface RelevantMemory {
  readonly entry: MemoryEntry;
  readonly score: number;
}

export interface ExtractedFact {
  readonly key: string;
  readonly content: string;
  readonly importance: number;
  readonly metadata: Record<string, unknown>;
}

export interface MemoryListQuery {
  readonly kind?: MemoryEntryKind;
  readonly sessionId?: string;
  readonly limit?: number;
}
