import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppService } from '../src/main/appService';
import { AgentService } from '../src/main/agentService';
import { AgentNotificationTracker } from '../src/main/agentNotification';
import { AgentSessionService } from '../src/main/agentSessionService';
import { DeepSeekConfigService } from '../src/main/deepSeekConfigService';
import { migrate, openDatabase } from '../src/main/db';
import type { SafeStorageAdapter } from '../src/main/safeStorageAdapter';
import type { PiAgentRunner, PiRunOptions, PiRunResult } from '../src/main/piAgentAdapter';
import type { TaskDraftPayload } from '../src/shared/types';
import type { AgentRunEvent, AgentRunPhase, AgentRunState } from '../src/shared/types';

const dirs: string[] = [];

class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from(`enc:${value}`); }
  decryptString(value: Buffer): string { return value.toString().slice(4); }
}

class BlockingRunner implements PiAgentRunner {
  async run(options: PiRunOptions): Promise<PiRunResult> {
    return await new Promise((resolve) => options.signal.addEventListener('abort', () => resolve('cancelled'), { once: true }));
  }
}

let eventSequence = 0;
function stateEvent(sessionId: string, state: AgentRunState, phase: AgentRunPhase): AgentRunEvent {
  return { type: 'state', sessionId, state, phase, sequence: ++eventSequence, at: new Date().toISOString() };
}

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-p20-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'island.db');
  const db = openDatabase(dbPath);
  const app = new AppService(db, dir);
  const sessions = new AgentSessionService(db, dir);
  return { dir, dbPath, db, app, sessions };
}

function taskDraft(name: string): TaskDraftPayload {
  return {
    type: 'task',
    taskInput: { kind: 'task', name, description: `${name}说明`, urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' },
    nodes: [{ title: '需求确认', description: '', startUtc: null, endUtc: null }],
    warnings: []
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('P20 migration v6 与草稿会话修订', () => {
  it('从 v5 升级保留旧草稿，建立索引并在会话删除时置空', () => {
    const f = fresh();
    f.db.exec('DROP INDEX drafts_session_state_created; ALTER TABLE drafts DROP COLUMN session_id; DELETE FROM schema_migrations WHERE version >= 6;');
    f.db.prepare("INSERT INTO drafts(id, source, payload, state, created_at) VALUES('legacy','mcp',?,'pending','2026-08-01T00:00:00.000Z')").run(JSON.stringify(taskDraft('旧草稿')));
    f.db.close();

    const upgraded = openDatabase(f.dbPath);
    const app = new AppService(upgraded, f.dir);
    const sessions = new AgentSessionService(upgraded, f.dir);
    expect(app.drafts.get('legacy').sessionId).toBeNull();
    expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='drafts_session_state_created'").get()).toBeTruthy();
    const session = sessions.create('deepseek-v4-flash', '规划项目');
    const draft = app.drafts.create('pi', taskDraft('新项目'), { sessionId: session.id });
    sessions.delete(session.id);
    expect(app.drafts.get(draft.id).sessionId).toBeNull();
    migrate(upgraded);
    expect(upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 8 });
    upgraded.close();
  });

  it('迁移失败完整回滚且不会伪造 v6 记录', () => {
    const f = fresh();
    f.db.exec('DELETE FROM schema_migrations WHERE version >= 6;');
    expect(() => migrate(f.db)).toThrow();
    expect(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 5 });
  });

  it('同会话修订原子替代旧任务稿，独立提案保留；跨会话与失败修订不改变旧稿', () => {
    const f = fresh();
    const firstSession = f.sessions.create('deepseek-v4-flash', '规划一');
    const secondSession = f.sessions.create('deepseek-v4-flash', '规划二');
    const original = f.app.drafts.create('pi', taskDraft('原方案'), { sessionId: firstSession.id });
    const independent = f.app.drafts.create('pi', taskDraft('独立方案'), { sessionId: firstSession.id });
    const revised = f.app.drafts.create('pi', taskDraft('修订方案'), { sessionId: firstSession.id, replacesDraftId: original.id });

    expect(f.app.drafts.get(original.id).state).toBe('superseded');
    expect(f.app.drafts.listPending(firstSession.id).map((draft) => draft.id).sort()).toEqual([independent.id, revised.id].sort());
    expect(() => f.app.drafts.confirm(original.id)).toThrow('草稿已处理');
    expect(() => f.app.drafts.create('pi', taskDraft('越界修订'), { sessionId: secondSession.id, replacesDraftId: independent.id })).toThrow('不能替代其他会话');
    expect(f.app.drafts.get(independent.id).state).toBe('pending');
    expect(f.app.drafts.listPending(secondSession.id)).toEqual([]);
  });
});

describe('P20 归档案例与后台运行', () => {
  it('归档案例查询有界、稳定且不返回备注、链接、路径或快照内容', () => {
    const f = fresh();
    const task = f.app.createTask({ kind: 'task', name: '加油站招标', description: '公开说明 C:\\Secret\\scope.docx https://secret.example/token sk-private-secret', urgency: 'high', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    f.app.addNode(task.id, { title: '发布招标', description: '节点内部详情', startUtc: null, endUtc: null });
    f.app.saveNote(task.id, '私人备注 sk-private C:\\Secret\\bid.docx');
    f.app.addLink(task.id, { kind: 'url', title: '内部系统', target: 'https://secret.example/token' });
    f.app.completeTask(task.id);

    const cases = f.app.archive.searchCases('招标', 99);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ name: '加油站招标', outcome: 'completed', nodes: [{ title: '发布招标' }] });
    const serialized = JSON.stringify(cases);
    expect(serialized).not.toContain('私人备注');
    expect(serialized).not.toContain('secret.example');
    expect(serialized).not.toContain('C:\\Secret');
    expect(serialized).not.toContain('sk-private-secret');
    expect(serialized).not.toContain('节点内部详情');
    expect(() => f.app.archive.searchCases('', 1)).toThrow('1–200');
    expect(() => f.app.archive.searchCases('x'.repeat(201), 1)).toThrow('1–200');
  });

  it('页面隐藏不影响全局 run，快照可恢复；只有显式取消才中止', async () => {
    const f = fresh();
    const deepSeek = new DeepSeekConfigService(f.app.settings, new FakeSafeStorage());
    deepSeek.save('deepseek-v4-flash', 'test-only-key');
    const service = new AgentService(f.app, f.sessions, deepSeek, () => undefined, new BlockingRunner());
    const started = service.start({ input: '规划加油站招标' });
    service.setSurfaceVisible(false);
    expect(service.runSnapshot()).toMatchObject({ sessionId: started.session.id, state: 'running' });
    service.setSurfaceVisible(true);
    expect(service.runSnapshot().state).toBe('running');
    expect(service.cancel()).toBe(true);
    expect(service.runSnapshot().state).toBe('cancelling');
    await service.waitForIdle();
    expect(service.runSnapshot()).toMatchObject({ sessionId: started.session.id, state: 'cancelled', phase: 'cancelled' });
  });

  it('仅后台完成生成通用通知，同一 run 不重复且新一轮可重新通知', () => {
    const tracker = new AgentNotificationTracker();
    tracker.handle(stateEvent('s1', 'running', 'connecting'), false);
    expect(tracker.handle(stateEvent('s1', 'completed', 'completed'), true)).toBeNull();
    expect(tracker.handle(stateEvent('s1', 'completed', 'completed'), false)).toBeNull();
    tracker.handle(stateEvent('s2', 'running', 'connecting'), false);
    tracker.handle({ type: 'tool_end', sessionId: 's2', toolCallId: 't1', toolName: 'execute_app_command', isError: false, draftId: 'draft-1', sequence: ++eventSequence, at: new Date().toISOString() }, false);
    const notice = tracker.handle(stateEvent('s2', 'completed', 'completed'), false);
    expect(notice).toEqual({ attention: { sessionId: 's2', draftId: 'draft-1', memoryProposalId: undefined }, body: 'Agent 待确认操作已生成，点击查看' });
    expect(JSON.stringify(notice)).not.toContain('加油站');
    expect(tracker.handle(stateEvent('s2', 'completed', 'completed'), false)).toBeNull();
    tracker.handle(stateEvent('s2', 'running', 'connecting'), false);
    expect(tracker.handle(stateEvent('s2', 'completed', 'completed'), false)?.body).toBe('Agent 已完成回复，点击查看');
  });
});
