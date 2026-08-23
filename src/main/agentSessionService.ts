import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type {
  AgentMessageDto,
  AgentMessageRole,
  AgentSessionDetail,
  AgentSessionSummary,
  DeepSeekModel,
  SessionSearchMatch
} from '../shared/agentContracts';

export class AgentSessionError extends Error {}

interface SessionRow {
  id: string;
  title: string;
  model: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  inputTokens: number;
  outputTokens: number;
}

interface MessageRow {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  toolName: string | null;
  createdAt: string;
}

function sessionFromRow(row: SessionRow): AgentSessionSummary {
  return { ...row, model: row.model as DeepSeekModel };
}

function messageFromRow(row: MessageRow): AgentMessageDto {
  return { ...row, role: row.role as AgentMessageRole };
}

export class AgentSessionService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly dataDir: string
  ) {}

  create(model: DeepSeekModel, firstInput: string): AgentSessionSummary {
    const now = new Date().toISOString();
    const title = firstInput.trim().replace(/\s+/g, ' ').slice(0, 36) || '新对话';
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO agent_sessions(id, title, model, summary, created_at, updated_at) VALUES(?,?,?,?,?,?)')
      .run(id, title, model, '', now, now);
    return this.getSummary(id);
  }

  list(): AgentSessionSummary[] {
    const rows = this.db.prepare(
      `SELECT id, title, model, summary, created_at AS createdAt, updated_at AS updatedAt,
              input_tokens AS inputTokens, output_tokens AS outputTokens
       FROM agent_sessions ORDER BY updated_at DESC, id DESC`
    ).all() as unknown as SessionRow[];
    return rows.map(sessionFromRow);
  }

  get(id: string): AgentSessionDetail {
    const session = this.getSummary(id);
    const rows = this.db.prepare(
      `SELECT id, session_id AS sessionId, role, content, tool_name AS toolName, created_at AS createdAt
       FROM agent_messages WHERE session_id = ? ORDER BY sequence, id`
    ).all(id) as unknown as MessageRow[];
    return { session, messages: rows.map(messageFromRow) };
  }

  append(sessionId: string, role: AgentMessageRole, content: string, toolName: string | null = null): AgentMessageDto {
    this.getSummary(sessionId);
    const now = new Date().toISOString();
    const message: AgentMessageDto = { id: randomUUID(), sessionId, role, content, toolName, createdAt: now };
    this.db.exec('BEGIN');
    try {
      const row = this.db.prepare('SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM agent_messages WHERE session_id = ?').get(sessionId) as { sequence: number };
      this.db.prepare('INSERT INTO agent_messages(id, session_id, role, content, tool_name, sequence, created_at) VALUES(?,?,?,?,?,?,?)')
        .run(message.id, sessionId, role, content, toolName, row.sequence, now);
      this.db.prepare('UPDATE agent_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
      this.updateSummary(sessionId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return message;
  }

  addUsage(sessionId: string, inputTokens: number, outputTokens: number): void {
    const safeInput = Number.isFinite(inputTokens) ? Math.max(0, Math.trunc(inputTokens)) : 0;
    const safeOutput = Number.isFinite(outputTokens) ? Math.max(0, Math.trunc(outputTokens)) : 0;
    this.db.prepare(
      'UPDATE agent_sessions SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?'
    ).run(safeInput, safeOutput, sessionId);
  }

  delete(id: string): void {
    const result = this.db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id);
    if (result.changes === 0) throw new AgentSessionError('会话不存在');
  }

  clear(): number {
    const result = this.db.prepare('DELETE FROM agent_sessions').run();
    return Number(result.changes);
  }

  search(rawQuery: string, rawLimit = 5): SessionSearchMatch[] {
    if (rawQuery.length > 200) throw new AgentSessionError('会话搜索词不能超过 200 字符');
    const terms = rawQuery.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu)?.slice(0, 8) ?? [];
    if (terms.length === 0) throw new AgentSessionError('请输入有效的会话搜索词');
    const query = [...new Set(terms)].map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ');
    const limit = Math.min(8, Math.max(1, Math.trunc(rawLimit)));
    const matches = this.db.prepare(
      `SELECT m.session_id AS sessionId, m.sequence,
              snippet(agent_messages_fts, 0, '【', '】', '…', 18) AS matchExcerpt,
              s.title, s.summary
       FROM agent_messages_fts
       JOIN agent_messages m ON m.rowid = agent_messages_fts.rowid
       JOIN agent_sessions s ON s.id = m.session_id
       WHERE agent_messages_fts MATCH ? AND m.role IN ('user','assistant')
       ORDER BY bm25(agent_messages_fts), s.updated_at DESC
       LIMIT ?`
    ).all(query, limit) as unknown as Array<{ sessionId: string; sequence: number; matchExcerpt: string; title: string; summary: string }>;
    return matches.map((match) => {
      const edges = this.db.prepare(
        `SELECT
          (SELECT content FROM agent_messages WHERE session_id = ? AND role IN ('user','assistant') ORDER BY sequence, id LIMIT 1) AS firstExcerpt,
          (SELECT content FROM agent_messages WHERE session_id = ? AND role IN ('user','assistant') ORDER BY sequence DESC, id DESC LIMIT 1) AS lastExcerpt`
      ).get(match.sessionId, match.sessionId) as { firstExcerpt: string; lastExcerpt: string };
      const nearby = this.db.prepare(
        `SELECT role, content, sequence FROM agent_messages
         WHERE session_id = ? AND role IN ('user','assistant')
         ORDER BY ABS(sequence - ?), sequence LIMIT 3`
      ).all(match.sessionId, match.sequence) as unknown as Array<{ role: 'user' | 'assistant'; content: string; sequence: number }>;
      nearby.sort((a, b) => a.sequence - b.sequence);
      return {
        sessionId: match.sessionId,
        title: match.title,
        summary: match.summary.slice(0, 760),
        firstExcerpt: edges.firstExcerpt.slice(0, 240),
        lastExcerpt: edges.lastExcerpt.slice(0, 240),
        matchExcerpt: match.matchExcerpt.slice(0, 320),
        context: nearby.map(({ role, content }) => ({ role, content: content.slice(0, 260) }))
      };
    });
  }

  export(id: string, format: 'json' | 'markdown'): string {
    const detail = this.get(id);
    const dir = path.join(this.dataDir, 'export');
    mkdirSync(dir, { recursive: true });
    const extension = format === 'json' ? 'json' : 'md';
    const target = path.join(dir, 'agent-session-' + id.slice(0, 8) + '.' + extension);
    if (format === 'json') {
      writeFileSync(target, JSON.stringify({ formatVersion: 1, exportedAt: new Date().toISOString(), ...detail }, null, 2), 'utf8');
    } else {
      const lines = ['# ' + detail.session.title, '', '- 模型：' + detail.session.model, '- 更新时间：' + detail.session.updatedAt, ''];
      for (const message of detail.messages) {
        const label = message.role === 'user' ? '用户' : message.role === 'assistant' ? 'Agent' : '工具状态';
        lines.push('## ' + label, '', message.content, '');
      }
      writeFileSync(target, lines.join('\n'), 'utf8');
    }
    return target;
  }

  private getSummary(id: string): AgentSessionSummary {
    const row = this.db.prepare(
      `SELECT id, title, model, summary, created_at AS createdAt, updated_at AS updatedAt,
              input_tokens AS inputTokens, output_tokens AS outputTokens
       FROM agent_sessions WHERE id = ?`
    ).get(id) as SessionRow | undefined;
    if (!row) throw new AgentSessionError('会话不存在');
    return sessionFromRow(row);
  }

  private updateSummary(sessionId: string): void {
    const rows = this.db.prepare(
      "SELECT role, content FROM agent_messages WHERE session_id = ? AND role IN ('user','assistant') ORDER BY sequence, id"
    ).all(sessionId) as unknown as Array<{ role: string; content: string }>;
    if (rows.length < 12) return;
    const first = rows.slice(0, 4).map((row) => row.content.replace(/\s+/g, ' ').slice(0, 90)).join('；');
    const last = rows.slice(-4).map((row) => row.content.replace(/\s+/g, ' ').slice(0, 90)).join('；');
    this.db.prepare('UPDATE agent_sessions SET summary = ? WHERE id = ?').run((first + ' … ' + last).slice(0, 760), sessionId);
  }
}
