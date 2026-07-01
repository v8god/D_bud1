# Phase 7 — Persistent Memory

## Goals

Phase 7 makes memory a default core service rather than an optional plug-in.

- Conversation turns are stored locally in SQLite while Memory mode is active.
- Explicit facts such as names, preferences, favourites, projects, and “remember that…” statements are extracted into separate entries.
- Every six user turns, Desktop Buddy creates a small deterministic local session summary.
- Relevant memories can be retrieved for a new question without loading an embedding model.
- The Memory panel can search, pin, add, inspect, delete, and clear entries.
- Private mode immediately stops new durable writes while preserving existing memory.

## Storage

The database is stored under Tauri's app-data directory in:

```text
memory/desktop-buddy-memory.sqlite3
```

The Memory panel displays the exact path on the current computer.

The SQLite database uses WAL mode and a bundled SQLite library. No cloud service is required.

## Entry kinds

- `turn`: one user or assistant conversation turn.
- `fact`: an explicit fact or manually added memory.
- `summary`: a compact local summary created every six user turns.

## Retrieval

Phase 7 uses a dependency-free hashed token vectorizer plus keyword, recency, kind, and pinning bonuses. It is a lightweight relevance system, not a neural semantic embedding model. The `MemoryVectorizer` interface is intentionally replaceable by a future embedding provider.

## Private mode

Private mode:

- does not save new user turns;
- does not save assistant turns;
- does not extract new facts;
- does not create session summaries;
- still allows the user to inspect or use memories saved before private mode.

Changing private mode updates an already-running continuous conversation immediately.

## Security status

Phase 7 keeps the database local but does not claim at-rest encryption. Phase 9 production hardening should add:

1. SQLCipher or field-level authenticated encryption;
2. a per-installation key protected by the operating-system credential store;
3. database migration and key rotation;
4. secure deletion expectations documented honestly;
5. export/import controls with explicit user confirmation.

## Voice capture reliability

Phase 7 also improves push-to-talk reliability:

- the indicator stays in a warm-up state until recognition is ready;
- the user is told to speak when the bars turn blue;
- releasing Space immediately after startup waits for at least 650 ms of ready capture before processing;
- this reduces first-word clipping without recording audio persistently.
