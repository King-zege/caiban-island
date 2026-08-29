import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA_V1 = [
  `CREATE TABLE IF NOT EXISTS tasks(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'task',
    urgency TEXT NOT NULL DEFAULT 'normal',
    deadline_utc TEXT,
    tz_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    archived_at TEXT,
    archive_outcome TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nodes(
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_utc TEXT,
    end_utc TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    position INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS links(
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS notes(
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS change_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    at_utc TEXT NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS reminders(
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    offset_minutes INTEGER NOT NULL,
    fire_at_utc TEXT NOT NULL,
    fired INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS drafts(
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  )`,
  'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
];

const SCHEMA_V2 = [
  `CREATE TABLE agent_sessions(
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE agent_messages(
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX agent_messages_session_sequence ON agent_messages(session_id, sequence)'
];

const SCHEMA_V3 = [
  `CREATE TABLE memories(
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK(category IN ('profile','work')),
    fact TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    source_message_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE memory_proposals(
    id TEXT PRIMARY KEY,
    operation TEXT NOT NULL CHECK(operation IN ('add','replace','remove')),
    category TEXT NOT NULL CHECK(category IN ('profile','work')),
    fact TEXT NOT NULL,
    evidence_message_id TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    target_memory_id TEXT,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','confirmed','discarded')),
    capacity_warning TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX memory_proposals_state_created ON memory_proposals(state, created_at)',
  "CREATE VIRTUAL TABLE agent_messages_fts USING fts5(content, content='agent_messages', content_rowid='rowid', tokenize='unicode61')",
  `CREATE TRIGGER agent_messages_fts_insert AFTER INSERT ON agent_messages BEGIN
    INSERT INTO agent_messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END`,
  `CREATE TRIGGER agent_messages_fts_delete AFTER DELETE ON agent_messages BEGIN
    INSERT INTO agent_messages_fts(agent_messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  END`,
  `CREATE TRIGGER agent_messages_fts_update AFTER UPDATE OF content ON agent_messages BEGIN
    INSERT INTO agent_messages_fts(agent_messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO agent_messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END`,
  "INSERT INTO agent_messages_fts(agent_messages_fts) VALUES('rebuild')"
];

const SCHEMA_V4 = [
  `CREATE TABLE node_reminders(
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    fire_at_utc TEXT NOT NULL,
    fired INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX node_reminders_due ON node_reminders(fired, fire_at_utc)'
];

const SCHEMA_V5 = [
  'ALTER TABLE tasks ADD COLUMN remind_at_utc TEXT',
  `CREATE TABLE misc_reminders(
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    fire_at_utc TEXT NOT NULL,
    fired INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX misc_reminders_due ON misc_reminders(fired, fire_at_utc)',
  `UPDATE notes
   SET body = CASE
       WHEN trim(body) = '' THEN (SELECT description FROM tasks WHERE tasks.id = notes.task_id)
       ELSE body || char(10) || char(10) || '原任务说明' || char(10) || (SELECT description FROM tasks WHERE tasks.id = notes.task_id)
     END,
     updated_at = (SELECT updated_at FROM tasks WHERE tasks.id = notes.task_id)
   WHERE task_id IN (SELECT id FROM tasks WHERE kind = 'misc' AND trim(description) <> '')`,
  `INSERT INTO notes(id, task_id, body, updated_at)
   SELECT id, id, description, updated_at FROM tasks
   WHERE kind = 'misc' AND trim(description) <> ''
     AND NOT EXISTS (SELECT 1 FROM notes WHERE notes.task_id = tasks.id)`,
  "UPDATE tasks SET description = '' WHERE kind = 'misc' AND trim(description) <> ''",
  "DELETE FROM reminders WHERE task_id IN (SELECT id FROM tasks WHERE kind = 'misc')"
];

const SCHEMA_V6 = [
  'ALTER TABLE drafts ADD COLUMN session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL',
  'CREATE INDEX drafts_session_state_created ON drafts(session_id, state, created_at)'
];

const SCHEMA_V7 = [
  "DELETE FROM settings WHERE key IN ('mcp_token', 'mcp_token_encrypted', 'mcp_port', 'api_base_url', 'api_model', 'api_key_enc')"
];

const SCHEMA_V8 = [
  "UPDATE tasks SET full_name = name WHERE full_name IS NULL OR trim(full_name) = ''",
  `UPDATE tasks SET short_name = CASE
     WHEN length(name) <= 24 THEN name
     ELSE substr(name, 1, 23) || '…'
   END WHERE short_name IS NULL OR trim(short_name) = ''`,
  'UPDATE tasks SET short_name_needs_review = CASE WHEN length(name) > 24 THEN 1 ELSE short_name_needs_review END',
  "UPDATE tasks SET kind = 'procurement' WHERE kind = 'task'",
  `CREATE TABLE IF NOT EXISTS agent_proposals(
    id TEXT PRIMARY KEY,
    session_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','discarded')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS agent_proposals_state_created ON agent_proposals(state, created_at)',
  `INSERT OR IGNORE INTO agent_proposals(id, session_id, kind, title, summary, payload, state, created_at, updated_at)
   SELECT id, session_id, 'legacy_draft', '遗留 Agent 方案', '由 v0.2 草稿迁移，确认前不会写入正式数据', payload, state, created_at, created_at
   FROM drafts WHERE state = 'pending'`
];

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as Array<{ name: string }>;
  return columns.some((entry) => entry.name === column);
}

function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE "${table}" ADD COLUMN ${definition}`);
}

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(
      (db.prepare('SELECT version FROM schema_migrations').all() as unknown as Array<{ version: number }>).map((row) => row.version)
    );
    const record = (version: number): void => {
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)').run(version, new Date().toISOString());
      applied.add(version);
    };
    // 早期测试版数据库可能只记录了迁移号，却缺失部分 v1 基础表。
    // v1 DDL 全部可幂等执行，先自愈基础结构再应用后续迁移。
    for (const stmt of SCHEMA_V1) db.exec(stmt);
    if (!applied.has(1)) record(1);
    if (!applied.has(2)) {
      for (const stmt of SCHEMA_V2) db.exec(stmt);
      record(2);
    }
    if (!applied.has(3)) {
      for (const stmt of SCHEMA_V3) db.exec(stmt);
      record(3);
    }
    if (!applied.has(4)) {
      for (const stmt of SCHEMA_V4) db.exec(stmt);
      record(4);
    }
    if (!applied.has(5)) {
      for (const stmt of SCHEMA_V5) db.exec(stmt);
      record(5);
    }
    if (!applied.has(6)) {
      for (const stmt of SCHEMA_V6) db.exec(stmt);
      record(6);
    }
    if (!applied.has(7)) {
      for (const stmt of SCHEMA_V7) db.exec(stmt);
      record(7);
    }
    if (!applied.has(8)) {
      addColumnIfMissing(db, 'tasks', 'full_name', 'full_name TEXT');
      addColumnIfMissing(db, 'tasks', 'short_name', 'short_name TEXT');
      addColumnIfMissing(db, 'tasks', 'short_name_needs_review', 'short_name_needs_review INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'tasks', 'workflow_template_id', 'workflow_template_id TEXT');
      addColumnIfMissing(db, 'tasks', 'workflow_template_version', 'workflow_template_version INTEGER');
      for (const stmt of SCHEMA_V8) db.exec(stmt);
      record(8);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
