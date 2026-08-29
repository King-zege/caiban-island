import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppService } from '../src/main/appService';
import { openDatabase } from '../src/main/db';
import { PROCUREMENT_WORKFLOW_TEMPLATES } from '../src/shared/procurementContracts';

const roots: string[] = [];
const databases: Array<{ close(): void }> = [];

function fresh() {
  const root = mkdtempSync(path.join(tmpdir(), 'caiban-p23-'));
  roots.push(root);
  const db = openDatabase(path.join(root, 'island.db'));
  databases.push(db);
  return new AppService(db, root);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('P23 采购流程模板与原子计划', () => {
  it('一次创建项目与版本化十阶段计划，既有项目不随模板对象变化', () => {
    const app = fresh();
    const created = app.createProcurementProject({
      fullName: '二〇二六年度总部办公电脑框架协议采购项目', shortName: '总部电脑框采', description: '合成测试', urgency: 'high',
      deadlineUtc: '2099-12-31T00:00:00.000Z', tzId: 'Asia/Shanghai', procurementMethod: 'open_tender', templateId: 'standard-procurement'
    });
    const detail = app.tasks.getTaskDetail(created.project.id);
    expect(created.nodeCount).toBe(10);
    expect(detail.task).toMatchObject({ workflowTemplateId: 'standard-procurement', workflowTemplateVersion: 1, procurementMethod: 'open_tender' });
    expect(detail.nodes.map((node) => node.title)).toEqual(PROCUREMENT_WORKFLOW_TEMPLATES[0].stages.map((stage) => stage.title));
    expect(detail.nodes.every((node) => node.source === 'template')).toBe(true);
    expect(detail.nodes.at(-1)?.endUtc).toBe('2099-12-31T00:00:00.000Z');
  });

  it('允许完全自定义流程并保存 Agent 来源和稳定顺序', () => {
    const app = fresh();
    const created = app.createProcurementProject({
      fullName: '实验室设备单一来源采购项目', shortName: '实验室设备', description: '', urgency: 'normal', deadlineUtc: null,
      tzId: 'Asia/Shanghai', procurementMethod: 'single_source', templateId: null,
      nodes: [
        { title: '论证', description: '', startUtc: null, endUtc: null, stageKey: 'justification', source: 'agent' },
        { title: '谈判', description: '', startUtc: null, endUtc: null, stageKey: 'negotiation', source: 'agent' }
      ]
    });
    const detail = app.tasks.getTaskDetail(created.project.id);
    expect(detail.nodes.map((node) => [node.position, node.stageKey, node.source])).toEqual([[0, 'justification', 'agent'], [1, 'negotiation', 'agent']]);
  });

  it('批量替换计划校验乐观并发，并在任一节点无效时完整回滚', () => {
    const app = fresh();
    const created = app.createProcurementProject({
      fullName: '食堂服务采购项目', shortName: '食堂服务', description: '', urgency: 'normal', deadlineUtc: null,
      tzId: 'Asia/Shanghai', procurementMethod: 'competitive_negotiation', templateId: null,
      nodes: [{ title: '原节点', description: '', startUtc: null, endUtc: null }]
    });
    const before = app.tasks.getTaskDetail(created.project.id);
    expect(() => app.applyProcurementPlan({
      taskId: created.project.id, templateId: null, templateVersion: null, procurementMethod: 'competitive_negotiation',
      expectedUpdatedAtUtc: before.task.updatedAtUtc,
      nodes: [{ title: '', description: '', startUtc: null, endUtc: null }]
    })).toThrow('节点标题不能为空');
    expect(app.tasks.getTaskDetail(created.project.id).nodes.map((node) => node.title)).toEqual(['原节点']);

    app.addNode(created.project.id, { title: '并发新增', description: '', startUtc: null, endUtc: null });
    expect(() => app.applyProcurementPlan({
      taskId: created.project.id, templateId: 'standard-procurement', templateVersion: 1, procurementMethod: 'open_tender',
      expectedUpdatedAtUtc: before.task.updatedAtUtc, nodes: []
    })).toThrow('采购项目已变化');
  });
});
