import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AppCommand, AppCommandResult } from '../shared/appCommandContracts';
import { parseAppCommand } from '../shared/appCommandContracts';
import type {
  AgentProposal,
  AgentProposalApprovalResult,
  AgentProposalCreateRequest,
  AgentProposalPayload
} from '../shared/agentProposalContracts';

export class AgentProposalError extends Error {}

function parsePayload(value: string): AgentProposalPayload {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.commands) || !Array.isArray(record.warnings) || !record.warnings.every((item) => typeof item === 'string')) throw new Error();
    return { commands: record.commands.map(parseAppCommand), warnings: record.warnings };
  } catch {
    throw new AgentProposalError('提案数据损坏');
  }
}

function toProposal(row: Record<string, unknown>): AgentProposal {
  return {
    id: String(row.id),
    sessionId: row.session_id === null ? null : String(row.session_id),
    kind: String(row.kind) as AgentProposal['kind'],
    title: String(row.title),
    summary: String(row.summary),
    payload: parsePayload(String(row.payload)),
    state: String(row.state) as AgentProposal['state'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class AgentProposalService {
  constructor(private readonly db: DatabaseSync) {}

  create(request: AgentProposalCreateRequest): AgentProposal {
    const title = request.title.trim();
    if (!title || title.length > 200) throw new AgentProposalError('提案标题必须为 1–200 个字符');
    if (request.commands.length === 0 || request.commands.length > 50) throw new AgentProposalError('提案必须包含 1–50 条命令');
    const commands = request.commands.map((command) => parseAppCommand(command));
    const sessionId = request.sessionId ?? null;
    if (sessionId && !this.db.prepare('SELECT id FROM agent_sessions WHERE id = ?').get(sessionId)) {
      throw new AgentProposalError('Agent 会话不存在');
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const payload: AgentProposalPayload = { commands, warnings: (request.warnings ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 20) };
    this.db.prepare(
      `INSERT INTO agent_proposals(id, session_id, kind, title, summary, payload, state, created_at, updated_at)
       VALUES(?,?,?,?,?,?,'pending',?,?)`
    ).run(id, sessionId, 'command_batch', title, (request.summary ?? '').trim(), JSON.stringify(payload), now, now);
    return this.get(id);
  }

  listPending(sessionId?: string): AgentProposal[] {
    const rows = (sessionId
      ? this.db.prepare("SELECT * FROM agent_proposals WHERE state='pending' AND session_id=? ORDER BY created_at, id").all(sessionId)
      : this.db.prepare("SELECT * FROM agent_proposals WHERE state='pending' ORDER BY created_at, id").all()) as unknown as Record<string, unknown>[];
    return rows.map(toProposal);
  }

  get(id: string): AgentProposal {
    const row = this.db.prepare('SELECT * FROM agent_proposals WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AgentProposalError('提案不存在');
    return toProposal(row);
  }

  discard(id: string): AgentProposal {
    const now = new Date().toISOString();
    const result = this.db.prepare("UPDATE agent_proposals SET state='discarded', updated_at=? WHERE id=? AND state='pending'").run(now, id);
    if (result.changes !== 1) throw new AgentProposalError('提案不存在或已处理');
    return this.get(id);
  }

  approve(id: string, execute: (command: AppCommand) => AppCommandResult): AgentProposalApprovalResult {
    const proposal = this.get(id);
    if (proposal.state !== 'pending') throw new AgentProposalError('提案已处理');
    if (proposal.payload.commands.length === 0) throw new AgentProposalError('提案没有可执行命令，只能丢弃');
    this.db.exec('BEGIN');
    try {
      const results = proposal.payload.commands.map(execute);
      const now = new Date().toISOString();
      const changed = this.db.prepare("UPDATE agent_proposals SET state='approved', updated_at=? WHERE id=? AND state='pending'").run(now, id);
      if (changed.changes !== 1) throw new AgentProposalError('提案已变化，请刷新后重试');
      this.db.exec('COMMIT');
      return { proposal: this.get(id), results };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
