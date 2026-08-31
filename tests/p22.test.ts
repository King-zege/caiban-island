import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppCommandService } from '../src/main/appCommandService';
import { AppService } from '../src/main/appService';
import { migrate, openDatabase } from '../src/main/db';

const dirs: string[] = [];
const databases: Array<{ close(): void }> = [];

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-p22-'));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  databases.push(db);
  const app = new AppService(db, dir);
  return { db, app, commands: new AppCommandService(app) };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('P22 双名称、判别类型与通用提案', () => {
  it('兼容 create_task，但正式数据统一写入 procurement 并保留长全名', () => {
    const { app } = fresh();
    const fullName = '二〇二六年度总部办公设备及信息化终端框架协议采购项目第一标段';
    const task = app.createTask({ kind: 'task', name: fullName, description: '', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    expect(task.kind).toBe('procurement');
    expect(task.fullName).toBe(fullName);
    expect([...task.shortName].length).toBeLessThanOrEqual(24);
    expect(task.shortNameNeedsReview).toBe(true);
  });

  it('通用命令提案批次成功时一次批准，失败时完整回滚并保持待处理', () => {
    const { app, commands } = fresh();
    const success = app.proposals.create({
      title: '创建项目并设置名称',
      commands: [{ name: 'create_task', input: { kind: 'procurement', name: '电脑框采', fullName: '总部办公电脑框架协议采购项目', shortName: '电脑框采', description: '', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' } }]
    });
    const approved = app.proposals.approve(success.id, (command) => commands.execute(command));
    expect(approved.proposal.state).toBe('approved');
    expect(app.tasks.listActive()).toHaveLength(1);

    const failed = app.proposals.create({
      title: '应回滚的批次',
      commands: [
        { name: 'create_task', input: { kind: 'procurement', name: '回滚项目', fullName: '应当回滚的采购项目', shortName: '回滚项目', description: '', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' } },
        { name: 'complete_task', input: { taskId: 'missing-task' } }
      ]
    });
    expect(() => app.proposals.approve(failed.id, (command) => commands.execute(command))).toThrow('任务不存在');
    expect(app.proposals.get(failed.id).state).toBe('pending');
    expect(app.tasks.listActive().some((card) => card.task.shortName === '回滚项目')).toBe(false);
  });

  it('migration v12 将 pending 遗留草稿转换为可批准提案并删除旧表', () => {
    const { db, app, commands } = fresh();
    const payload = {
      type: 'task',
      taskInput: { kind: 'misc', name: '提交报销', note: '附上发票', remindAtUtc: '2099-09-01T08:30:00.000Z', tzId: 'Asia/Shanghai' },
      nodes: [], warnings: ['核对金额']
    };
    db.exec(`
      CREATE TABLE drafts(id TEXT PRIMARY KEY, source TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, session_id TEXT);
      CREATE INDEX drafts_session_state_created ON drafts(session_id, state, created_at);
      DELETE FROM schema_migrations WHERE version = 12;
    `);
    db.prepare("INSERT INTO drafts(id,source,payload,state,created_at,session_id) VALUES('legacy-misc','pi',?,'pending','2026-01-01',NULL)").run(JSON.stringify(payload));

    migrate(db);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drafts'").get()).toBeUndefined();
    const proposal = app.proposals.get('legacy-misc');
    expect(proposal).toMatchObject({ kind: 'legacy_draft', state: 'pending', payload: { warnings: ['核对金额'] } });
    app.proposals.approve(proposal.id, (command) => commands.execute(command));
    expect(app.tasks.listActive()[0].task).toMatchObject({ kind: 'misc', shortName: '提交报销' });
  });

  it('正式名称和简称使用独立乐观前置值更新', () => {
    const { app } = fresh();
    const task = app.createTask({ kind: 'procurement', name: '设备采购', fullName: '设备采购项目正式名称', shortName: '设备采购', description: '', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const changed = app.setTaskNames({ taskId: task.id, fullName: '设备采购项目正式名称（修订）', shortName: '设备采购二期', expectedFullName: task.fullName, expectedShortName: task.shortName });
    expect(changed).toMatchObject({ name: '设备采购二期', fullName: '设备采购项目正式名称（修订）', shortName: '设备采购二期' });
    expect(() => app.setTaskNames({ taskId: task.id, fullName: '再次修改', shortName: '设备采购', expectedFullName: task.fullName, expectedShortName: task.shortName })).toThrow('项目名称已变化');
  });
});
