import { randomUUID } from 'node:crypto';
import { access, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentAutomation,
  AutomationCreateRequest,
  AutomationEnabledRequest,
  AutomationRun,
  AutomationRunStatus,
  AutomationUpdateRequest,
  DailyBriefingDocument,
  DailyBriefingItem
} from '../shared/automationContracts';
import { dateTimeLocalToUtc, utcToDateTimeLocal } from '../shared/time';
import type { AgentPermissionService } from './agentPermissionService';
import type { AgentSessionService } from './agentSessionService';
import type { DeepSeekConfigService } from './deepSeekConfigService';
import type { KnowledgeService } from './knowledgeService';

interface AutomationRow {
  id: string; name: string; prompt: string; schedule_kind: AgentAutomation['scheduleKind']; time_zone: string;
  local_time: string; weekdays_json: string; run_at_utc: string | null; next_run_at_utc: string | null;
  enabled: number; is_default_daily_briefing: number; last_failure: string | null; created_at: string; updated_at: string;
}
interface RunRow {
  id: string; automation_id: string; scheduled_for_utc: string; status: AutomationRunStatus; session_id: string | null;
  output_relative_path: string | null; approval_required: number; error_category: string | null; created_at: string;
  started_at: string | null; completed_at: string | null;
}

export type PdfRenderer = (html: string) => Promise<Buffer>;
export interface DailyBriefingAnalysis { overdueOrder: string[]; todayOrder: string[]; nextSevenDaysOrder: string[]; notes: string[] }
export type BriefingAnalyzer = (document: DailyBriefingDocument, signal: AbortSignal) => Promise<DailyBriefingAnalysis>;
export class AutomationServiceError extends Error {}

function automationFromRow(row: AutomationRow): AgentAutomation {
  let weekdays: number[] = [];
  try { const parsed: unknown = JSON.parse(row.weekdays_json); if (Array.isArray(parsed)) weekdays = parsed.filter((item): item is number => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 6); } catch { /* invalid legacy data becomes empty */ }
  return {
    id: row.id, name: row.name, prompt: row.prompt, scheduleKind: row.schedule_kind, timeZone: row.time_zone,
    localTime: row.local_time, weekdays, runAtUtc: row.run_at_utc, nextRunAtUtc: row.next_run_at_utc,
    enabled: row.enabled === 1, isDefaultDailyBriefing: row.is_default_daily_briefing === 1,
    lastFailure: row.last_failure, createdAtUtc: row.created_at, updatedAtUtc: row.updated_at
  };
}

function runFromRow(row: RunRow): AutomationRun {
  return {
    id: row.id, automationId: row.automation_id, scheduledForUtc: row.scheduled_for_utc, status: row.status,
    sessionId: row.session_id, outputRelativePath: row.output_relative_path, approvalRequired: row.approval_required === 1,
    errorCategory: row.error_category, createdAtUtc: row.created_at, startedAtUtc: row.started_at, completedAtUtc: row.completed_at
  };
}

function localDate(date: Date, timeZone: string): string {
  return utcToDateTimeLocal(date.toISOString(), timeZone).slice(0, 10);
}

function addCalendarDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T12:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekday(dateText: string): number { return new Date(`${dateText}T12:00:00.000Z`).getUTCDay(); }

function validTime(value: string): boolean { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validTimeZone(value: string): boolean { try { new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format(); return true; } catch { return false; } }

export function nextAutomationOccurrence(input: Pick<AgentAutomation, 'scheduleKind' | 'timeZone' | 'localTime' | 'weekdays' | 'runAtUtc'>, after: Date): string | null {
  if (input.scheduleKind === 'once') return input.runAtUtc && Date.parse(input.runAtUtc) > after.getTime() ? new Date(input.runAtUtc).toISOString() : null;
  const today = localDate(after, input.timeZone);
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addCalendarDays(today, offset);
    if (input.scheduleKind === 'weekly' && !input.weekdays.includes(weekday(date))) continue;
    const candidate = dateTimeLocalToUtc(`${date}T${input.localTime}`, input.timeZone);
    if (candidate && Date.parse(candidate) > after.getTime()) return candidate;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDue(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export function renderDailyBriefingHtml(document: DailyBriefingDocument): string {
  const section = (title: string, items: DailyBriefingItem[], tone: string) => `<section><h2 class="${tone}">${escapeHtml(title)} <span>${items.length}</span></h2>${items.length ? `<ol>${items.map((item) => `<li><div><strong>${escapeHtml(item.title)}</strong><time>${escapeHtml(formatDue(item.dueAtUtc, document.timeZone))}</time></div><p>${escapeHtml(item.detail)}</p><small>${escapeHtml(item.domain)} · 来源：${escapeHtml(item.source.label)}</small></li>`).join('')}</ol>` : '<p class="empty">本区间没有待办</p>'}</section>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:"Microsoft YaHei",sans-serif;color:#172126;margin:0;font-size:10.5pt}header{border-bottom:2px solid #183d48;padding-bottom:10px;margin-bottom:14px}h1{font-size:24pt;margin:0;color:#183d48}header p{margin:6px 0 0;color:#5b6b70}section{break-inside:avoid;margin:0 0 14px}h2{font-size:13pt;margin:0 0 7px;padding:7px 9px;background:#edf2f2;border-left:4px solid #55757c}h2.overdue{border-color:#b24c37}h2.today{border-color:#c28a2d}h2.future{border-color:#3a7884}h2 span{float:right;font-weight:400}ol{padding:0;margin:0;list-style:none}li{padding:8px 9px;border-bottom:1px solid #d9e1e2}li div{display:flex;justify-content:space-between;gap:12px}li time{white-space:nowrap;color:#53676d}li p{margin:4px 0;color:#33484e}li small,.empty{color:#718186}.notice{padding:8px 10px;background:#f6f0df;color:#6a5724;border-radius:4px}footer{margin-top:18px;padding-top:8px;border-top:1px solid #d9e1e2;color:#718186;font-size:8.5pt}
  </style></head><body><header><h1>${escapeHtml(document.headline)}</h1><p>${escapeHtml(document.date)} · ${escapeHtml(document.timeZone)} · 生成于 ${escapeHtml(formatDue(document.generatedAtUtc, document.timeZone))}</p></header>${!document.agentAnalysisGenerated ? '<p class="notice">未生成 Agent 分析；以下为采办岛按时间与状态生成的确定性基础清单。</p>' : ''}${section('逾期事项', document.overdue, 'overdue')}${section('今日事项', document.today, 'today')}${section('未来七日', document.nextSevenDays, 'future')}<footer>所有条目均来自本机采购项目、合同履约动作或杂事；请回到采办岛核对并更新正式状态。</footer></body></html>`;
}

function markdown(document: DailyBriefingDocument, pdfPath: string): string {
  const lines = [`# ${document.headline}`, '', `日期：${document.date}（${document.timeZone}）`, `PDF：${pdfPath}`, ''];
  if (!document.agentAnalysisGenerated) lines.push('> 未生成 Agent 分析；以下为确定性基础清单。', '');
  for (const [title, items] of [['逾期', document.overdue], ['今日', document.today], ['未来七日', document.nextSevenDays]] as const) {
    lines.push(`## ${title}`);
    if (!items.length) lines.push('- 无');
    else items.forEach((item) => lines.push(`- [${item.domain}] ${item.title} — ${item.detail}（来源：${item.source.label}）`));
    lines.push('');
  }
  return lines.join('\n');
}

export class AutomationService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DatabaseSync,
    private readonly permissions: AgentPermissionService,
    private readonly knowledge: KnowledgeService,
    private readonly sessions: AgentSessionService,
    private readonly deepSeek: DeepSeekConfigService,
    private readonly renderPdf: PdfRenderer,
    private readonly interactiveBusy: () => boolean = () => false,
    private readonly notify: (run: AutomationRun) => void = () => undefined,
    private readonly analyze?: BriefingAnalyzer
  ) {}

  list(): AgentAutomation[] {
    return (this.db.prepare('SELECT * FROM agent_automations ORDER BY is_default_daily_briefing DESC,created_at,id').all() as unknown as AutomationRow[]).map(automationFromRow);
  }

  listRuns(limit = 20): AutomationRun[] {
    return (this.db.prepare('SELECT * FROM automation_runs ORDER BY created_at DESC,id DESC LIMIT ?').all(Math.min(100, Math.max(1, limit))) as unknown as RunRow[]).map(runFromRow);
  }

  globalEnabled(): boolean {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='agent_automations_disabled'").get() as { value: string } | undefined;
    return row?.value !== '1';
  }

  setGlobalEnabled(enabled: boolean): boolean {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('agent_automations_disabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled ? '0' : '1');
    return enabled;
  }

  ensureDefault(now = new Date()): AgentAutomation | null {
    if (!this.knowledge.status().hasPrimaryDirectory) return null;
    const existing = this.db.prepare('SELECT * FROM agent_automations WHERE is_default_daily_briefing=1').get() as unknown as AutomationRow | undefined;
    if (existing) return automationFromRow(existing);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    const today = localDate(now, timeZone);
    const todayAtNine = dateTimeLocalToUtc(`${today}T09:00`, timeZone);
    const next = todayAtNine && Date.parse(todayAtNine) <= now.getTime() ? todayAtNine : nextAutomationOccurrence({ scheduleKind: 'daily', timeZone, localTime: '09:00', weekdays: [], runAtUtc: null }, new Date(now.getTime() - 60_000));
    const created = this.create({ name: '每日工作清单', prompt: '汇总采购节点、合同付款/开票/验收事项和杂事，生成今日工作清单。', scheduleKind: 'daily', timeZone, localTime: '09:00', weekdays: [], runAtUtc: null }, true, next);
    return created;
  }

  create(request: AutomationCreateRequest, isDefault = false, forcedNext?: string | null): AgentAutomation {
    this.validate(request);
    const now = new Date(); const id = randomUUID(); const iso = now.toISOString();
    const next = forcedNext === undefined ? nextAutomationOccurrence({ ...request }, now) : forcedNext;
    this.db.prepare(`INSERT INTO agent_automations(id,name,prompt,schedule_kind,time_zone,local_time,weekdays_json,run_at_utc,next_run_at_utc,enabled,is_default_daily_briefing,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(id, request.name.trim(), request.prompt.trim(), request.scheduleKind, request.timeZone, request.localTime, JSON.stringify(request.weekdays), request.runAtUtc, next, isDefault ? 1 : 0, iso, iso);
    return this.get(id);
  }

  update(request: AutomationUpdateRequest): AgentAutomation {
    this.validate(request); const current = this.get(request.automationId);
    if (current.updatedAtUtc !== request.expectedUpdatedAtUtc) throw new AutomationServiceError('自动化已被修改，请刷新后重试');
    const now = new Date(); const updatedAt = now.toISOString();
    const next = nextAutomationOccurrence({ ...request }, now);
    this.db.prepare(`UPDATE agent_automations SET name=?,prompt=?,schedule_kind=?,time_zone=?,local_time=?,weekdays_json=?,run_at_utc=?,next_run_at_utc=?,last_failure=NULL,updated_at=? WHERE id=?`)
      .run(request.name.trim(), request.prompt.trim(), request.scheduleKind, request.timeZone, request.localTime, JSON.stringify(request.weekdays), request.runAtUtc, next, updatedAt, request.automationId);
    return this.get(request.automationId);
  }

  setEnabled(request: AutomationEnabledRequest): AgentAutomation {
    const current = this.get(request.automationId);
    if (current.updatedAtUtc !== request.expectedUpdatedAtUtc) throw new AutomationServiceError('自动化已被修改，请刷新后重试');
    const now = new Date(); const next = request.enabled ? nextAutomationOccurrence(current, new Date(now.getTime() - 60_000)) : null;
    this.db.prepare('UPDATE agent_automations SET enabled=?,next_run_at_utc=?,last_failure=NULL,updated_at=? WHERE id=?').run(request.enabled ? 1 : 0, next, now.toISOString(), request.automationId);
    return this.get(request.automationId);
  }

  delete(id: string): boolean {
    const current = this.get(id);
    if (current.isDefaultDailyBriefing) throw new AutomationServiceError('默认每日工作清单只能暂停，不能删除');
    return this.db.prepare('DELETE FROM agent_automations WHERE id=?').run(id).changes === 1;
  }

  approveRun(id: string): AutomationRun {
    const row = this.db.prepare("SELECT * FROM automation_runs WHERE id=? AND status='waiting_approval'").get(id) as unknown as RunRow | undefined;
    if (!row) throw new AutomationServiceError('待批准自动化不存在或已处理');
    this.db.prepare("UPDATE automation_runs SET status='queued',approval_required=-1 WHERE id=?").run(id);
    void this.drain();
    return this.getRun(id);
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.globalEnabled()) return;
    this.ensureDefault(now);
    const due = this.db.prepare('SELECT * FROM agent_automations WHERE enabled=1 AND next_run_at_utc IS NOT NULL AND next_run_at_utc<=? ORDER BY next_run_at_utc,id').all(now.toISOString()) as unknown as AutomationRow[];
    for (const row of due) {
      const automation = automationFromRow(row);
      let scheduled = automation.nextRunAtUtc;
      if (!scheduled) continue;
      if (automation.scheduleKind !== 'once') {
        const today = localDate(now, automation.timeZone);
        const scheduledDate = localDate(new Date(scheduled), automation.timeZone);
        if (scheduledDate !== today) {
          const todayCandidate = dateTimeLocalToUtc(`${today}T${automation.localTime}`, automation.timeZone);
          if (todayCandidate && Date.parse(todayCandidate) <= now.getTime() && (automation.scheduleKind !== 'weekly' || automation.weekdays.includes(weekday(today)))) scheduled = todayCandidate;
        }
      }
      this.enqueue(automation.id, scheduled, now);
      const next = automation.scheduleKind === 'once' ? null : nextAutomationOccurrence(automation, new Date(Math.max(now.getTime(), Date.parse(scheduled))));
      this.db.prepare('UPDATE agent_automations SET next_run_at_utc=?,enabled=?,updated_at=? WHERE id=?').run(next, next ? 1 : 0, now.toISOString(), automation.id);
    }
    await this.drain();
  }

  start(): void {
    if (this.timer) return;
    const loop = () => { void this.tick().finally(() => { this.timer = setTimeout(loop, 30_000); }); };
    this.timer = setTimeout(loop, 2_000);
  }

  resume(): void { void this.tick(); }
  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  briefing(date = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): DailyBriefingDocument {
    const targetDate = localDate(date, timeZone);
    const start = dateTimeLocalToUtc(`${targetDate}T00:00`, timeZone) ?? `${targetDate}T00:00:00.000Z`;
    const tomorrowDate = addCalendarDays(targetDate, 1); const endToday = dateTimeLocalToUtc(`${tomorrowDate}T00:00`, timeZone) ?? new Date(Date.parse(start) + 86_400_000).toISOString();
    const eighthDate = addCalendarDays(targetDate, 8); const endSeven = dateTimeLocalToUtc(`${eighthDate}T00:00`, timeZone) ?? new Date(Date.parse(start) + 8 * 86_400_000).toISOString();
    type DueRow = { id: string; parent_id: string | null; domain: DailyBriefingItem['domain']; title: string; detail: string; due_at: string; source_kind: DailyBriefingItem['source']['kind']; source_label: string };
    const rows = this.db.prepare(`
      SELECT t.id,NULL parent_id,'采购' domain,t.full_name title,'项目截止时间' detail,t.deadline_utc due_at,'procurement' source_kind,t.full_name source_label FROM tasks t WHERE t.kind='procurement' AND t.status='active' AND t.deadline_utc IS NOT NULL
      UNION ALL SELECT n.id,t.id,'采购',t.full_name,n.title,n.start_utc,'node',t.full_name||' / '||n.title FROM nodes n JOIN tasks t ON t.id=n.task_id WHERE t.status='active' AND n.status IN ('pending','in_progress') AND n.start_utc IS NOT NULL
      UNION ALL SELECT a.id,c.id,'合同',c.full_name,a.title,a.due_at_utc,'contract_action',c.full_name||' / '||a.title FROM contract_actions a JOIN contracts c ON c.id=a.contract_id WHERE c.status IN ('draft','active','closing') AND a.status IN ('pending','in_progress') AND a.due_at_utc IS NOT NULL
      UNION ALL SELECT t.id,NULL,'杂事',t.name,COALESCE(t.description,''),t.remind_at_utc,'misc',t.name FROM tasks t WHERE t.kind='misc' AND t.status='active' AND t.remind_at_utc IS NOT NULL
      ORDER BY due_at,id`).all() as unknown as DueRow[];
    const item = (row: DueRow): DailyBriefingItem => ({ id: row.id, domain: row.domain, title: row.title, detail: row.detail || '按计划处理', dueAtUtc: row.due_at, source: { kind: row.source_kind, entityId: row.id, parentId: row.parent_id, label: row.source_label, dueAtUtc: row.due_at } });
    return {
      schemaVersion: 1, date: targetDate, timeZone, generatedAtUtc: new Date().toISOString(), agentAnalysisGenerated: false,
      headline: `每日工作清单 · ${targetDate}`,
      overdue: rows.filter((row) => row.due_at < start).map(item),
      today: rows.filter((row) => row.due_at >= start && row.due_at < endToday).map(item),
      nextSevenDays: rows.filter((row) => row.due_at >= endToday && row.due_at < endSeven).map(item),
      notes: ['条目按到期时间稳定排序', '请在采办岛内更新完成状态']
    };
  }

  private enqueue(automationId: string, scheduledForUtc: string, now: Date): void {
    this.db.prepare(`INSERT OR IGNORE INTO automation_runs(id,automation_id,scheduled_for_utc,status,created_at) VALUES(?,?,?,'queued',?)`).run(randomUUID(), automationId, scheduledForUtc, now.toISOString());
  }

  private async drain(): Promise<void> {
    if (this.running || this.interactiveBusy()) return;
    const row = this.db.prepare("SELECT * FROM automation_runs WHERE status='queued' ORDER BY scheduled_for_utc,id LIMIT 1").get() as unknown as RunRow | undefined;
    if (!row) return;
    const automation = this.get(row.automation_id);
    if (this.permissions.snapshot().mode === 'confirm_all' && row.approval_required !== -1) {
      this.db.prepare("UPDATE automation_runs SET status='waiting_approval',approval_required=1 WHERE id=?").run(row.id);
      this.notify(this.getRun(row.id));
      return;
    }
    this.running = true;
    this.db.prepare("UPDATE automation_runs SET status='running',approval_required=0,started_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    try {
      if (!automation.isDefaultDailyBriefing) throw new AutomationServiceError('通用自动化尚无安全的确定性执行器');
      let document = this.briefing(new Date(row.scheduled_for_utc), automation.timeZone);
      if (this.analyze && this.deepSeek.status().configured) {
        try { document = this.applyAnalysis(document, await this.analyze(document, AbortSignal.timeout(60_000))); }
        catch { document = { ...document, agentAnalysisGenerated: false, notes: [...document.notes, 'Agent 分析失败，已使用确定性基础清单'] }; }
      }
      const html = renderDailyBriefingHtml(document);
      const buffer = await this.renderPdf(html);
      if (buffer.length < 4 || buffer.subarray(0, 4).toString() !== '%PDF') throw new AutomationServiceError('PDF 渲染结果无效');
      const output = await this.knowledge.resolveAgentOutput(path.join('今日清单', document.date.slice(0, 4), `${document.date} 今日工作清单.pdf`));
      await mkdir(path.dirname(output.absolutePath), { recursive: true });
      const temp = `${output.absolutePath}.${randomUUID()}.tmp`;
      const handle = await open(temp, 'wx');
      try { await handle.writeFile(buffer); } finally { await handle.close(); }
      try {
        await access(output.absolutePath);
        await rm(temp, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') await rename(temp, output.absolutePath);
        else throw error;
      }
      const session = this.sessions.create(this.deepSeek.model(), document.headline);
      this.sessions.append(session.id, 'assistant', markdown(document, output.relativePath));
      this.db.prepare("UPDATE automation_runs SET status='succeeded',session_id=?,output_relative_path=?,completed_at=?,error_category=NULL WHERE id=?")
        .run(session.id, output.relativePath, new Date().toISOString(), row.id);
      this.db.prepare('UPDATE agent_automations SET last_failure=NULL WHERE id=?').run(automation.id);
    } catch (error) {
      const category = error instanceof AutomationServiceError && error.message.includes('通用') ? 'unsupported_automation' : 'automation_failed';
      this.db.prepare("UPDATE automation_runs SET status='failed',completed_at=?,error_category=? WHERE id=?").run(new Date().toISOString(), category, row.id);
      this.db.prepare('UPDATE agent_automations SET last_failure=?,updated_at=? WHERE id=?').run(category, new Date().toISOString(), automation.id);
    } finally {
      this.running = false;
      this.notify(this.getRun(row.id));
    }
    if (!this.interactiveBusy()) await this.drain();
  }

  private get(id: string): AgentAutomation {
    const row = this.db.prepare('SELECT * FROM agent_automations WHERE id=?').get(id) as unknown as AutomationRow | undefined;
    if (!row) throw new AutomationServiceError('自动化不存在');
    return automationFromRow(row);
  }

  private getRun(id: string): AutomationRun {
    const row = this.db.prepare('SELECT * FROM automation_runs WHERE id=?').get(id) as unknown as RunRow | undefined;
    if (!row) throw new AutomationServiceError('自动化运行不存在');
    return runFromRow(row);
  }

  private validate(request: AutomationCreateRequest): void {
    if (!request.name.trim() || request.name.trim().length > 100) throw new AutomationServiceError('自动化名称必须为 1–100 个字符');
    if (!request.prompt.trim() || request.prompt.trim().length > 2_000) throw new AutomationServiceError('自动化说明必须为 1–2000 个字符');
    if (!validTimeZone(request.timeZone) || !validTime(request.localTime)) throw new AutomationServiceError('自动化时区或时间无效');
    if (request.scheduleKind === 'once' && (!request.runAtUtc || !Number.isFinite(Date.parse(request.runAtUtc)))) throw new AutomationServiceError('一次性自动化必须设置运行时间');
    if (request.scheduleKind === 'weekly' && (!request.weekdays.length || request.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) throw new AutomationServiceError('每周自动化必须选择有效星期');
  }

  private applyAnalysis(document: DailyBriefingDocument, analysis: DailyBriefingAnalysis): DailyBriefingDocument {
    const reorder = (items: DailyBriefingItem[], order: string[]): DailyBriefingItem[] => {
      const byId = new Map(items.map((item) => [item.id, item]));
      const result: DailyBriefingItem[] = [];
      for (const id of order.slice(0, items.length)) { const item = byId.get(id); if (item && !result.includes(item)) result.push(item); }
      for (const item of items) if (!result.includes(item)) result.push(item);
      return result;
    };
    return {
      ...document, agentAnalysisGenerated: true,
      overdue: reorder(document.overdue, analysis.overdueOrder), today: reorder(document.today, analysis.todayOrder),
      nextSevenDays: reorder(document.nextSevenDays, analysis.nextSevenDaysOrder),
      notes: analysis.notes.filter((note) => typeof note === 'string').map((note) => note.trim()).filter(Boolean).slice(0, 8).map((note) => note.slice(0, 240))
    };
  }
}
