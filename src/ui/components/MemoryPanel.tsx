import { useEffect, useState } from "react";
import type { MemoryCaptureMode } from "../../services/preferences/BuddyPreferenceStore";
import type { MemoryEntry, MemorySnapshot } from "../../memory/models/MemoryTypes";

interface MemoryPanelProps {
  readonly mode: MemoryCaptureMode;
  readonly snapshot: MemorySnapshot;
  readonly onModeChange: (mode: MemoryCaptureMode) => void;
  readonly onSearch: (query: string) => void;
  readonly onAdd: (content: string) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onPin: (id: string, pinned: boolean) => Promise<void>;
  readonly onClear: (scope: "all" | "turns" | "facts" | "summaries") => Promise<void>;
  readonly onRefresh: () => Promise<void>;
}

export function MemoryPanel(props: MemoryPanelProps) {
  const { mode, snapshot, onModeChange, onSearch, onAdd, onDelete, onPin, onClear, onRefresh } = props;
  const [query, setQuery] = useState(snapshot.query);
  const [manualMemory, setManualMemory] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setQuery(snapshot.query), [snapshot.query]);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await task(); } finally { setBusy(false); }
  };

  return (
    <div className="quick-panel-content memory-panel">
      <section className={`memory-mode-card ${mode}`}>
        <div>
          <strong>{mode === "private" ? "Private session" : "Memory active"}</strong>
          <p>
            {mode === "private"
              ? "New conversation turns and facts are not saved. Existing memory remains available."
              : "Conversation turns and explicit facts can be saved locally for future replies."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onModeChange(mode === "normal" ? "private" : "normal")}
        >
          {mode === "normal" ? "Enter private mode" : "Resume memory"}
        </button>
      </section>

      <section className="memory-stat-grid" aria-label="Memory statistics">
        <div><b>{snapshot.stats.facts}</b><span>facts</span></div>
        <div><b>{snapshot.stats.turns}</b><span>turns</span></div>
        <div><b>{snapshot.stats.summaries}</b><span>summaries</span></div>
        <div><b>{snapshot.stats.pinned}</b><span>pinned</span></div>
      </section>

      <form
        className="memory-add-row"
        onSubmit={event => {
          event.preventDefault();
          const value = manualMemory.trim();
          if (!value) return;
          void run(async () => {
            await onAdd(value);
            setManualMemory("");
          });
        }}
      >
        <input
          value={manualMemory}
          onChange={event => setManualMemory(event.target.value)}
          placeholder="Add something the buddy should remember…"
          maxLength={240}
        />
        <button type="submit" disabled={busy || !manualMemory.trim()}>Remember</button>
      </form>

      <form
        className="memory-search-row"
        onSubmit={event => {
          event.preventDefault();
          onSearch(query);
        }}
      >
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search saved memory…"
        />
        <button type="submit" disabled={snapshot.loading}>Search</button>
        <button type="button" onClick={() => { setQuery(""); onSearch(""); }}>Reset</button>
      </form>

      {snapshot.error && <p className="memory-error" role="alert">{snapshot.error}</p>}

      <section className="memory-entry-list" aria-live="polite">
        {snapshot.loading && <p className="memory-empty">Loading memory…</p>}
        {!snapshot.loading && snapshot.entries.length === 0 && (
          <p className="memory-empty">No saved memories match this view yet.</p>
        )}
        {snapshot.entries.map(entry => (
          <MemoryEntryCard
            key={entry.id}
            entry={entry}
            disabled={busy}
            onDelete={() => run(() => onDelete(entry.id))}
            onPin={() => run(() => onPin(entry.id, !entry.pinned))}
          />
        ))}
      </section>

      <section className="memory-storage-note">
        <strong>Local storage</strong>
        <p>{snapshot.stats.databasePath}</p>
        <small>
          Stored locally in SQLite. At-rest encryption is not enabled yet; that is scheduled for production hardening.
        </small>
      </section>

      <div className="memory-danger-actions">
        <button type="button" disabled={busy} onClick={() => void run(onRefresh)}>Refresh</button>
        <button
          type="button"
          disabled={busy || snapshot.stats.turns === 0}
          onClick={() => {
            if (window.confirm("Delete all saved conversation turns? Facts and summaries will remain.")) {
              void run(() => onClear("turns"));
            }
          }}
        >Clear turns</button>
        <button
          type="button"
          className="danger"
          disabled={busy || snapshot.stats.total === 0}
          onClick={() => {
            if (window.confirm("Permanently delete every saved Desktop Buddy memory? This cannot be undone.")) {
              void run(() => onClear("all"));
            }
          }}
        >Clear all</button>
      </div>
    </div>
  );
}

function MemoryEntryCard({
  entry,
  disabled,
  onDelete,
  onPin,
}: {
  readonly entry: MemoryEntry;
  readonly disabled: boolean;
  readonly onDelete: () => void;
  readonly onPin: () => void;
}) {
  return (
    <article className={`memory-entry-card ${entry.kind} ${entry.pinned ? "pinned" : ""}`}>
      <header>
        <span>{entry.kind}{entry.role ? ` · ${entry.role}` : ""}</span>
        <time dateTime={new Date(entry.updatedAt).toISOString()}>{formatMemoryTime(entry.updatedAt)}</time>
      </header>
      <p>{entry.content}</p>
      <footer>
        <button type="button" disabled={disabled} onClick={onPin}>{entry.pinned ? "Unpin" : "Pin"}</button>
        <button type="button" disabled={disabled} className="danger" onClick={onDelete}>Delete</button>
      </footer>
    </article>
  );
}

function formatMemoryTime(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}
