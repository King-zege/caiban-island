import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterAll, describe, expect, it } from 'vitest';
import { AgentPermissionService } from '../src/main/agentPermissionService';
import { AgentService } from '../src/main/agentService';
import { AgentSessionService } from '../src/main/agentSessionService';
import { AppService } from '../src/main/appService';
import { AuthorizedFileService } from '../src/main/authorizedFileService';
import { DeepSeekConfigService } from '../src/main/deepSeekConfigService';
import { openDatabase } from '../src/main/db';
import { PiAgentAdapter } from '../src/main/piAgentAdapter';
import type { PiAgentRunner } from '../src/main/piAgentAdapter';
import type { SafeStorageAdapter } from '../src/main/safeStorageAdapter';

const roots: string[] = [];
class AcceptanceSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from('acceptance-sealed:' + value); }
  decryptString(value: Buffer): string { return value.toString().slice('acceptance-sealed:'.length); }
}
afterAll(() => { for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 失败用例可能仍持有数据库句柄 */ } } });

describe('P21 隔离 Agent 端到端验收', () => {
  it('经真实 Pi 工具循环生成、修改、删除卡片并整理授权目录', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'caiban-p21-agent-')); roots.push(root);
    const dataDir = path.join(root, 'data'); const authorized = path.join(root, 'authorized'); const adjacent = path.join(root, 'adjacent');
    mkdirSync(dataDir); mkdirSync(authorized); mkdirSync(adjacent);
    writeFileSync(path.join(authorized, '报价_甲.txt'), '类别：设备\n供应商：甲');
    writeFileSync(path.join(authorized, '报价_乙.txt'), '类别：服务\n供应商：乙');
    writeFileSync(path.join(adjacent, '不得修改.txt'), '保持原样');

    const db = openDatabase(path.join(dataDir, 'island.db')); const app = new AppService(db, dataDir);
    const sessions = new AgentSessionService(db, dataDir); const deepSeek = new DeepSeekConfigService(app.settings, new AcceptanceSafeStorage());
    deepSeek.save('deepseek-v4-flash', 'faux-provider-only');
    const permissions = new AgentPermissionService(app.settings); permissions.setMode('bypass', true); permissions.addDirectory(authorized);
    const files = new AuthorizedFileService(permissions);
    const modifyTarget = app.createTask({ kind: 'task', name: 'P21 待修改', description: '', urgency: 'normal', deadlineUtc: '2099-12-30T00:00:00.000Z', tzId: 'Asia/Shanghai' });
    const deleteTarget = app.createTask({ kind: 'misc', name: 'P21 待删除', note: '合成数据', remindAtUtc: null, tzId: 'Asia/Shanghai' });

    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'deepseek-v4-flash' }] });
    const models = createModels(); models.setProvider(faux.provider); const model = models.getModel('faux', 'deepseek-v4-flash');
    if (!model) throw new Error('faux model missing');
    const adapter = new PiAgentAdapter(() => ({ model, streamFn: models.streamSimple.bind(models) }));
    const toolErrors: string[] = [];
    const observingRunner: PiAgentRunner = { run: (options) => adapter.run({
      ...options,
      onEvent: async (event) => {
        if (event.type === 'tool_end' && event.isError) toolErrors.push(event.errorMessage ?? '未知工具错误');
        await options.onEvent(event);
      }
    }) };
    const eventKinds: string[] = []; let sessionId: string | undefined; let toolIndex = 0;
    const agent = new AgentService(app, sessions, deepSeek, (event) => eventKinds.push(`${event.sequence}:${event.type}`), observingRunner, undefined, [], permissions, files);

    const runTool = async (toolName: string, args: Record<string, unknown>): Promise<void> => {
      toolIndex += 1;
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall(toolName, args, { id: `acceptance-tool-${toolIndex}` }), { stopReason: 'toolUse' }),
        fauxAssistantMessage('合成验收操作已完成')
      ]);
      const request = { input: `执行第 ${toolIndex} 项合成验收操作`, ...(sessionId ? { sessionId } : {}) };
      const started = sessionId ? agent.send(request) : agent.start(request);
      sessionId = started.session.id;
      await agent.waitForIdle();
      expect(agent.runSnapshot()).toMatchObject({ sessionId, state: 'completed', phase: 'completed' });
      expect(toolErrors.splice(0), `第 ${toolIndex} 项工具调用失败`).toEqual([]);
    };

    await runTool('execute_app_command', { command: 'create_task', input: { kind: 'task', name: 'P21 Agent 采购项目', description: '合成采购', urgency: 'normal', deadlineUtc: '2099-12-31T00:00:00.000Z', tzId: 'Asia/Shanghai' } });
    const createdProject = app.tasks.listActive().find((card) => card.task.name === 'P21 Agent 采购项目');
    if (!createdProject) throw new Error('Agent 未创建采购项目');
    await runTool('execute_app_command', { command: 'add_node', input: { taskId: createdProject.task.id, node: { title: 'P21 项目节点', description: '', startUtc: '2099-12-01T00:00:00.000Z', endUtc: '2099-12-02T00:00:00.000Z' } } });
    await runTool('execute_app_command', { command: 'create_task', input: { kind: 'misc', name: 'P21 Agent 杂事', note: '合成杂事', remindAtUtc: '2099-12-01T00:00:00.000Z', tzId: 'Asia/Shanghai' } });
    await runTool('execute_app_command', { command: 'set_task_name', input: { taskId: modifyTarget.id, name: 'P21 已修改', expectedName: 'P21 待修改' } });
    await runTool('execute_app_command', { command: 'set_task_urgency', input: { taskId: modifyTarget.id, urgency: 'high', expectedUrgency: 'normal' } });
    await runTool('execute_app_command', { command: 'save_note', input: { taskId: modifyTarget.id, body: 'P21 验收备注' } });
    await runTool('execute_app_command', { command: 'set_reminders', input: { taskId: modifyTarget.id, offsets: [60] } });
    await runTool('execute_app_command', { command: 'add_node', input: { taskId: modifyTarget.id, node: { title: 'P21 验收节点', description: '', startUtc: '2099-11-01T00:00:00.000Z', endUtc: '2099-11-02T00:00:00.000Z' } } });
    const modifiedNode = app.tasks.getTaskDetail(modifyTarget.id).nodes.find((node) => node.title === 'P21 验收节点');
    if (!modifiedNode) throw new Error('Agent 未创建验收节点');
    await runTool('execute_app_command', { command: 'set_node_status', input: { nodeId: modifiedNode.id, status: 'in_progress' } });
    await runTool('execute_app_command', { command: 'delete_task', input: { taskId: deleteTarget.id } });

    const directoryId = permissions.snapshot().authorizedDirectories[0].id;
    await runTool('move_authorized_file', { directoryId, from: '报价_甲.txt', to: '设备/甲供应商报价.txt' });
    await runTool('move_authorized_file', { directoryId, from: '报价_乙.txt', to: '服务/乙供应商报价.txt' });

    const cards = app.tasks.listActive(); const modified = app.tasks.getTaskDetail(modifyTarget.id);
    expect(cards.some((card) => card.task.name === 'P21 Agent 采购项目' && card.task.kind === 'task')).toBe(true);
    expect(cards.some((card) => card.task.name === 'P21 Agent 杂事' && card.task.kind === 'misc')).toBe(true);
    expect(modified).toMatchObject({ task: { name: 'P21 已修改', urgency: 'high' }, note: 'P21 验收备注' });
    expect(modified.nodes.some((node) => node.title === 'P21 验收节点' && node.status === 'in_progress')).toBe(true);
    expect(app.reminders.offsetsForTask(modifyTarget.id)).toEqual([60]);
    expect(app.tasks.getTask(deleteTarget.id)).toBeNull();
    expect(existsSync(path.join(authorized, '设备', '甲供应商报价.txt'))).toBe(true);
    expect(existsSync(path.join(authorized, '服务', '乙供应商报价.txt'))).toBe(true);
    expect(readFileSync(path.join(adjacent, '不得修改.txt'), 'utf8')).toBe('保持原样');
    expect(eventKinds.some((event) => event.endsWith(':tool_start'))).toBe(true);
    expect(eventKinds.some((event) => event.endsWith(':tool_end'))).toBe(true);
    expect(sessionId && sessions.get(sessionId).messages.filter((message) => message.role === 'tool').length).toBe(12);
    expect(JSON.stringify(eventKinds)).not.toContain('faux-provider-only');
    await agent.dispose(); db.close();
  }, 60_000);
});
