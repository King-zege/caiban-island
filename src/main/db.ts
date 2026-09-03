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

const SCHEMA_V9 = [
  "UPDATE nodes SET source = 'custom' WHERE source IS NULL OR trim(source) = ''",
  'CREATE INDEX IF NOT EXISTS nodes_task_stage ON nodes(task_id, stage_key, position)',
  `CREATE TABLE IF NOT EXISTS contracts(
    id TEXT PRIMARY KEY,
    procurement_project_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    contract_no TEXT NOT NULL DEFAULT '',
    supplier_name TEXT NOT NULL DEFAULT '',
    amount_minor INTEGER CHECK(amount_minor IS NULL OR amount_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'CNY',
    signed_on TEXT,
    effective_on TEXT,
    expires_on TEXT,
    tz_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','active','closing','closed','terminated','archived')),
    archived_from_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS contracts_project_status ON contracts(procurement_project_id, status, updated_at)',
  'CREATE INDEX IF NOT EXISTS contracts_status_expiry ON contracts(status, expires_on)',
  `CREATE TABLE IF NOT EXISTS contract_actions(
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('payment','invoice','delivery','acceptance','renewal','expiry','archive','custom')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_at_utc TEXT,
    amount_minor INTEGER CHECK(amount_minor IS NULL OR amount_minor >= 0),
    related_action_id TEXT REFERENCES contract_actions(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','waived')),
    position INTEGER NOT NULL,
    completed_at_utc TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS contract_actions_contract_order ON contract_actions(contract_id, position, id)',
  'CREATE INDEX IF NOT EXISTS contract_actions_due ON contract_actions(status, due_at_utc)',
  `CREATE TABLE IF NOT EXISTS contract_action_reminders(
    action_id TEXT PRIMARY KEY REFERENCES contract_actions(id) ON DELETE CASCADE,
    fire_at_utc TEXT NOT NULL,
    fired INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS contract_action_reminders_due ON contract_action_reminders(fired, fire_at_utc)',
  `CREATE TABLE IF NOT EXISTS contract_links(
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('url','file')),
    title TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS contract_notes(
    contract_id TEXT PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contract_change_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id TEXT NOT NULL,
    at_utc TEXT NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '{}'
  )`
];

const SCHEMA_V10 = [
  `CREATE TABLE IF NOT EXISTS knowledge_scans(
    id TEXT PRIMARY KEY,
    directory_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','completed','cancelled','failed')),
    total_files INTEGER NOT NULL DEFAULT 0,
    indexed_files INTEGER NOT NULL DEFAULT 0,
    metadata_only_files INTEGER NOT NULL DEFAULT 0,
    skipped_files INTEGER NOT NULL DEFAULT 0,
    failed_files INTEGER NOT NULL DEFAULT 0,
    removed_files INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error_category TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS knowledge_scans_directory_started ON knowledge_scans(directory_id, started_at DESC)',
  `CREATE TABLE IF NOT EXISTS knowledge_sources(
    id TEXT PRIMARY KEY,
    directory_id TEXT NOT NULL,
    relative_path TEXT NOT NULL COLLATE NOCASE,
    file_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_at_utc TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    extract_state TEXT NOT NULL CHECK(extract_state IN ('indexed','metadata_only','skipped','failed')),
    skip_reason TEXT,
    project_candidate TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(directory_id, relative_path)
  )`,
  'CREATE INDEX IF NOT EXISTS knowledge_sources_directory_state ON knowledge_sources(directory_id, extract_state, relative_path)',
  `CREATE TABLE IF NOT EXISTS knowledge_chunks(
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    locator TEXT NOT NULL,
    locator_kind TEXT NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    UNIQUE(source_id, ordinal)
  )`,
  'CREATE INDEX IF NOT EXISTS knowledge_chunks_source_order ON knowledge_chunks(source_id, ordinal)',
  "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(text, content='knowledge_chunks', content_rowid='rowid', tokenize='unicode61')",
  `CREATE TRIGGER IF NOT EXISTS knowledge_chunks_fts_insert AFTER INSERT ON knowledge_chunks BEGIN
    INSERT INTO knowledge_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS knowledge_chunks_fts_delete AFTER DELETE ON knowledge_chunks BEGIN
    INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS knowledge_chunks_fts_update AFTER UPDATE OF text ON knowledge_chunks BEGIN
    INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO knowledge_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
  END`,
  `CREATE TABLE IF NOT EXISTS workspace_project_bindings(
    id TEXT PRIMARY KEY,
    directory_id TEXT NOT NULL,
    relative_root TEXT NOT NULL COLLATE NOCASE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(directory_id, relative_root),
    UNIQUE(directory_id, task_id)
  )`
];

const SCHEMA_V11 = [
  `CREATE TABLE IF NOT EXISTS agent_automations(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('once','daily','weekly')),
    time_zone TEXT NOT NULL,
    local_time TEXT NOT NULL,
    weekdays_json TEXT NOT NULL DEFAULT '[]',
    run_at_utc TEXT,
    next_run_at_utc TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_default_daily_briefing INTEGER NOT NULL DEFAULT 0,
    last_failure TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS agent_automations_default_daily ON agent_automations(is_default_daily_briefing) WHERE is_default_daily_briefing=1',
  'CREATE INDEX IF NOT EXISTS agent_automations_due ON agent_automations(enabled,next_run_at_utc)',
  `CREATE TABLE IF NOT EXISTS automation_runs(
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL REFERENCES agent_automations(id) ON DELETE CASCADE,
    scheduled_for_utc TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_approval','succeeded','failed','skipped')),
    session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
    output_relative_path TEXT,
    approval_required INTEGER NOT NULL DEFAULT 0,
    error_category TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE(automation_id,scheduled_for_utc)
  )`,
  'CREATE INDEX IF NOT EXISTS automation_runs_status_created ON automation_runs(status,created_at)'
];

const SCHEMA_V13 = [
  `CREATE TABLE IF NOT EXISTS feishu_agent_users(
    open_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    paired_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS feishu_agent_users_active ON feishu_agent_users(revoked_at,paired_at)',
  `CREATE TABLE IF NOT EXISTS feishu_agent_chats(
    chat_id TEXT PRIMARY KEY,
    chat_type TEXT NOT NULL CHECK(chat_type IN ('p2p','group')),
    session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feishu_agent_events(
    event_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('message','card_action')),
    chat_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    processed_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS feishu_agent_events_processed ON feishu_agent_events(processed_at)'
];

function convertLegacyDraft(raw: string): { commands: unknown[]; warnings: string[]; title: string } {
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter((item): item is string => typeof item === 'string') : [];
    if (payload.type === 'task' && payload.taskInput && typeof payload.taskInput === 'object') {
      const input = payload.taskInput as Record<string, unknown>;
      if (input.kind === 'misc') return { title: `迁移杂事方案 · ${String(input.name ?? '')}`, warnings, commands: [{ name: 'create_task', input }] };
      const name = String(input.fullName ?? input.name ?? '').trim();
      const shortName = String(input.shortName ?? input.name ?? '').trim().slice(0, 24);
      const nodes = Array.isArray(payload.nodes) ? payload.nodes.map((node) => ({ ...(node as Record<string, unknown>), source: 'custom' })) : [];
      return { title: `迁移采购方案 · ${shortName || name}`, warnings, commands: [{ name: 'create_procurement_project', input: {
        fullName: name, shortName: shortName || name.slice(0, 24), description: String(input.description ?? ''), urgency: input.urgency ?? 'normal',
        deadlineUtc: input.deadlineUtc ?? null, tzId: String(input.tzId ?? 'Asia/Shanghai'), procurementMethod: 'custom', templateId: null, nodes
      } }] };
    }
    if (payload.type === 'nodes' && typeof payload.taskId === 'string' && Array.isArray(payload.nodes)) {
      return { title: '迁移节点方案', warnings, commands: payload.nodes.map((node) => ({ name: 'add_node', input: { taskId: payload.taskId, node: { ...(node as Record<string, unknown>), source: 'custom' } } })) };
    }
    if (payload.type === 'action' && typeof payload.taskId === 'string' && payload.action && typeof payload.action === 'object') {
      const action = payload.action as Record<string, unknown>; let command: unknown = null;
      if (action.kind === 'set_node_status') command = { name: 'set_node_status', input: { nodeId: action.nodeId, status: action.after } };
      if (action.kind === 'set_reminders') command = { name: 'set_reminders', input: { taskId: payload.taskId, offsets: action.after } };
      if (action.kind === 'add_node') command = { name: 'add_node', input: { taskId: payload.taskId, node: action.input } };
      if (action.kind === 'update_node') command = { name: 'update_node', input: { nodeId: action.nodeId, node: action.after } };
      if (action.kind === 'delete_node') command = { name: 'remove_node', input: { nodeId: (action.before as Record<string, unknown> | undefined)?.id } };
      if (action.kind === 'reorder_nodes') command = { name: 'reorder_nodes', input: { taskId: payload.taskId, orderedNodeIds: action.after } };
      return { title: `迁移操作方案 · ${String(payload.summary ?? action.kind ?? '')}`, warnings, commands: command ? [command] : [] };
    }
    return { title: '无法自动转换的遗留方案', commands: [], warnings: [...warnings, '原草稿格式无法转换，请丢弃并重新提出需求'] };
  } catch {
    return { title: '损坏的遗留方案', commands: [], warnings: ['原草稿数据损坏，请丢弃并重新提出需求'] };
  }
}

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
    if (!applied.has(9)) {
      addColumnIfMissing(db, 'tasks', 'procurement_method', 'procurement_method TEXT');
      addColumnIfMissing(db, 'nodes', 'stage_key', 'stage_key TEXT');
      addColumnIfMissing(db, 'nodes', 'source', "source TEXT NOT NULL DEFAULT 'custom'");
      for (const stmt of SCHEMA_V9) db.exec(stmt);
      record(9);
    }
    if (!applied.has(10)) {
      for (const stmt of SCHEMA_V10) db.exec(stmt);
      record(10);
    }
    if (!applied.has(11)) {
      for (const stmt of SCHEMA_V11) db.exec(stmt);
      record(11);
    }
    if (!applied.has(12)) {
      const legacyRows = db.prepare("SELECT id,session_id,payload,created_at FROM drafts WHERE state='pending'").all() as unknown as Array<{ id: string; session_id: string | null; payload: string; created_at: string }>;
      const upsert = db.prepare(`INSERT INTO agent_proposals(id,session_id,kind,title,summary,payload,state,created_at,updated_at)
        VALUES(?,?,'legacy_draft',?,'由旧草稿迁移；批准前不会写入正式数据',?,'pending',?,?)
        ON CONFLICT(id) DO UPDATE SET kind='legacy_draft',title=excluded.title,summary=excluded.summary,payload=excluded.payload,state='pending',updated_at=excluded.updated_at`);
      for (const row of legacyRows) {
        const converted = convertLegacyDraft(row.payload);
        upsert.run(row.id, row.session_id, converted.title, JSON.stringify({ commands: converted.commands, warnings: converted.warnings }), row.created_at, new Date().toISOString());
      }
      db.exec('DROP INDEX IF EXISTS drafts_session_state_created');
      db.exec('DROP TABLE drafts');
      record(12);
    }
    if (!applied.has(13)) {
      for (const stmt of SCHEMA_V13) db.exec(stmt);
      record(13);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
