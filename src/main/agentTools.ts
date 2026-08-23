import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AppService } from './appService';
import { AgentActionService } from './agentActionService';
import type { AgentActionRequest } from '../shared/agentContracts';
import type { DraftNodeProposal } from '../shared/draftContracts';

interface ToolDetails {
  draftId?: string;
}

const EmptySchema = Type.Object({}, { additionalProperties: false });
const TaskIdSchema = Type.Object({ taskId: Type.String() }, { additionalProperties: false });
const NodeSchema = Type.Object({
  title: Type.String(),
  description: Type.Optional(Type.String()),
  startUtc: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  endUtc: Type.Optional(Type.Union([Type.String(), Type.Null()]))
}, { additionalProperties: false });
const TaskDraftSchema = Type.Object({
  name: Type.String(),
  description: Type.Optional(Type.String()),
  deadlineUtc: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  urgency: Type.Optional(Type.Union([Type.Literal('critical'), Type.Literal('high'), Type.Literal('normal'), Type.Literal('low')])),
  nodes: Type.Array(NodeSchema)
}, { additionalProperties: false });
const NodeDraftSchema = Type.Object({ taskId: Type.String(), nodes: Type.Array(NodeSchema) }, { additionalProperties: false });
const ActionSchema = Type.Object({
  taskId: Type.String(),
  kind: Type.Union([
    Type.Literal('set_node_status'),
    Type.Literal('set_reminders'),
    Type.Literal('add_node'),
    Type.Literal('update_node'),
    Type.Literal('delete_node'),
    Type.Literal('reorder_nodes')
  ]),
  nodeId: Type.Optional(Type.String()),
  status: Type.Optional(Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('cancelled')])),
  offsets: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
  node: Type.Optional(NodeSchema),
  orderedNodeIds: Type.Optional(Type.Array(Type.String()))
}, { additionalProperties: false });

function text(value: unknown, details: ToolDetails = {}): { content: [{ type: 'text'; text: string }]; details: ToolDetails } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], details };
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('操作已取消');
}

function normalizeNode(node: { title: string; description?: string; startUtc?: string | null; endUtc?: string | null }): DraftNodeProposal {
  return {
    title: node.title,
    description: node.description ?? '',
    startUtc: node.startUtc ?? null,
    endUtc: node.endUtc ?? null
  };
}

export function createAgentTools(appSvc: AppService, sessionId: string): AgentTool[] {
  const actions = new AgentActionService(appSvc);
  const list: AgentTool<typeof EmptySchema, ToolDetails> = {
    name: 'list_active_tasks', label: '读取活跃任务', description: '列出活跃任务及进度，不修改数据', parameters: EmptySchema,
    execute: async (_id, _params, signal) => {
      checkCancelled(signal);
      return text(appSvc.tasks.listActive().map((card) => ({
        id: card.task.id, name: card.task.name, kind: card.task.kind, urgency: card.task.urgency,
        deadlineUtc: card.task.deadlineUtc, progress: card.progress, overdue: card.overdue
      })));
    }
  };
  const detail: AgentTool<typeof TaskIdSchema, ToolDetails> = {
    name: 'get_task_detail', label: '读取任务详情', description: '读取指定任务、节点、提醒、资料标题和备注，不访问链接或文件', parameters: TaskIdSchema,
    execute: async (_id, params, signal) => {
      checkCancelled(signal);
      const value = appSvc.tasks.getTaskDetail(params.taskId);
      return text({
        task: value.task,
        nodes: value.nodes,
        reminders: appSvc.reminders.offsetsForTask(params.taskId),
        links: value.links.map((link) => ({ kind: link.kind, title: link.title, target: link.kind === 'url' ? link.target : '[本地文件]' })),
        note: value.note
      });
    }
  };
  const taskDraft: AgentTool<typeof TaskDraftSchema, ToolDetails> = {
    name: 'propose_task_draft', label: '提出任务草稿', description: '创建待用户审核的新任务规划草稿，不写入正式任务', parameters: TaskDraftSchema,
    executionMode: 'sequential',
    execute: async (_id, params, signal) => {
      checkCancelled(signal);
      const draft = appSvc.drafts.create('pi', {
        type: 'task',
        taskInput: {
          name: params.name, description: params.description ?? '', kind: 'task', urgency: params.urgency ?? 'normal',
          deadlineUtc: params.deadlineUtc ?? null, tzId: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        nodes: params.nodes.map(normalizeNode), warnings: []
      });
      return text({ draftId: draft.id, status: 'pending', message: '任务草稿已进入审核区' }, { draftId: draft.id });
    }
  };
  const nodeDraft: AgentTool<typeof NodeDraftSchema, ToolDetails> = {
    name: 'propose_node_draft', label: '提出节点草稿', description: '为已有任务创建待用户审核的节点规划草稿', parameters: NodeDraftSchema,
    executionMode: 'sequential',
    execute: async (_id, params, signal) => {
      checkCancelled(signal);
      const draft = appSvc.drafts.create('pi', { type: 'nodes', taskId: params.taskId, nodes: params.nodes.map(normalizeNode), warnings: [] });
      return text({ draftId: draft.id, status: 'pending', message: '节点草稿已进入审核区' }, { draftId: draft.id });
    }
  };
  const action: AgentTool<typeof ActionSchema, ToolDetails> = {
    name: 'propose_task_action', label: '提出轻量操作', description: '一次提出一个待用户逐次确认的轻量操作；仅支持节点状态、提醒和节点增改删排', parameters: ActionSchema,
    executionMode: 'sequential',
    execute: async (_id, params, signal) => {
      checkCancelled(signal);
      const request: AgentActionRequest = {
        taskId: params.taskId,
        sessionId,
        kind: params.kind,
        nodeId: params.nodeId,
        status: params.status,
        offsets: params.offsets,
        node: params.node ? normalizeNode(params.node) : undefined,
        orderedNodeIds: params.orderedNodeIds
      };
      const draft = actions.propose(request);
      return text({ draftId: draft.id, status: 'pending', summary: draft.payload.type === 'action' ? draft.payload.summary : '' }, { draftId: draft.id });
    }
  };
  return [list, detail, taskDraft, nodeDraft, action];
}

export const AGENT_TOOL_NAMES = ['list_active_tasks', 'get_task_detail', 'propose_task_draft', 'propose_node_draft', 'propose_task_action'] as const;
