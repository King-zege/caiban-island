import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/main/db';
import { AppService } from '../src/main/appService';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8').toString('base64'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}));

const dirs: string[] = [];
let server: Server | null = null;
let requests: Array<{ body: { messages?: Array<{ role: string; content?: string }> } }> = [];

function startMock(handler: (reqIndex: number) => unknown): Promise<string> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        requests.push({ body: JSON.parse(body) });
        const idx = requests.length - 1;
        const payload = handler(idx);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    server = srv;
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      resolve('http://127.0.0.1:' + (typeof addr === 'object' && addr ? addr.port : 0) + '/v1');
    });
  });
}

function toolCallResponse(argJson: string): unknown {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          tool_calls: [{ id: '1', type: 'function', function: { name: 'propose_task_draft', arguments: argJson } }]
        }
      }
    ]
  };
}

afterEach(async () => {
  const s = server;
  server = null;
  if (s) {
    await new Promise((r) => s.close(r));
  }
  requests = [];
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

function freshApp(): AppService {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-llm-'));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  return new AppService(db, dir);
}

describe('内置 LLM 通道（FR-042/FR-046）', () => {
  it('未配置时给出可操作错误', async () => {
    const app = freshApp();
    await expect(app.llm.breakdown('测试')).rejects.toThrow('未配置内置 AI');
  });

  it('function call → 草稿；Key 不进数据库明文', async () => {
    const app = freshApp();
    const base = await startMock(() =>
      toolCallResponse(JSON.stringify({ name: '采购电脑', urgency: 'high', nodes: [{ title: '询价' }, { title: '下单' }] }))
    );
    app.llm.saveConfig(base, 'mock-model', 'secret-key-123');
    // Key 加密保存（mock 下为明文等价物，但真实实现走 safeStorage）
    expect(app.settings.get('api_key_enc')).not.toBeNull();
    const draft = await app.llm.breakdown('采购 50 台电脑');
    expect(draft.source).toBe('api');
    expect(draft.payload.type).toBe('task');
    if (draft.payload.type === 'task') {
      expect(draft.payload.taskInput.name).toBe('采购电脑');
      expect(draft.payload.nodes).toHaveLength(2);
    }
    expect(requests).toHaveLength(1);
  });

  it('单步骤意图可生成杂事草稿，确认前不写正式数据', async () => {
    const app = freshApp();
    const remindAtUtc = '2099-09-01T08:30:00.000Z';
    const base = await startMock(() => toolCallResponse(JSON.stringify({
      kind: 'misc', name: '联系物业', note: '续门禁卡', remindAtUtc, nodes: []
    })));
    app.llm.saveConfig(base, 'mock-model', 'k');
    const draft = await app.llm.breakdown('明天下午提醒我联系物业续门禁卡');
    expect(app.tasks.listActive()).toEqual([]);
    if (draft.payload.type !== 'task') throw new Error('应生成任务草稿');
    expect(draft.payload.taskInput).toMatchObject({ kind: 'misc', name: '联系物业', note: '续门禁卡', remindAtUtc });
    expect(draft.payload.nodes).toEqual([]);
  });

  it('校验失败自动修复一次；两次失败报错', async () => {
    const app = freshApp();
    // 第一次非法（空名称），第二次合法
    let call = 0;
    const base = await startMock(() => {
      call++;
      if (call === 1) return toolCallResponse(JSON.stringify({ name: '  ', nodes: [] }));
      return toolCallResponse(JSON.stringify({ name: '修复后任务', nodes: [{ title: 'a' }] }));
    });
    app.llm.saveConfig(base, 'mock-model', 'k');
    const draft = await app.llm.breakdown('x');
    if (draft.payload.type === 'task') expect(draft.payload.taskInput.name).toBe('修复后任务');
    expect(call).toBe(2);

    // 两次都非法 → 报错
    const app2 = freshApp();
    let call2 = 0;
    const base2 = await startMock(() => {
      call2++;
      return toolCallResponse(JSON.stringify({ name: '  ', nodes: [] }));
    });
    app2.llm.saveConfig(base2, 'mock-model', 'k');
    await expect(app2.llm.breakdown('x')).rejects.toThrow('两次校验失败');
    expect(call2).toBe(2);
  });
});
