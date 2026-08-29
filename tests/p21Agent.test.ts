import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentPermissionService } from '../src/main/agentPermissionService';
import { APP_COMMAND_REGISTRY, AppCommandService } from '../src/main/appCommandService';
import { AppService } from '../src/main/appService';
import { AuthorizedFileService } from '../src/main/authorizedFileService';
import { migrate, openDatabase } from '../src/main/db';
import { LocalApiTokenVault } from '../src/main/localApiTokenVault';
import { startLocalCommandServer, type LocalCommandRuntime } from '../src/main/localCommandServer';
import type { SafeStorageAdapter } from '../src/main/safeStorageAdapter';
import type { AgentApprovalRequest } from '../src/shared/agentContracts';
import type { TaskDraftPayload } from '../src/shared/draftContracts';

const dirs: string[] = [];
const runtimes: LocalCommandRuntime[] = [];
class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from('sealed:' + value); }
  decryptString(value: Buffer): string { return value.toString().slice('sealed:'.length); }
}
function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-p21-')); dirs.push(dir);
  const dbPath = path.join(dir, 'island.db'); const db = openDatabase(dbPath);
  const app = new AppService(db, dir); const permissions = new AgentPermissionService(app.settings);
  return { dir, dbPath, db, app, permissions, commands: new AppCommandService(app) };
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const dir of dirs.splice(0)) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

describe('P21 AppCommand 与三档权限', () => {
  it('统一命令注册表创建、修改、提醒、节点和永久删除正式卡片', () => {
    const f = fresh();
    const created = f.commands.execute({ name: 'create_task', input: { kind: 'task', name: '合成采购', description: '初始说明', urgency: 'normal', deadlineUtc: '2099-09-01T00:00:00.000Z', tzId: 'Asia/Shanghai' } });
    if (!created.entityId) throw new Error('missing entity id');
    f.commands.execute({ name: 'set_task_name', input: { taskId: created.entityId, name: '合成采购（已修改）', expectedName: '合成采购' } });
    f.commands.execute({ name: 'set_task_urgency', input: { taskId: created.entityId, urgency: 'high', expectedUrgency: 'normal' } });
    f.commands.execute({ name: 'save_note', input: { taskId: created.entityId, body: '验收备注' } });
    f.commands.execute({ name: 'set_reminders', input: { taskId: created.entityId, offsets: [60] } });
    const node = f.commands.execute({ name: 'add_node', input: { taskId: created.entityId, node: { title: '合成节点', description: '', startUtc: null, endUtc: null } } });
    if (!node.entityId) throw new Error('missing node id');
    f.commands.execute({ name: 'set_node_title', input: { nodeId: node.entityId, title: '合成节点（已修改）', expectedTitle: '合成节点' } });
    f.commands.execute({ name: 'set_node_start_time', input: { nodeId: node.entityId, startUtc: '2099-08-31T00:00:00.000Z', expectedStartUtc: null } });
    f.commands.execute({ name: 'set_node_status', input: { nodeId: node.entityId, status: 'in_progress' } });
    expect(f.app.tasks.getTaskDetail(created.entityId)).toMatchObject({ task: { name: '合成采购（已修改）', urgency: 'high' }, note: '验收备注', nodes: [{ title: '合成节点（已修改）', startUtc: '2099-08-31T00:00:00.000Z', status: 'in_progress' }] });
    expect(f.app.reminders.offsetsForTask(created.entityId)).toEqual([60]);
    expect(f.commands.execute({ name: 'delete_task', input: { taskId: created.entityId } }).undoable).toBe(false);
    expect(f.app.tasks.getTask(created.entityId)).toBeNull();
  });

  it('每条注册命令都有输入 schema 摘要、风险、旧值字段和撤销元数据', () => {
    expect(APP_COMMAND_REGISTRY.size).toBeGreaterThanOrEqual(22);
    for (const definition of APP_COMMAND_REGISTRY.values()) {
      expect(definition.inputFields.length).toBeGreaterThan(0);
      expect(['read', 'reversible', 'high']).toContain(definition.risk);
      expect(typeof definition.undoable).toBe('boolean');
      expect(definition.expectedOldValueFields.every((field) => definition.inputFields.includes(field))).toBe(true);
    }
    expect(APP_COMMAND_REGISTRY.get('set_node_title')?.expectedOldValueFields).toEqual(['expectedTitle']);
    expect(APP_COMMAND_REGISTRY.get('confirm_legacy_draft')?.risk).toBe('high');
  });

  it('确认模式、低风险自动写入和 Bypass 分别执行正确审批规则并跨实例保持', async () => {
    const f = fresh(); const requests: AgentApprovalRequest[] = [];
    f.permissions.onApproval((event) => { if (event.type === 'required') requests.push(event.request); });
    const confirmPending = f.permissions.beforeToolCall('s1', 't1', 'execute_app_command', { command: 'set_task_name', input: { expectedName: '旧名', name: '新名' } });
    await Promise.resolve();
    const firstRequest = requests.at(-1);
    expect(firstRequest).toMatchObject({ risk: 'reversible', summary: '修改任务名称' });
    if (!firstRequest) throw new Error('approval missing');
    f.permissions.resolveApproval(firstRequest.id, 'approve');
    await expect(confirmPending).resolves.toBeUndefined();

    expect(f.permissions.setMode('auto_reversible').mode).toBe('auto_reversible');
    await expect(f.permissions.beforeToolCall('s1', 't2', 'execute_app_command', { command: 'set_task_name', input: {} })).resolves.toBeUndefined();
    const deletePending = f.permissions.beforeToolCall('s1', 't3', 'execute_app_command', { command: 'delete_task', input: {} });
    await Promise.resolve(); const deleteRequest = requests.at(-1); expect(deleteRequest?.risk).toBe('high');
    if (!deleteRequest) throw new Error('approval missing');
    f.permissions.resolveApproval(deleteRequest.id, 'deny');
    await expect(deletePending).resolves.toMatchObject({ block: true });

    expect(() => f.permissions.setMode('bypass')).toThrow('确认风险');
    f.permissions.setMode('bypass', true);
    const restored = new AgentPermissionService(f.app.settings).snapshot();
    expect(restored).toMatchObject({ mode: 'bypass', bypassWarningAccepted: true });
    await expect(f.permissions.beforeToolCall('s1', 't4', 'execute_app_command', { command: 'delete_task', input: {} })).resolves.toBeUndefined();
    expect(f.permissions.riskForTool('unknown_tool')).toBe('high');
    expect(f.permissions.riskForTool('get_task_detail')).toBe('read');
  });
});

describe('P21 授权目录与本地 CLI', () => {
  it('文件工具可创建分类目录、改名移动和删除，同时拒绝越界及联接逃逸', async () => {
    const f = fresh(); const root = path.join(f.dir, 'authorized'); const adjacent = path.join(f.dir, 'adjacent');
    mkdirSync(root); mkdirSync(adjacent); writeFileSync(path.join(root, '报价-A.txt'), 'A 类报价'); writeFileSync(path.join(adjacent, 'private.txt'), '不得改变');
    const settings = f.permissions.addDirectory(root); const directoryId = settings.authorizedDirectories[0].id;
    const files = new AuthorizedFileService(f.permissions);
    await files.write(directoryId, '分类-A/清单.txt', '清单');
    await files.move(directoryId, '报价-A.txt', '分类-A/报价-已归档.txt');
    expect(await files.read(directoryId, '分类-A/报价-已归档.txt')).toBe('A 类报价');
    await expect(files.read(directoryId, '../adjacent/private.txt')).rejects.toThrow('越过');
    const junction = path.join(root, 'escape-link'); symlinkSync(adjacent, junction, 'junction');
    await expect(files.read(directoryId, 'escape-link/private.txt')).rejects.toThrow('越过');
    await files.delete(directoryId, '分类-A/清单.txt');
    expect(readFileSync(path.join(adjacent, 'private.txt'), 'utf8')).toBe('不得改变');
  });

  it('回环端点校验令牌和 schema，只调用注册命令', async () => {
    const f = fresh(); f.permissions.setMode('bypass', true);
    const vault = new LocalApiTokenVault(f.app.settings, new FakeSafeStorage());
    const runtime = await startLocalCommandServer(f.commands, f.permissions, vault, path.join(f.dir, 'caiban-cli.mjs'));
    runtimes.push(runtime); const config = runtime.config();
    const unauthorized = await fetch(config.url, { method: 'POST', body: '{}' });
    expect(unauthorized.status).toBe(401);
    const unsupported = await fetch(config.url, { method: 'POST', headers: { Authorization: `Bearer ${config.token}` }, body: '{}' });
    expect(unsupported.status).toBe(415);
    const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
    const invalid = await fetch(config.url, { method: 'POST', headers, body: JSON.stringify({ name: 'create_task', input: {}, shell: 'powershell' }) });
    expect(invalid.status).toBe(400);
    const nestedInvalid = await fetch(config.url, { method: 'POST', headers, body: JSON.stringify({ name: 'create_task', input: { kind: 'misc', name: 'CLI 合成杂事', note: '', remindAtUtc: null, tzId: 'Asia/Shanghai', shell: 'powershell' } }) });
    expect(nestedInvalid.status).toBe(400);
    const valid = await fetch(config.url, { method: 'POST', headers, body: JSON.stringify({ name: 'create_task', input: { kind: 'misc', name: 'CLI 合成杂事', note: '', remindAtUtc: null, tzId: 'Asia/Shanghai' } }) });
    expect(valid.status).toBe(200); expect(f.app.tasks.listActive()[0].task.name).toBe('CLI 合成杂事');
    expect(f.app.settings.get('local_command_token_encrypted')).not.toContain(config.token);
  });
});

describe('P21 migration v7', () => {
  it('清除旧通道凭据但保留任务、会话和遗留 pending 草稿，且幂等', () => {
    const f = fresh(); const task = f.app.createTask({ kind: 'misc', name: '保留任务', note: '', remindAtUtc: null, tzId: 'Asia/Shanghai' });
    f.app.settings.set('mcp_token_encrypted', 'legacy-secret'); f.app.settings.set('api_key_enc', 'legacy-key');
    f.db.exec("INSERT INTO agent_sessions(id,title,model,summary,created_at,updated_at,input_tokens,output_tokens) VALUES('legacy-session','旧会话','deepseek-v4-flash','','2026-01-01','2026-01-01',0,0)");
    const payload: TaskDraftPayload = { type: 'task', taskInput: { kind: 'misc', name: '旧草稿', note: '', remindAtUtc: null, tzId: 'Asia/Shanghai' }, nodes: [], warnings: [] };
    f.db.prepare("INSERT INTO drafts(id,source,session_id,payload,state,created_at) VALUES('legacy-draft','mcp',NULL,?,'pending','2026-01-01')").run(JSON.stringify(payload));
    f.db.exec('DELETE FROM schema_migrations WHERE version = 7'); f.db.close();
    const upgraded = openDatabase(f.dbPath); migrate(upgraded);
    expect(upgraded.prepare("SELECT value FROM settings WHERE key IN ('mcp_token_encrypted','api_key_enc')").all()).toEqual([]);
    expect(upgraded.prepare('SELECT name FROM tasks WHERE id = ?').get(task.id)).toEqual({ name: '保留任务' });
    expect(upgraded.prepare("SELECT state FROM drafts WHERE id='legacy-draft'").get()).toEqual({ state: 'pending' });
    expect(upgraded.prepare("SELECT title FROM agent_sessions WHERE id='legacy-session'").get()).toEqual({ title: '旧会话' });
    expect(upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 7 });
    upgraded.close();
  });
});
