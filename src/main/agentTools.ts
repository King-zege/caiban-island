import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AppService } from './appService';
import { AgentActionService } from './agentActionService';
import type { AgentActionRequest } from '../shared/agentContracts';
import type { MemoryProposalRequest } from '../shared/agentContracts';
import type { DraftNodeProposal } from '../shared/draftContracts';
import type { MemoryService } from './memoryService';
import type { AgentSessionService } from './agentSessionService';

interface ToolDetails {
  draftId?: string;
  memoryProposalId?: string;
}

const EmptySchema = Type.Object({}, { additionalProperties: false });
const TaskIdSchema = Type.Object({ taskId: Type.String() }, { additionalProperties: false });
const NodeSchema = Type.Object({
  title: Type.String(),
  description: Type.Optional(Type.String()),
  startUtc: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: '节点开始时间 ISO8601 UTC；用户确认后会在此刻提醒' })),
  endUtc: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: '节点截止时间 ISO8601 UTC；仅用于计划，不额外提醒' }))
}, { additionalProperties: false });
const ProjectTaskDraftSchema = Type.Object({
  kind: Type.Literal('task'),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  deadlineUtc: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  urgency: Type.Optional(Type.Union([Type.Literal('critical'), Type.Literal('high'), Type.Literal('normal'), Type.Literal('low')])),
  nodes: Type.Array(NodeSchema)
}, { additionalProperties: false });
const MiscTaskDraftSchema = Type.Object({
  kind: Type.Literal('misc'),
  name: Type.String(),
  note: Type.Optional(Type.String()),
  remindAtUtc: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nodes: Type.Array(NodeSchema, { maxItems: 0 })
}, { additionalProperties: false });
const TaskDraftSchema = Type.Union([ProjectTaskDraftSchema, MiscTaskDraftSchema]);
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
const MemorySchema = Type.Object({
  operation: Type.Union([Type.Literal('add'), Type.Literal('replace'), Type.Literal('remove')]),
  category: Type.Union([Type.Literal('profile'), Type.Literal('work')]),
  fact: Type.String(),
  evidenceMessageId: Type.String(),
  targetMemoryId: Type.Optional(Type.String())
}, { additionalProperties: false });
const SearchSessionsSchema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 }))
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

export function createAgentTools(
  appSvc: AppService,
  sessionId: string,
  sessions?: AgentSessionService,
  memories?: MemoryService
): AgentTool[] {
  const actions = new AgentActionService(appSvc);
  const list: AgentTool<typeof EmptySchema, ToolDetails> = {
    name: 'list_active_tasks', label: '读取活跃任务', description: '列出活跃任务及进度，不修改数据', parameters: EmptySchema,
    execute: async (_id, _params, signal) => {
      checkCancelled(signal);
      return text(appSvc.tasks.listActive().map((card) => ({
        id: card.task.id, name: card.task.name, kind: card.task.kind, urgency: card.task.urgency,
        deadlineUtc: card.task.deadlineUtc, remindAtUtc: card.task.remindAtUtc,
        miscReminder: card.miscReminder, progress: card.progress, overdue: card.overdue
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
        reminders: value.task.kind === 'misc' ? value.miscReminder : appSvc.reminders.offsetsForTask(params.taskId),
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
      const taskInput = params.kind === 'misc'
        ? {
            kind: 'misc' as const,
            name: params.name,
            note: params.note ?? '',
            remindAtUtc: params.remindAtUtc ?? null,
            tzId: Intl.DateTimeFormat().resolvedOptions().timeZone
          }
        : {
            kind: 'task' as const,
            name: params.name,
            description: params.description ?? '',
            urgency: params.urgency ?? 'normal',
            deadlineUtc: params.deadlineUtc ?? null,
            tzId: Intl.DateTimeFormat().resolvedOptions().timeZone
          };
      const draft = appSvc.drafts.create('pi', {
        type: 'task',
        taskInput,
        nodes: params.kind === 'task' ? params.nodes.map(normalizeNode) : [], warnings: []
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
  const tools: AgentTool[] = [list, detail, taskDraft, nodeDraft, action];
  if (memories) {
    const memory: AgentTool<typeof MemorySchema, ToolDetails> = {
      name: 'propose_memory', label: '提出长期记忆',
      description: '提议新增、替换或移除一条用户画像/工作记忆；必须引用当前会话中的可见证据消息，用户确认前不会生效',
      parameters: MemorySchema, executionMode: 'sequential',
      execute: async (_id, params, signal) => {
        checkCancelled(signal);
        const request: MemoryProposalRequest = {
          operation: params.operation, category: params.category, fact: params.fact,
          evidenceMessageId: params.evidenceMessageId, targetMemoryId: params.targetMemoryId
        };
        const proposal = memories.propose(sessionId, request);
        return text({ proposalId: proposal.id, status: 'pending', warning: proposal.capacityWarning }, { memoryProposalId: proposal.id });
      }
    };
    tools.push(memory);
  }
  if (sessions) {
    const search: AgentTool<typeof SearchSessionsSchema, ToolDetails> = {
      name: 'search_sessions', label: '搜索历史会话',
      description: '只读搜索本机历史会话的用户/Agent 可见消息，返回有限片段与摘要，不返回内部推理或原始工具输出',
      parameters: SearchSessionsSchema,
      execute: async (_id, params, signal) => {
        checkCancelled(signal);
        return text(sessions.search(params.query, params.limit ?? 5));
      }
    };
    tools.push(search);
  }
  return tools;
}

export const AGENT_TOOL_NAMES = [
  'list_active_tasks', 'get_task_detail', 'propose_task_draft', 'propose_node_draft', 'propose_task_action',
  'propose_memory', 'search_sessions'
] as const;
