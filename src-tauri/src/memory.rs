use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{cmp::Reverse, collections::HashSet, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const MEMORY_DATABASE_FILE: &str = "desktop-buddy-memory.sqlite3";
const MAX_SEARCH_SCAN: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub kind: String,
    pub role: Option<String>,
    pub content: String,
    pub normalized: String,
    pub source: String,
    pub session_id: Option<String>,
    pub importance: i64,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub metadata_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntryInput {
    pub id: String,
    pub kind: String,
    pub role: Option<String>,
    pub content: String,
    pub normalized: String,
    pub source: String,
    pub session_id: Option<String>,
    pub importance: i64,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub metadata_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryListQuery {
    pub kind: Option<String>,
    pub session_id: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats {
    pub total: i64,
    pub turns: i64,
    pub facts: i64,
    pub summaries: i64,
    pub pinned: i64,
    pub database_path: String,
    pub encrypted_at_rest: bool,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve Desktop Buddy memory directory: {error}"))?
        .join("memory");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to create Desktop Buddy memory directory: {error}"))?;
    Ok(directory.join(MEMORY_DATABASE_FILE))
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let connection = Connection::open(path)
        .map_err(|error| format!("Unable to open Desktop Buddy memory database: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS memory_entries (
               id TEXT PRIMARY KEY,
               kind TEXT NOT NULL,
               role TEXT,
               content TEXT NOT NULL,
               normalized TEXT NOT NULL,
               source TEXT NOT NULL,
               session_id TEXT,
               importance INTEGER NOT NULL DEFAULT 1,
               pinned INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               metadata_json TEXT NOT NULL DEFAULT '{}'
             );
             CREATE INDEX IF NOT EXISTS memory_entries_kind_updated
               ON memory_entries(kind, updated_at DESC);
             CREATE INDEX IF NOT EXISTS memory_entries_session_updated
               ON memory_entries(session_id, updated_at DESC);
             CREATE INDEX IF NOT EXISTS memory_entries_pinned_updated
               ON memory_entries(pinned DESC, updated_at DESC);",
        )
        .map_err(|error| format!("Unable to initialise Desktop Buddy memory database: {error}"))?;
    Ok(connection)
}

fn read_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryEntry> {
    Ok(MemoryEntry {
        id: row.get(0)?,
        kind: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        normalized: row.get(4)?,
        source: row.get(5)?,
        session_id: row.get(6)?,
        importance: row.get(7)?,
        pinned: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        metadata_json: row.get(11)?,
    })
}

fn select_entries(
    connection: &Connection,
    kind: Option<&str>,
    session_id: Option<&str>,
    limit: usize,
) -> Result<Vec<MemoryEntry>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, kind, role, content, normalized, source, session_id,
                    importance, pinned, created_at, updated_at, metadata_json
             FROM memory_entries
             WHERE (?1 IS NULL OR kind = ?1)
               AND (?2 IS NULL OR session_id = ?2)
             ORDER BY pinned DESC, updated_at DESC
             LIMIT ?3",
        )
        .map_err(|error| format!("Unable to prepare memory query: {error}"))?;
    let rows = statement
        .query_map(params![kind, session_id, limit as i64], read_entry)
        .map_err(|error| format!("Unable to query memory entries: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to read memory entry: {error}"))
}

fn calculate_stats(connection: &Connection, path: &PathBuf) -> Result<MemoryStats, String> {
    let count = |kind: Option<&str>| -> Result<i64, String> {
        let value = if let Some(kind) = kind {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM memory_entries WHERE kind = ?1",
                    params![kind],
                    |row| row.get(0),
                )
        } else {
            connection.query_row("SELECT COUNT(*) FROM memory_entries", [], |row| row.get(0))
        };
        value.map_err(|error| format!("Unable to count memory entries: {error}"))
    };
    let pinned = connection
        .query_row(
            "SELECT COUNT(*) FROM memory_entries WHERE pinned = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Unable to count pinned memories: {error}"))?;

    Ok(MemoryStats {
        total: count(None)?,
        turns: count(Some("turn"))?,
        facts: count(Some("fact"))?,
        summaries: count(Some("summary"))?,
        pinned,
        database_path: path.display().to_string(),
        // Phase 7 stores memory locally in SQLite. At-rest encryption is a
        // Phase 9 hardening item so we do not make a false security claim.
        encrypted_at_rest: false,
    })
}

#[tauri::command]
pub fn memory_initialize(app: AppHandle) -> Result<MemoryStats, String> {
    let path = database_path(&app)?;
    let connection = open_database(&app)?;
    calculate_stats(&connection, &path)
}

#[tauri::command]
pub fn memory_upsert_entry(
    app: AppHandle,
    entry: MemoryEntryInput,
) -> Result<MemoryEntry, String> {
    let connection = open_database(&app)?;
    connection
        .execute(
            "INSERT INTO memory_entries (
               id, kind, role, content, normalized, source, session_id,
               importance, pinned, created_at, updated_at, metadata_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
               kind = excluded.kind,
               role = excluded.role,
               content = excluded.content,
               normalized = excluded.normalized,
               source = excluded.source,
               session_id = excluded.session_id,
               importance = excluded.importance,
               pinned = excluded.pinned,
               updated_at = excluded.updated_at,
               metadata_json = excluded.metadata_json",
            params![
                &entry.id,
                &entry.kind,
                entry.role.as_deref(),
                &entry.content,
                &entry.normalized,
                &entry.source,
                entry.session_id.as_deref(),
                entry.importance,
                if entry.pinned { 1 } else { 0 },
                entry.created_at,
                entry.updated_at,
                &entry.metadata_json,
            ],
        )
        .map_err(|error| format!("Unable to save memory entry: {error}"))?;

    connection
        .query_row(
            "SELECT id, kind, role, content, normalized, source, session_id,
                    importance, pinned, created_at, updated_at, metadata_json
             FROM memory_entries WHERE id = ?1",
            params![entry.id],
            read_entry,
        )
        .map_err(|error| format!("Unable to read saved memory entry: {error}"))
}

#[tauri::command]
pub fn memory_list_entries(
    app: AppHandle,
    query: MemoryListQuery,
) -> Result<Vec<MemoryEntry>, String> {
    let connection = open_database(&app)?;
    select_entries(
        &connection,
        query.kind.as_deref(),
        query.session_id.as_deref(),
        query.limit.unwrap_or(100).clamp(1, 500) as usize,
    )
}

#[tauri::command]
pub fn memory_search_entries(
    app: AppHandle,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<MemoryEntry>, String> {
    let connection = open_database(&app)?;
    let mut entries = select_entries(&connection, None, None, MAX_SEARCH_SCAN)?;
    let normalized_query = query.trim().to_lowercase();
    if normalized_query.is_empty() {
        entries.truncate(limit.unwrap_or(100).clamp(1, 200) as usize);
        return Ok(entries);
    }

    let terms: HashSet<String> = normalized_query
        .split(|character: char| !character.is_alphanumeric())
        .filter(|term| term.len() >= 2)
        .map(str::to_string)
        .collect();

    entries.sort_by_key(|entry| {
        let haystack = format!("{} {}", entry.normalized, entry.content.to_lowercase());
        let exact = if haystack.contains(&normalized_query) { 30 } else { 0 };
        let matched = terms
            .iter()
            .filter(|term| haystack.contains(term.as_str()))
            .count() as i64;
        let kind_bonus = match entry.kind.as_str() {
            "fact" => 8,
            "summary" => 4,
            _ => 0,
        };
        let score = exact
            + matched * 5
            + kind_bonus
            + entry.importance.clamp(0, 10)
            + if entry.pinned { 20 } else { 0 };
        Reverse((score, entry.updated_at))
    });

    entries.retain(|entry| {
        let haystack = format!("{} {}", entry.normalized, entry.content.to_lowercase());
        haystack.contains(&normalized_query)
            || terms.iter().any(|term| haystack.contains(term.as_str()))
    });
    entries.truncate(limit.unwrap_or(20).clamp(1, 100) as usize);
    Ok(entries)
}

#[tauri::command]
pub fn memory_set_pinned(
    app: AppHandle,
    id: String,
    pinned: bool,
    updated_at: i64,
) -> Result<(), String> {
    let connection = open_database(&app)?;
    connection
        .execute(
            "UPDATE memory_entries SET pinned = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, if pinned { 1 } else { 0 }, updated_at],
        )
        .map_err(|error| format!("Unable to update pinned memory: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn memory_delete_entry(app: AppHandle, id: String) -> Result<(), String> {
    let connection = open_database(&app)?;
    connection
        .execute("DELETE FROM memory_entries WHERE id = ?1", params![id])
        .map_err(|error| format!("Unable to delete memory entry: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn memory_clear(app: AppHandle, scope: String) -> Result<MemoryStats, String> {
    let path = database_path(&app)?;
    let connection = open_database(&app)?;
    match scope.as_str() {
        "turns" => connection.execute("DELETE FROM memory_entries WHERE kind = 'turn'", []),
        "facts" => connection.execute("DELETE FROM memory_entries WHERE kind = 'fact'", []),
        "summaries" => connection.execute("DELETE FROM memory_entries WHERE kind = 'summary'", []),
        "all" => connection.execute("DELETE FROM memory_entries", []),
        _ => return Err("Unknown memory clear scope.".to_string()),
    }
    .map_err(|error| format!("Unable to clear memory: {error}"))?;
    calculate_stats(&connection, &path)
}

#[tauri::command]
pub fn memory_stats(app: AppHandle) -> Result<MemoryStats, String> {
    let path = database_path(&app)?;
    let connection = open_database(&app)?;
    calculate_stats(&connection, &path)
}

#[tauri::command]
pub fn memory_find_by_id(app: AppHandle, id: String) -> Result<Option<MemoryEntry>, String> {
    let connection = open_database(&app)?;
    connection
        .query_row(
            "SELECT id, kind, role, content, normalized, source, session_id,
                    importance, pinned, created_at, updated_at, metadata_json
             FROM memory_entries WHERE id = ?1",
            params![id],
            read_entry,
        )
        .optional()
        .map_err(|error| format!("Unable to look up memory entry: {error}"))
}
