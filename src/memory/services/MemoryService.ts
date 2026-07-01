import type {
  ExtractedFact,
  MemoryEntry,
  MemoryMode,
  MemorySnapshot,
  MemoryStats,
  RelevantMemory,
} from "../models/MemoryTypes";
import { MemoryStore } from "../storage/MemoryStore";
import { HashedTokenVectorizer, normalizeMemoryText } from "../vectors/HashedTokenVectorizer";

export type MemoryListener = (snapshot: MemorySnapshot) => void;

const EMPTY_STATS: MemoryStats = {
  total: 0,
  turns: 0,
  facts: 0,
  summaries: 0,
  pinned: 0,
  databasePath: "Not initialised",
  encryptedAtRest: false,
};

const EMPTY_SNAPSHOT: MemorySnapshot = {
  initialized: false,
  loading: false,
  query: "",
  entries: [],
  stats: EMPTY_STATS,
  error: null,
};

export class MemoryService {
  private readonly store = new MemoryStore();
  private readonly vectorizer = new HashedTokenVectorizer();
  private readonly listeners = new Set<MemoryListener>();
  private snapshot = EMPTY_SNAPSHOT;
  private readonly sessionUserTurns = new Map<string, string[]>();

  getSnapshot(): MemorySnapshot {
    return this.snapshot;
  }

  subscribe(listener: MemoryListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    this.update({ loading: true, error: null });
    try {
      const stats = await this.store.initialize();
      const entries = await this.store.list({ limit: 80 });
      this.update({ initialized: true, loading: false, stats, entries });
    } catch (caught) {
      this.update({
        initialized: false,
        loading: false,
        error: toErrorMessage(caught),
      });
    }
  }

  async refresh(query = this.snapshot.query): Promise<void> {
    this.update({ loading: true, query, error: null });
    try {
      const [entries, stats] = await Promise.all([
        query.trim() ? this.store.search(query, 80) : this.store.list({ limit: 80 }),
        this.store.stats(),
      ]);
      this.update({ initialized: true, loading: false, entries, stats });
    } catch (caught) {
      this.update({ loading: false, error: toErrorMessage(caught) });
    }
  }

  async addManualFact(content: string, pinned = true): Promise<MemoryEntry | null> {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const now = Date.now();
    const entry = await this.store.upsert({
      id: `fact-manual-${crypto.randomUUID()}`,
      kind: "fact",
      role: "user",
      content: trimmed,
      normalized: normalizeMemoryText(trimmed),
      source: "manual-memory",
      sessionId: null,
      importance: pinned ? 9 : 6,
      pinned,
      createdAt: now,
      updatedAt: now,
      metadataJson: JSON.stringify({ factType: "manual", vectorizer: this.vectorizer.id }),
    });
    await this.refresh();
    return entry;
  }

  async recordConversationTurn(input: {
    readonly sessionId: string;
    readonly role: "user" | "assistant";
    readonly content: string;
    readonly source: string;
    readonly mode: MemoryMode;
  }): Promise<void> {
    if (input.mode === "private") return;
    const content = input.content.trim();
    if (!content) return;
    const now = Date.now();
    const vector = this.vectorizer.vectorize(content);
    await this.store.upsert({
      id: `turn-${crypto.randomUUID()}`,
      kind: "turn",
      role: input.role,
      content,
      normalized: normalizeMemoryText(content),
      source: input.source,
      sessionId: input.sessionId,
      importance: input.role === "user" ? 4 : 2,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      metadataJson: JSON.stringify({ vector, vectorizer: this.vectorizer.id }),
    });

    if (input.role === "user") {
      await this.extractAndStoreFacts(content, input.sessionId);
      const turns = this.sessionUserTurns.get(input.sessionId) ?? [];
      turns.push(content);
      this.sessionUserTurns.set(input.sessionId, turns);
      if (turns.length > 0 && turns.length % 6 === 0) {
        await this.storeSessionSummary(input.sessionId, turns.slice(-6));
      }
    }
  }

  async retrieveRelevant(query: string, limit = 5): Promise<readonly RelevantMemory[]> {
    const searched = await this.store.search(query, 80);
    const candidates = searched.length > 0
      ? searched
      : await this.store.list({ limit: 220 });
    const queryVector = this.vectorizer.vectorize(query);
    return candidates
      .map(entry => {
        const metadata = safeJson(entry.metadataJson);
        const storedVector = Array.isArray(metadata.vector)
          ? metadata.vector.filter(value => typeof value === "number") as number[]
          : this.vectorizer.vectorize(entry.content);
        const vectorScore = this.vectorizer.similarity(queryVector, storedVector);
        const kindBonus = entry.kind === "fact" ? 0.24 : entry.kind === "summary" ? 0.1 : 0;
        const pinnedBonus = entry.pinned ? 0.28 : 0;
        const recencyDays = Math.max(0, (Date.now() - entry.updatedAt) / 86_400_000);
        const recencyBonus = Math.max(0, 0.15 - recencyDays * 0.005);
        return { entry, score: vectorScore + kindBonus + pinnedBonus + recencyBonus };
      })
      .filter(item => item.score > 0.12)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  async listFacts(limit = 20): Promise<readonly MemoryEntry[]> {
    return this.store.list({ kind: "fact", limit });
  }

  async deleteEntry(id: string): Promise<void> {
    await this.store.delete(id);
    await this.refresh();
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.store.setPinned(id, pinned);
    await this.refresh();
  }

  async clear(scope: "all" | "turns" | "facts" | "summaries"): Promise<void> {
    const stats = await this.store.clear(scope);
    const entries = await this.store.list({ limit: 80 });
    this.update({ stats, entries, query: "", error: null });
  }

  private async extractAndStoreFacts(text: string, sessionId: string): Promise<void> {
    const facts = extractFacts(text);
    for (const fact of facts) {
      const now = Date.now();
      const id = `fact-${stableHash(fact.key)}`;
      const vector = this.vectorizer.vectorize(fact.content);
      await this.store.upsert({
        id,
        kind: "fact",
        role: "user",
        content: fact.content,
        normalized: normalizeMemoryText(fact.content),
        source: "conversation-fact-extractor",
        sessionId,
        importance: fact.importance,
        pinned: fact.importance >= 9,
        createdAt: now,
        updatedAt: now,
        metadataJson: JSON.stringify({ ...fact.metadata, key: fact.key, vector, vectorizer: this.vectorizer.id }),
      });
    }
  }

  private async storeSessionSummary(sessionId: string, userTurns: readonly string[]): Promise<void> {
    const topics = topTerms(userTurns.join(" "), 8);
    const compactTurns = userTurns
      .map(turn => turn.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(-4)
      .map(turn => turn.length > 100 ? `${turn.slice(0, 97)}…` : turn);
    const content = topics.length > 0
      ? `Session topics: ${topics.join(", ")}. Recent user requests: ${compactTurns.join(" | ")}`
      : `Recent user requests: ${compactTurns.join(" | ")}`;
    const now = Date.now();
    const bucket = Math.ceil((this.sessionUserTurns.get(sessionId)?.length ?? userTurns.length) / 6);
    await this.store.upsert({
      id: `summary-${sessionId}-${bucket}`,
      kind: "summary",
      role: "system",
      content,
      normalized: normalizeMemoryText(content),
      source: "local-session-summary",
      sessionId,
      importance: 5,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      metadataJson: JSON.stringify({ topics, vector: this.vectorizer.vectorize(content), vectorizer: this.vectorizer.id }),
    });
  }

  private update(next: Partial<MemorySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

function extractFacts(text: string): readonly ExtractedFact[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const facts: ExtractedFact[] = [];
  const add = (key: string, content: string, importance: number, factType: string) => {
    const clean = cleanCapturedFact(content);
    if (clean.length < 2 || clean.length > 240) return;
    facts.push({ key: `${key}:${normalizeMemoryText(clean)}`, content: clean, importance, metadata: { factType } });
  };

  const name = normalized.match(/\b(?:my name is|call me)\s+([\p{L}][\p{L}\s.'-]{0,50})/iu);
  if (name) add("identity:name", `The user's preferred name is ${name[1].trim()}.`, 10, "identity");

  const favourite = normalized.match(/\bmy favou?rite\s+([\p{L}\s]{2,40})\s+is\s+(.+)/iu);
  if (favourite) add(`favorite:${favourite[1]}`, `The user's favorite ${favourite[1].trim()} is ${favourite[2].trim()}.`, 9, "preference");

  const like = normalized.match(/\b(?:i like|i love|i enjoy|i prefer)\s+(.+)/iu);
  if (like) add("preference:like", `The user likes ${like[1].trim()}.`, 7, "preference");

  const dislike = normalized.match(/\b(?:i dislike|i hate|i do not like|i don't like)\s+(.+)/iu);
  if (dislike) add("preference:dislike", `The user dislikes ${dislike[1].trim()}.`, 7, "preference");

  const project = normalized.match(/\b(?:i am|i'm)\s+(?:working on|building|creating|developing)\s+(.+)/iu);
  if (project) add("project:current", `The user is working on ${project[1].trim()}.`, 8, "project");

  const remember = normalized.match(/\bremember(?: that)?\s+(.+)/iu);
  if (remember) add("explicit:remember", remember[1].trim(), 10, "explicit");

  return deduplicateFacts(facts);
}

function deduplicateFacts(facts: readonly ExtractedFact[]): readonly ExtractedFact[] {
  const seen = new Set<string>();
  return facts.filter(fact => {
    if (seen.has(fact.key)) return false;
    seen.add(fact.key);
    return true;
  });
}

function cleanCapturedFact(value: string): string {
  return value.trim().replace(/[.?!]+$/, "").replace(/\s+/g, " ");
}

function topTerms(text: string, limit: number): readonly string[] {
  const counts = new Map<string, number>();
  for (const term of normalizeMemoryText(text).split(" ")) {
    if (term.length < 3) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
