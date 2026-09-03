import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentPermissionService } from '../src/main/agentPermissionService';
import { AgentSessionService } from '../src/main/agentSessionService';
import { AppService } from '../src/main/appService';
import { AutomationService, nextAutomationOccurrence, renderDailyBriefingHtml } from '../src/main/automationService';
import { openDatabase } from '../src/main/db';
import type { DeepSeekConfigService } from '../src/main/deepSeekConfigService';
import { KnowledgeService } from '../src/main/knowledgeService';

const roots: string[] = []; const databases: Array<{ close(): void }> = [];

async function fixture(mode: 'confirm_all' | 'auto_reversible' = 'auto_reversible', busy = () => false) {
  const root = mkdtempSync(path.join(tmpdir(), 'caiban-p26-')); roots.push(root);
  const data = path.join(root, 'data'); const workspace = path.join(root, 'workspace');
  const fs = await import('node:fs/promises'); await fs.mkdir(data); await fs.mkdir(workspace);
  const db = openDatabase(path.join(data, 'island.db')); databases.push(db);
  const app = new AppService(db, data); const permissions = new AgentPermissionService(app.settings);
  const directory = permissions.addDirectory(workspace).authorizedDirectories[0]; permissions.setPrimaryDirectory(directory.id); permissions.setMode(mode);
  const knowledge = new KnowledgeService(db, permissions); await knowledge.ensureAgentDirectory();
  const sessions = new AgentSessionService(db, data);
  const deepSeek = { model: () => 'deepseek-v4-flash' as const, status: () => ({ configured: false, baseUrl: 'https://api.deepseek.com' as const, model: 'deepseek-v4-flash' as const }) } as DeepSeekConfigService;
  const notifications: string[] = [];
  const automation = new AutomationService(db, permissions, knowledge, sessions, deepSeek, async () => Buffer.from('%PDF-1.4\nsynthetic'), busy, (run) => notifications.push(run.status));
  return { root, data, workspace, db, app, permissions, knowledge, sessions, automation, notifications };
}

afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('P26 Agent 自动化与每日工作清单', () => {
  it('migration v11 建立自动化、防重运行和到时索引', async () => {
    const f = await fixture();
    expect(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 13 });
    expect((f.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('agent_automations','automation_runs')").get() as { count: number }).count).toBe(2);
  });

  it('每日/每周/一次性计划按 IANA 时区处理 DST，不接受原始 cron', () => {
    const skipped = nextAutomationOccurrence({ scheduleKind: 'daily', timeZone: 'America/New_York', localTime: '02:30', weekdays: [], runAtUtc: null }, new Date('2026-03-08T05:00:00.000Z'));
    expect(skipped).toBe('2026-03-09T06:30:00.000Z');
    const repeated = nextAutomationOccurrence({ scheduleKind: 'daily', timeZone: 'America/New_York', localTime: '01:30', weekdays: [], runAtUtc: null }, new Date('2026-11-01T04:00:00.000Z'));
    expect(repeated).toMatch(/^2026-11-01T0[56]:30:00\.000Z$/);
    const weekly = nextAutomationOccurrence({ scheduleKind: 'weekly', timeZone: 'Asia/Shanghai', localTime: '09:00', weekdays: [1], runAtUtc: null }, new Date('2026-08-30T00:00:00.000Z'));
    expect(weekly).toBe('2026-08-31T01:00:00.000Z');
  });

  it('首次主目录创建 09:00 默认 heartbeat，同一触发时间只运行一次并生成会话/PDF', async () => {
    const f = await fixture(); const now = new Date('2026-08-30T02:00:00.000Z');
    const daily = f.automation.ensureDefault(now); expect(daily?.localTime).toBe('09:00');
    f.db.prepare('UPDATE agent_automations SET next_run_at_utc=? WHERE id=?').run('2026-08-30T01:00:00.000Z', daily!.id);
    await f.automation.tick(now); await f.automation.tick(now);
    const runs = f.automation.listRuns(); expect(runs).toHaveLength(1); expect(runs[0]).toMatchObject({ status: 'succeeded', approvalRequired: false });
    expect(f.sessions.list()[0].title).toBe('每日工作清单 · 2026-08-30');
    const pdf = path.join(f.workspace, ...(runs[0].outputRelativePath ?? '').split('/'));
    expect(existsSync(pdf)).toBe(true); expect(readFileSync(pdf).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('每次确认模式跨重启保持 waiting_approval，批准后才写生成物', async () => {
    const f = await fixture('confirm_all'); const daily = f.automation.ensureDefault(new Date('2026-08-30T02:00:00.000Z'))!;
    f.db.prepare('UPDATE agent_automations SET next_run_at_utc=? WHERE id=?').run('2026-08-30T01:00:00.000Z', daily.id);
    await f.automation.tick(new Date('2026-08-30T02:00:00.000Z'));
    expect(f.automation.listRuns()[0].status).toBe('waiting_approval'); expect(f.sessions.list()).toHaveLength(0);
    const resumed = new AutomationService(f.db, f.permissions, f.knowledge, f.sessions, { model: () => 'deepseek-v4-flash' } as DeepSeekConfigService, async () => Buffer.from('%PDF-resumed'));
    resumed.approveRun(f.automation.listRuns()[0].id);
    for (let pass = 0; pass < 20 && resumed.listRuns()[0].status !== 'succeeded'; pass += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resumed.listRuns()[0].status).toBe('succeeded');
  });

  it('交互式 Agent 优先，自动化保持持久 queued 并在空闲后执行', async () => {
    let busy = true; const f = await fixture('auto_reversible', () => busy); const daily = f.automation.ensureDefault(new Date('2026-08-30T02:00:00.000Z'))!;
    f.db.prepare('UPDATE agent_automations SET next_run_at_utc=? WHERE id=?').run('2026-08-30T01:00:00.000Z', daily.id);
    await f.automation.tick(new Date('2026-08-30T02:00:00.000Z')); expect(f.automation.listRuns()[0].status).toBe('queued');
    busy = false; await f.automation.tick(new Date('2026-08-30T02:01:00.000Z')); expect(f.automation.listRuns()[0].status).toBe('succeeded');
  });

  it('确定性清单汇总逾期、今日和未来七日，包含来源且 HTML 转义内容', async () => {
    const f = await fixture();
    f.app.createTask({ kind: 'misc', name: '<待确认发票>', note: '联系供应商', remindAtUtc: '2099-08-30T03:00:00.000Z', tzId: 'Asia/Shanghai' });
    const project = f.app.createProcurementProject({ fullName: '办公设备采购', shortName: '设备采购', description: '', urgency: 'normal', deadlineUtc: '2099-08-29T00:00:00.000Z', tzId: 'Asia/Shanghai', procurementMethod: 'inquiry', templateId: null }).project;
    f.app.addNode(project.id, { title: '组织开标', description: '', startUtc: '2099-09-02T01:00:00.000Z', endUtc: null });
    const contract = f.app.createContract({ procurementProjectId: project.id, fullName: '设备供货合同', shortName: '供货合同', contractNo: 'HT-1', supplierName: '合成供应商', amountMinor: 100, currency: 'CNY', signedOn: null, effectiveOn: null, expiresOn: null, tzId: 'Asia/Shanghai', status: 'active' });
    f.app.addContractAction(contract.id, { type: 'payment', title: '支付首款', description: '', dueAtUtc: '2099-08-30T05:00:00.000Z', amountMinor: 50, relatedActionId: null });
    const document = f.automation.briefing(new Date('2099-08-30T02:00:00.000Z'), 'Asia/Shanghai');
    expect(document.overdue.map((item) => item.domain)).toContain('采购');
    expect(document.today.map((item) => item.domain)).toEqual(expect.arrayContaining(['合同', '杂事']));
    expect(document.nextSevenDays[0].source.label).toContain('组织开标');
    expect(document.agentAnalysisGenerated).toBe(false);
    const html = renderDailyBriefingHtml(document); expect(html).toContain('&lt;待确认发票&gt;'); expect(html).not.toContain('<待确认发票>');
  });

  it('通用自动化没有安全执行器时明确失败，全局开关可暂停调度', async () => {
    const f = await fixture();
    const custom = f.automation.create({ name: '周报', prompt: '生成周报', scheduleKind: 'once', timeZone: 'Asia/Shanghai', localTime: '09:00', weekdays: [], runAtUtc: '2099-08-30T01:00:00.000Z' });
    f.automation.setGlobalEnabled(false); await f.automation.tick(new Date('2099-08-30T02:00:00.000Z')); expect(f.automation.listRuns()).toHaveLength(0);
    f.automation.setGlobalEnabled(true); await f.automation.tick(new Date('2099-08-30T02:00:00.000Z'));
    expect(f.automation.listRuns().find((run) => run.automationId === custom.id)).toMatchObject({ status: 'failed', errorCategory: 'unsupported_automation' });
  });
});
