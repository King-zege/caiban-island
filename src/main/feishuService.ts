import { writeFileSync } from 'node:fs';
import { safeStorage } from 'electron';
import type { SettingsService } from './settingsService';
import type { TaskService } from './taskService';
import type { TaskCard } from '../shared/taskContracts';

const DEFAULT_BASE = 'https://open.feishu.cn/open-apis';

export class FeishuError extends Error {}

interface FeishuTarget {
  appToken: string;
  tableId: string;
}

interface SyncResult {
  created: number;
  updated: number;
}

const URGENCY_LABEL: Record<string, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };
const STATUS_LABEL: Record<string, string> = { pending: '待完成', in_progress: '进行中', completed: '已完成', cancelled: '已取消' };

// FR-092 字段映射（v1 单表）
const TABLE_FIELDS = [
  { field_name: '采办岛任务ID', type: 1 },
  { field_name: '任务名称', type: 1 },
  { field_name: '类型', type: 3, property: { options: [{ name: '任务' }, { name: '杂事' }] } },
  { field_name: '紧急程度', type: 3, property: { options: [{ name: '紧急' }, { name: '高' }, { name: '普通' }, { name: '低' }] } },
  { field_name: '截止时间', type: 5 },
  { field_name: '状态', type: 3, property: { options: [{ name: '进行中' }, { name: '已完成' }, { name: '已取消' }] } },
  { field_name: '进度', type: 2 },
  { field_name: '下一节点', type: 1 },
  { field_name: '时间轴节点', type: 1 },
  { field_name: '网页链接', type: 1 },
  { field_name: '文件链接', type: 1 },
  { field_name: '备注', type: 1 },
  { field_name: '最后同步时间', type: 5 }
];

export class FeishuService {

  // FR-094：最近一次同步状态（成功/失败均可查，供界面显示）
  private lastSync: { at: string; ok: boolean; created: number; updated: number; error?: string } | null = null;

  lastSyncStatus(): { at: string; ok: boolean; created: number; updated: number; error?: string } | null {
    return this.lastSync;
  }

  constructor(
    private readonly tasks: TaskService,
    private readonly settings: SettingsService,
    private readonly opts?: { baseUrl?: string }
  ) {}

  // 开发/测试钩子：ISLAND_DEBUG 时允许 settings 覆盖 base URL（对接本地 mock）
  private resolveBase(): string {
    if (this.opts?.baseUrl) return this.opts.baseUrl;
    if (process.env.ISLAND_DEBUG === '1') {
      const dev = this.settings.get('feishu_base_url');
      if (dev) return dev;
    }
    return DEFAULT_BASE;
  }

  // —— 配置 ——
  saveToken(token: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new FeishuError('系统加密不可用，无法安全保存令牌');
    this.settings.set('feishu_token_enc', safeStorage.encryptString(token.trim()).toString('base64'));
  }

  tokenConfigured(): boolean {
    return this.settings.get('feishu_token_enc') !== null;
  }

  getTarget(): FeishuTarget | null {
    const appToken = this.settings.get('feishu_app_token');
    const tableId = this.settings.get('feishu_table_id');
    return appToken && tableId ? { appToken, tableId } : null;
  }

  autoSyncEnabled(): boolean {
    return this.settings.get('feishu_auto_sync') === '1';
  }

  private token(): string {
    const enc = this.settings.get('feishu_token_enc');
    if (!enc) throw new FeishuError('未配置飞书个人令牌（设置 → 飞书同步）');
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      throw new FeishuError('飞书令牌解密失败，请重新配置');
    }
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.token();
    const res = await fetch(this.resolveBase() + path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      },
      signal: AbortSignal.timeout(20000)
    });
    let json: { code?: number; msg?: string; data?: T } | null = null;
    try {
      json = (await res.json()) as { code?: number; msg?: string; data?: T };
    } catch {
      // 非 JSON 响应
    }
    if (!res.ok || !json || json.code !== 0) {
      const code = json?.code ?? res.status;
      const msg = json?.msg ?? res.statusText;
      throw new FeishuError('飞书接口错误（' + code + '）：' + msg);
    }
    return json.data as T;
  }

  async testConnection(): Promise<string> {
    await this.api<{ items: unknown[] }>('/bitable/v1/apps?page_size=1', { method: 'GET' });
    return '连接成功';
  }

  // 首次同步自动创建多维表格与数据表（FR-091）
  private async ensureTarget(): Promise<FeishuTarget> {
    const cached = this.getTarget();
    if (cached) return cached;
    const created = await this.api<{ app: { app_token: string } }>('/bitable/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ name: '采办岛任务' })
    });
    const appToken = created.app.app_token;
    const table = await this.api<{ table_id: string }>('/bitable/v1/apps/' + appToken + '/tables', {
      method: 'POST',
      body: JSON.stringify({ table: { name: '采办岛任务', fields: TABLE_FIELDS } })
    });
    const tableId = table.table_id;
    this.settings.set('feishu_app_token', appToken);
    this.settings.set('feishu_table_id', tableId);
    return { appToken, tableId };
  }

  private toFields(card: TaskCard, now: number): Record<string, unknown> {
    const t = card.task;
    const fields: Record<string, unknown> = {
      采办岛任务ID: t.id,
      任务名称: t.name,
      类型: t.kind === 'misc' ? '杂事' : '任务',
      紧急程度: URGENCY_LABEL[t.urgency] ?? t.urgency,
      状态: '进行中',
      下一节点: card.progress.nextTitle ?? ''
    };
    if (t.deadlineUtc) fields.截止时间 = Math.floor(Date.parse(t.deadlineUtc) / 1000);
    if (card.progress.total > 0) fields.进度 = Math.round((card.progress.done / card.progress.total) * 100);
    fields.最后同步时间 = Math.floor(now / 1000);
    return fields;
  }

  private async enrichFields(card: TaskCard): Promise<Record<string, unknown>> {
    const fields = this.toFields(card, Date.now());
    const detail = this.tasks.getTaskDetail(card.task.id);
    const ordered = [...detail.nodes].sort((a, b) => a.position - b.position);
    fields.时间轴节点 = ordered
      .map((n) => '[' + (STATUS_LABEL[n.status] ?? n.status) + '] ' + n.title)
      .join(String.fromCharCode(10));
    const urls = detail.links.filter((l) => l.kind === 'url').map((l) => l.target);
    const files = detail.links.filter((l) => l.kind === 'file').map((l) => l.target);
    fields.网页链接 = urls.join(String.fromCharCode(10));
    fields.文件链接 = files.join(String.fromCharCode(10));
    fields.备注 = detail.note.slice(0, 10000);
    return fields;
  }

  // FR-093：按 采办岛任务ID 幂等 upsert
  async sync(): Promise<SyncResult> {
    try {
      return await this.syncInner();
    } catch (e) {
      this.lastSync = { at: new Date().toISOString(), ok: false, created: 0, updated: 0, error: e instanceof Error ? e.message : String(e) };
      throw e;
    }
  }

  private async syncInner(): Promise<SyncResult> {
    const target = await this.ensureTarget();
    const cards = this.tasks.listActive();
    const ids = cards.map((c) => c.task.id);
    const existing = await this.searchByTaskIds(target, ids);

    const toCreate: Array<{ fields: Record<string, unknown> }> = [];
    const toUpdate: Array<{ record_id: string; fields: Record<string, unknown> }> = [];
    for (const card of cards) {
      const fields = await this.enrichFields(card);
      const recordId = existing.get(card.task.id);
      if (recordId) toUpdate.push({ record_id: recordId, fields });
      else toCreate.push({ fields });
    }

    const base = '/bitable/v1/apps/' + target.appToken + '/tables/' + target.tableId + '/records';
    if (toCreate.length > 0) {
      for (const chunk of chunkArray(toCreate, 50)) {
        await this.api(base + '/batch_create', { method: 'POST', body: JSON.stringify({ records: chunk }) });
      }
    }
    if (toUpdate.length > 0) {
      for (const chunk of chunkArray(toUpdate, 50)) {
        await this.api(base + '/batch_update', { method: 'POST', body: JSON.stringify({ records: chunk }) });
      }
    }
    this.lastSync = { at: new Date().toISOString(), ok: true, created: toCreate.length, updated: toUpdate.length };
    return { created: toCreate.length, updated: toUpdate.length };
  }

  private async searchByTaskIds(target: FeishuTarget, ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const base = '/bitable/v1/apps/' + target.appToken + '/tables/' + target.tableId + '/records/search';
    for (const chunk of chunkArray(ids, 50)) {
      if (chunk.length === 0) continue;
      const d = await this.api<{ items?: Array<{ record_id?: string; fields?: Record<string, unknown> }> }>(base, {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            conjunction: 'and',
            conditions: [{ field_name: '采办岛任务ID', operator: 'is', value: chunk }]
          },
          page_size: 100
        })
      });
      for (const item of d.items ?? []) {
        const f = item.fields ?? {};
        const v = f['采办岛任务ID'];
        const id = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
        if (id && item.record_id) map.set(id, item.record_id);
      }
    }
    return map;
  }

  // —— FR-096 导出兜底 ——
  private exportLines(): Array<{ card: TaskCard; fields: Record<string, unknown> }> {
    return this.tasks.listActive().map((card) => ({ card, fields: this.toFields(card, Date.now()) }));
  }

  exportCsv(targetPath: string): string {
    const rows = this.exportLines();
    const header = ['任务名称', '类型', '紧急程度', '截止时间', '状态', '进度', '下一节点', '时间轴节点', '网页链接', '文件链接', '备注', '采办岛任务ID'];
    const escape = (v: string) => '"' + v.replaceAll('"', '""').replaceAll(String.fromCharCode(10), '；') + '"';
    const lines = [header.join(',')];
    for (const r of rows) {
      const t = r.card.task;
      const detail = this.tasks.getTaskDetail(t.id);
      const nodes = [...detail.nodes].sort((a, b) => a.position - b.position);
      const urls = detail.links.filter((l) => l.kind === 'url').map((l) => l.target);
      const files = detail.links.filter((l) => l.kind === 'file').map((l) => l.target);
      const progress = r.card.progress.total > 0 ? Math.round((r.card.progress.done / r.card.progress.total) * 100) : '';
      const vals = [
        t.name,
        t.kind === 'misc' ? '杂事' : '任务',
        URGENCY_LABEL[t.urgency] ?? t.urgency,
        t.deadlineUtc ?? '',
        '进行中',
        String(progress),
        r.card.progress.nextTitle ?? '',
        nodes.map((n) => '[' + (STATUS_LABEL[n.status] ?? n.status) + '] ' + n.title).join('；'),
        urls.join('；'),
        files.join('；'),
        detail.note.replaceAll(String.fromCharCode(10), ' '),
        t.id
      ];
      lines.push(vals.map(escape).join(
));
}
const content = String.fromCharCode(0xfeff) + lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
writeFileSync(targetPath, content, 'utf8');
return targetPath;
}

exportMarkdown(targetPath: string): string {
    const rows = this.exportLines();
    const lines: string[] = ['# 采办岛活跃任务导出', '', '导出时间：' + new Date().toISOString(), ''];
    for (const r of rows) {
      const t = r.card.task;
      const detail = this.tasks.getTaskDetail(t.id);
      const nodes = [...detail.nodes].sort((a, b) => a.position - b.position);
      lines.push('## ' + t.name, '');
      lines.push('- 类型：' + (t.kind === 'misc' ? '杂事' : '任务'));
      lines.push('- 紧急程度：' + (URGENCY_LABEL[t.urgency] ?? t.urgency));
      lines.push('- 截止时间：' + (t.deadlineUtc ?? '未设置'));
      lines.push('- 进度：' + (r.card.progress.total > 0 ? r.card.progress.done + '/' + r.card.progress.total : '尚未拆分'));
      if (r.card.progress.nextTitle) lines.push('- 下一节点：' + r.card.progress.nextTitle);
      if (nodes.length > 0) {
        lines.push('', '### 节点');
        for (const n of nodes) {
          lines.push('- [' + (STATUS_LABEL[n.status] ?? n.status) + '] ' + n.title);
        }
      }
      const urls = detail.links.filter((l) => l.kind === 'url');
      const files = detail.links.filter((l) => l.kind === 'file');
      if (urls.length > 0 || files.length > 0) {
        lines.push('', '### 链接');
        for (const l of [...urls, ...files]) lines.push('- ' + l.target);
      }
      if (detail.note.trim()) {
        lines.push('', '### 备注', '', detail.note.trim());
      }
      lines.push('');
    }
    writeFileSync(targetPath, lines.join(String.fromCharCode(10)), 'utf8');
    return targetPath;
  }

  // FR-096：单任务导出（任务详情页使用）
  exportTaskCsv(targetPath: string, taskId: string): string {
    const detail = this.tasks.getTaskDetail(taskId);
    const lines: string[] = ['任务名称,类型,紧急程度,截止时间,状态,进度,时间轴节点,网页链接,文件链接,备注,采办岛任务ID'];
    const esc = (v: string) => '"' + v.replaceAll('"', '""').replaceAll(String.fromCharCode(10), '；') + '"';
    const nodes = [...detail.nodes].sort((a, b) => a.position - b.position);
    const urls = detail.links.filter((l) => l.kind === 'url').map((l) => l.target);
    const files = detail.links.filter((l) => l.kind === 'file').map((l) => l.target);
    const effectiveNodes = detail.nodes.filter((node) => node.status !== 'cancelled');
    const progress = effectiveNodes.length > 0
      ? Math.round((effectiveNodes.filter((node) => node.status === 'completed').length / effectiveNodes.length) * 100)
      : '';
    const vals = [
      detail.task.name,
      detail.task.kind === 'misc' ? '杂事' : '任务',
      URGENCY_LABEL[detail.task.urgency] ?? detail.task.urgency,
      detail.task.deadlineUtc ?? '',
      detail.task.status === 'active' ? '进行中' : detail.task.archiveOutcome === 'completed' ? '已完成' : '已取消',
      String(progress),
      nodes.map((n) => '[' + (STATUS_LABEL[n.status] ?? n.status) + '] ' + n.title).join('；'),
      urls.join('；'),
      files.join('；'),
      detail.note.replaceAll(String.fromCharCode(10), ' '),
      detail.task.id
    ];
    lines.push(vals.map(esc).join(','));
    const content = String.fromCharCode(0xfeff) + lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
    writeFileSync(targetPath, content, 'utf8');
    return targetPath;
  }

  exportTaskMarkdown(targetPath: string, taskId: string): string {
    const detail = this.tasks.getTaskDetail(taskId);
    const nodes = [...detail.nodes].sort((a, b) => a.position - b.position);
    const lines: string[] = [
      '# ' + detail.task.name,
      '',
      '- 类型：' + (detail.task.kind === 'misc' ? '杂事' : '任务'),
      '- 紧急程度：' + (URGENCY_LABEL[detail.task.urgency] ?? detail.task.urgency),
      '- 截止时间：' + (detail.task.deadlineUtc ?? '未设置'),
      ''
    ];
    if (nodes.length > 0) {
      lines.push('## 节点', '');
      for (const n of nodes) lines.push('- [' + (STATUS_LABEL[n.status] ?? n.status) + '] ' + n.title);
    }
    const urls = detail.links.filter((l) => l.kind === 'url');
    const files = detail.links.filter((l) => l.kind === 'file');
    if (urls.length > 0 || files.length > 0) {
      lines.push('', '## 链接', '');
      for (const l of [...urls, ...files]) lines.push('- ' + l.target);
    }
    if (detail.note.trim()) lines.push('', '## 备注', '', detail.note.trim());
    lines.push('');
    writeFileSync(targetPath, lines.join(String.fromCharCode(10)), 'utf8');
    return targetPath;
  }

  // FR-096：归档任务导出
  exportArchivedCsv(targetPath: string): string {
    const items = this.tasks.listArchived();
    const lines: string[] = ['任务名称,类型,紧急程度,截止时间,结果,归档时间,采办岛任务ID'];
    const esc = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    for (const it of items) {
      lines.push([it.name, it.kind === 'misc' ? '杂事' : '任务', URGENCY_LABEL[it.urgency] ?? it.urgency, it.deadlineUtc ?? '', it.outcome === 'completed' ? '已完成' : '已取消', it.archivedAt, it.id].map(esc).join(','));
    }
    writeFileSync(targetPath, String.fromCharCode(0xfeff) + lines.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
    return targetPath;
  }
}
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
