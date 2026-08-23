import type { AppService } from './appService';
import type { DraftRecord } from '../shared/draftContracts';
import type { AgentActionRequest, AgentTaskAction } from '../shared/agentContracts';
import { NODE_STATUSES } from '../shared/taskContracts';
import { validateNodeInput } from '../shared/validation';

export class AgentActionError extends Error {}

export class AgentActionService {
  constructor(private readonly appSvc: AppService) {}

  propose(request: AgentActionRequest): DraftRecord {
    const detail = this.appSvc.tasks.getTaskDetail(request.taskId);
    if (detail.task.status !== 'active') throw new AgentActionError('任务已归档');
    const beforeIds = detail.nodes.map((node) => node.id);
    let action: AgentTaskAction;
    let summary: string;

    if (request.kind === 'set_node_status') {
      const node = detail.nodes.find((item) => item.id === request.nodeId);
      if (!node) throw new AgentActionError('节点不存在或不属于该任务');
      if (!request.status || !NODE_STATUSES.includes(request.status)) throw new AgentActionError('目标节点状态无效');
      if (node.status === request.status) throw new AgentActionError('节点已经是该状态，无需生成提案');
      action = { kind: request.kind, nodeId: node.id, before: node.status, after: request.status };
      summary = `节点「${node.title}」：${node.status} → ${request.status}`;
    } else if (request.kind === 'set_reminders') {
      const after = this.normalizeOffsets(request.offsets);
      if (after.length > 0 && !detail.task.deadlineUtc) throw new AgentActionError('任务没有截止时间，不能设置提醒');
      const before = this.appSvc.reminders.offsetsForTask(request.taskId);
      if (JSON.stringify(before) === JSON.stringify(after)) throw new AgentActionError('提醒设置没有变化，无需生成提案');
      action = { kind: request.kind, before, after };
      summary = `提醒提前量：${before.join('、') || '无'} → ${after.join('、') || '无'} 分钟`;
    } else if (request.kind === 'add_node') {
      if (detail.task.kind === 'misc') throw new AgentActionError('杂事不支持节点');
      if (!request.node) throw new AgentActionError('缺少新节点内容');
      this.assertNode(request.node);
      action = { kind: request.kind, beforeNodeIds: beforeIds, input: request.node };
      summary = `新增节点「${request.node.title.trim()}」`;
    } else if (request.kind === 'update_node') {
      const node = detail.nodes.find((item) => item.id === request.nodeId);
      if (!node || !request.node) throw new AgentActionError('节点不存在或缺少修改内容');
      this.assertNode(request.node);
      const before = { title: node.title, description: node.description, startUtc: node.startUtc, endUtc: node.endUtc };
      if (JSON.stringify(before) === JSON.stringify(request.node)) throw new AgentActionError('节点内容没有变化，无需生成提案');
      action = {
        kind: request.kind,
        nodeId: node.id,
        before,
        after: request.node
      };
      summary = `修改节点「${node.title}」为「${request.node.title.trim()}」`;
    } else if (request.kind === 'delete_node') {
      const node = detail.nodes.find((item) => item.id === request.nodeId);
      if (!node) throw new AgentActionError('节点不存在或不属于该任务');
      action = { kind: request.kind, before: node };
      summary = `删除节点「${node.title}」`;
    } else if (request.kind === 'reorder_nodes') {
      const after = request.orderedNodeIds ?? [];
      if (after.length !== beforeIds.length || new Set(after).size !== beforeIds.length || after.some((id) => !beforeIds.includes(id))) {
        throw new AgentActionError('排序列表必须包含该任务的全部节点且不能重复');
      }
      if (JSON.stringify(after) === JSON.stringify(beforeIds)) throw new AgentActionError('节点顺序没有变化，无需生成提案');
      action = { kind: request.kind, before: beforeIds, after };
      summary = '调整全部节点顺序';
    } else {
      const exhaustive: never = request.kind;
      throw new AgentActionError('不支持的操作：' + String(exhaustive));
    }

    return this.appSvc.drafts.create('pi', {
      type: 'action',
      taskId: request.taskId,
      sessionId: request.sessionId,
      action,
      summary,
      warnings: action.kind === 'delete_node' ? ['删除节点需要二次确认，并保留 5 秒撤销时间'] : []
    });
  }

  private normalizeOffsets(value: number[] | undefined): number[] {
    if (!value) throw new AgentActionError('缺少提醒提前量');
    if (value.some((offset) => !Number.isInteger(offset) || offset <= 0)) throw new AgentActionError('提醒提前量必须是正整数分钟');
    return [...new Set(value)].sort((left, right) => left - right);
  }

  private assertNode(input: NonNullable<AgentActionRequest['node']>): void {
    const result = validateNodeInput(input);
    if (!result.ok) throw new AgentActionError(result.errors.join('；'));
  }
}
