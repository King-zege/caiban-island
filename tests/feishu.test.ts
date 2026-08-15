import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/main/db';
import { AppService } from '../src/main/appService';
import { FeishuService } from '../src/main/feishuService';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8').toString('base64'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}));

const dirs: string[] = [];
const calls: string[] = [];
let records = new Map<string, { record_id: string; fields: Record<string, unknown> }>();
let server: Server | null = null;
let baseUrl = '';

function ok(data: unknown) {
  return { code: 0, msg: 'success', data };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = (req.url ?? '').replace(/^\/open-apis/, '');
      const auth = req.headers.authorization ?? '';
      if (auth !== 'Bearer good-token') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 99991668, msg: 'token invalid' }));
        return;
      }
      calls.push(req.method + ' ' + url);
      try {
        if (req.method === 'GET' && url.startsWith('/bitable/v1/apps')) {
          res.end(JSON.stringify(ok({ items: [] })));
          return;
        }
        if (req.method === 'POST' && url === '/bitable/v1/apps') {
          res.end(JSON.stringify(ok({ app: { app_token: 'mock_app_token' } })));
          return;
        }
        if (req.method === 'POST' && url === '/bitable/v1/apps/mock_app_token/tables') {
          res.end(JSON.stringify(ok({ table_id: 'mock_table_id' })));
          return;
        }
        if (req.method === 'POST' && url.endsWith('/records/search')) {
          const payload = JSON.parse(body);
          const values = (payload.filter?.conditions?.[0]?.value ?? []) as string[];
          const items = [...records.values()]
            .filter((r) => {
              const v = r.fields['采办岛任务ID'];
              return values.includes(Array.isArray(v) ? String(v[0]) : String(v));
            })
            .map((r) => ({ record_id: r.record_id, fields: r.fields }));
          res.end(JSON.stringify(ok({ items })));
          return;
        }
        if (req.method === 'POST' && url.endsWith('/records/batch_create')) {
          const payload = JSON.parse(body);
          const out = [];
          for (const r of payload.records as Array<{ fields: Record<string, unknown> }>) {
            const id = 'rec_' + records.size;
            records.set(String(r.fields['采办岛任务ID']), { record_id: id, fields: r.fields });
            out.push({ record_id: id, fields: r.fields });
          }
          res.end(JSON.stringify(ok({ records: out })));
          return;
        }
        if (req.method === 'POST' && url.endsWith('/records/batch_update')) {
          const payload = JSON.parse(body);
          for (const r of payload.records as Array<{ record_id: string; fields: Record<string, unknown> }>) {
            const key = [...records.entries()].find(([, v]) => v.record_id === r.record_id)?.[0];
            if (key) records.set(key, { record_id: r.record_id, fields: r.fields });
          }
          res.end(JSON.stringify(ok({ records: [] })));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ok({})));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, msg: String(e) }));
      }
    });
  });
  await new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      baseUrl = 'http://127.0.0.1:' + (typeof addr === 'object' && addr ? addr.port : 0) + '/open-apis';
      resolve();
    });
  });
});

afterEach(async () => {
  records.clear();
  calls.length = 0;
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

function fresh(): { app: AppService; feishu: FeishuService } {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-feishu-'));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  const app = new AppService(db, dir);
  app.settings.set('feishu_token_enc', Buffer.from('good-token', 'utf8').toString('base64'));
  const feishu = new FeishuService(app.tasks, app.settings, { baseUrl });
  return { app, feishu };
}

describe('飞书多维表格同步（FR-090~097）', () => {
  it('首次同步：自动建表格并批量创建记录；再次同步幂等更新', async () => {
    const { app, feishu } = fresh();
    app.createTask({ name: '任务A', description: '', kind: 'task', urgency: 'high', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.createTask({ name: '杂事B', description: '', kind: 'misc', urgency: 'low', deadlineUtc: null, tzId: 'Asia/Shanghai' });

    let r1: { created: number; updated: number };
    try {
      r1 = await feishu.sync();
    } catch (e) {
      console.log('DEBUG calls:', JSON.stringify(calls));
      throw e;
    }
    expect(r1).toEqual({ created: 2, updated: 0 });
    expect(records.size).toBe(2);
    expect(calls.some((c) => c.includes('/tables'))).toBe(true);
    expect(feishu.getTarget()).toEqual({ appToken: 'mock_app_token', tableId: 'mock_table_id' });
    // 字段映射抽查
    const first = [...records.values()][0].fields;
    expect(first['任务名称']).toBeDefined();
    expect(['任务', '杂事']).toContain(first['类型']);

    // 再次同步：无新增，全部更新（幂等）
    const r2 = await feishu.sync();
    expect(r2).toEqual({ created: 0, updated: 2 });
    expect(records.size).toBe(2);
  });

  it('任务完成归档后不再同步；新增任务创建记录', async () => {
    const { app, feishu } = fresh();
    const t = app.createTask({ name: '待归档', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.createTask({ name: '保留任务', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    await feishu.sync();
    expect(records.size).toBe(2);
    app.completeTask(t.id);
    await feishu.sync();
    expect(records.size).toBe(2); // 归档任务不再 upsert（仍保留旧记录，不删除）
  });

  it('令牌无效 → 明确错误', async () => {
    const { app, feishu } = fresh();
    app.settings.set('feishu_token_enc', Buffer.from('bad-token', 'utf8').toString('base64'));
    app.createTask({ name: 'X', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    await expect(feishu.sync()).rejects.toThrow('飞书接口错误');
  });

  it('CSV 导出：UTF-8 BOM、表头、字段转义', () => {
    const { app, feishu } = fresh();
    app.createTask({ name: '含,逗号"引号', description: '', kind: 'task', urgency: 'critical', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const dir = mkdtempSync(path.join(tmpdir(), 'caiban-csv-'));
    dirs.push(dir);
    const p = path.join(dir, 'out.csv');
    feishu.exportCsv(p);
    const content = readFileSync(p, 'utf8');
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content).toContain('任务名称,类型,紧急程度');
    expect(content).toContain('"含,逗号""引号"');
  });

  it('单任务导出（FR-096）：CSV 含节点/链接/备注', () => {
    const { app, feishu } = fresh();
    const t = app.createTask({ name: '单任务', description: '', kind: 'task', urgency: 'critical', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.tasks.addNode(t.id, { title: '节点A', description: '', startUtc: null, endUtc: null });
    app.tasks.addLink(t.id, { kind: 'url', title: 'x', target: 'https://example.com/a' });
    app.tasks.saveNote(t.id, '备注');
    const dir = mkdtempSync(path.join(tmpdir(), 'caiban-taskcsv-'));
    dirs.push(dir);
    const p = path.join(dir, 't.csv');
    feishu.exportTaskCsv(p, t.id);
    const content = readFileSync(p, 'utf8');
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content).toContain('单任务');
    expect(content).toContain('[待完成] 节点A');
    expect(content).toContain('https://example.com/a');
    expect(content).toContain('备注');
  });

  it('归档导出（FR-096）：含结果与归档时间', () => {
    const { app, feishu } = fresh();
    const t = app.createTask({ name: '归档任务', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    app.completeTask(t.id);
    const dir = mkdtempSync(path.join(tmpdir(), 'caiban-archcsv-'));
    dirs.push(dir);
    const p = path.join(dir, 'a.csv');
    feishu.exportArchivedCsv(p);
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('归档任务');
    expect(content).toContain('已完成');
    expect(content).toContain('结果,归档时间');
  });

  it('Markdown 导出：结构与内容完整', () => {
    const { app, feishu } = fresh();
    app.createTask({ name: 'MD任务', description: '', kind: 'task', urgency: 'high', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const t = app.tasks.listActive()[0].task.id;
    app.tasks.addNode(t, { title: '节点1', description: '', startUtc: null, endUtc: null });
    app.tasks.saveNote(t, '备注内容');
    const dir = mkdtempSync(path.join(tmpdir(), 'caiban-md-'));
    dirs.push(dir);
    const p = path.join(dir, 'out.md');
    feishu.exportMarkdown(p);
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('# 采办岛活跃任务导出');
    expect(content).toContain('## MD任务');
    expect(content).toContain('- [待完成] 节点1');
    expect(content).toContain('备注内容');
  });
});
