import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openDatabase } from '../src/main/db';
import { AppService } from '../src/main/appService';
import { createMcpServer } from '../src/main/mcpServer';

const dirs: string[] = [];
async function fresh(): Promise<{ app: AppService; client: Client; close: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-mcp-'));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, 'island.db'));
  const app = new AppService(db, dir);
  const server = createMcpServer(app);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  // 两端必须同时连接完成握手，否则 initialize 互相等待
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return {
    app,
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

describe('MCP 工具集（FR-041）', () => {
  it('暴露 4 个工具', async () => {
    const { client, close } = await fresh();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(['list_active_tasks', 'get_task_detail', 'propose_task_draft', 'propose_node_draft']);
    await close();
  });

  it('list_active_tasks 返回排序后的活跃任务', async () => {
    const f = await fresh();
    f.app.createTask({ name: '普通任务', description: '', kind: 'task', urgency: 'normal', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    f.app.createTask({ name: '紧急任务', description: '', kind: 'task', urgency: 'critical', deadlineUtc: null, tzId: 'Asia/Shanghai' });
    const r = await f.client.callTool({ name: 'list_active_tasks', arguments: {} });
    const text = (r.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text) as Array<{ name: string }>;
    expect(data.map((d) => d.name)).toEqual(['紧急任务', '普通任务']);
    await f.close();
  });

  it('propose_task_draft 只产生草稿，不落正式数据', async () => {
    const f = await fresh();
    const r = await f.client.callTool({
      name: 'propose_task_draft',
      arguments: {
        name: 'MCP 草稿任务',
        urgency: 'high',
        nodes: [{ title: '节点1' }, { title: '节点2' }]
      }
    });
    const text = (r.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text) as { draftId: string; status: string; nodeCount: number };
    expect(data.status).toBe('pending');
    expect(data.nodeCount).toBe(2);
    expect(f.app.tasks.listActive()).toHaveLength(0);
    expect(f.app.drafts.listPending()).toHaveLength(1);
    await f.close();
  });

  it('propose_task_draft 可生成无节点的杂事草稿与精确提醒', async () => {
    const f = await fresh();
    const remindAtUtc = '2099-09-01T08:30:00.000Z';
    const r = await f.client.callTool({
      name: 'propose_task_draft',
      arguments: { kind: 'misc', name: '联系物业', note: '续门禁卡', remindAtUtc, nodes: [] }
    });
    expect(r.isError).not.toBe(true);
    const draft = f.app.drafts.listPending()[0];
    expect(f.app.tasks.listActive()).toEqual([]);
    expect(draft.payload.type).toBe('task');
    if (draft.payload.type === 'task') {
      expect(draft.payload.taskInput).toMatchObject({ kind: 'misc', name: '联系物业', note: '续门禁卡', remindAtUtc });
      expect(draft.payload.nodes).toEqual([]);
    }
    await f.close();
  });

  it('非法输入返回 isError', async () => {
    const f = await fresh();
    const r = await f.client.callTool({
      name: 'propose_task_draft',
      arguments: { name: '  ', nodes: [] }
    });
    expect(r.isError).toBe(true);
    await f.close();
  });
});
