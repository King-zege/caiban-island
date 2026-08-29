import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AppService } from './appService';
import { AppCommandService } from './appCommandService';
import type { AppCommand } from '../shared/appCommandContracts';
import type { MemoryProposalRequest } from '../shared/agentContracts';
import type { MemoryService } from './memoryService';
import type { AgentSessionService } from './agentSessionService';
import type { AuthorizedFileService } from './authorizedFileService';

interface ToolDetails {
  memoryProposalId?: string;
  commandName?: string;
  entityId?: string;
  fileOperation?: string;
}

const EmptySchema = Type.Object({}, { additionalProperties: false });
const TaskIdSchema = Type.Object({ taskId: Type.String() }, { additionalProperties: false });
// pi-ai applies TypeBox Value.Convert before validation. Keep null first so a
// legitimate null is not coerced to an empty string by the string branch.
const NullableUtc = Type.Union([Type.Null(), Type.String()]);
const UrgencySchema = Type.Union([Type.Literal('critical'), Type.Literal('high'), Type.Literal('normal'), Type.Literal('low')]);
const NodeStatusSchema = Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('cancelled')]);
const ProcurementMethodSchema = Type.Union([Type.Literal('open_tender'), Type.Literal('invited_tender'), Type.Literal('competitive_negotiation'), Type.Literal('single_source'), Type.Literal('inquiry'), Type.Literal('framework'), Type.Literal('custom')]);
const NodeSourceSchema = Type.Union([Type.Literal('template'), Type.Literal('agent'), Type.Literal('custom')]);
const NodeSchema = Type.Object({ title: Type.String(), description: Type.String(), startUtc: NullableUtc, endUtc: NullableUtc, stageKey: Type.Optional(NullableUtc), source: Type.Optional(NodeSourceSchema) }, { additionalProperties: false });
const TaskInputSchema = Type.Object({
  name: Type.String(), fullName: Type.Optional(Type.String()), shortName: Type.Optional(Type.String()), description: Type.String(), kind: Type.Union([Type.Literal('procurement'), Type.Literal('task')]), urgency: UrgencySchema,
  deadlineUtc: NullableUtc, tzId: Type.String()
}, { additionalProperties: false });
const MiscCreateSchema = Type.Object({ kind: Type.Literal('misc'), name: Type.String(), note: Type.String(), remindAtUtc: NullableUtc, tzId: Type.String() }, { additionalProperties: false });
const ProjectCreateSchema = Type.Object({ kind: Type.Union([Type.Literal('procurement'), Type.Literal('task')]), name: Type.String(), fullName: Type.Optional(Type.String()), shortName: Type.Optional(Type.String()), description: Type.String(), urgency: UrgencySchema, deadlineUtc: NullableUtc, tzId: Type.String() }, { additionalProperties: false });

const AppCommandSchema = {
  ...Type.Union([
    Type.Object({ command: Type.Literal('create_procurement_project'), input: Type.Object({ fullName: Type.String(), shortName: Type.String(), description: Type.String(), urgency: UrgencySchema, deadlineUtc: NullableUtc, tzId: Type.String(), procurementMethod: ProcurementMethodSchema, templateId: NullableUtc, nodes: Type.Optional(Type.Array(NodeSchema)) }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('apply_procurement_plan'), input: Type.Object({ taskId: Type.String(), templateId: NullableUtc, templateVersion: Type.Union([Type.Null(), Type.Integer({ minimum: 1 })]), procurementMethod: ProcurementMethodSchema, nodes: Type.Array(NodeSchema), expectedUpdatedAtUtc: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('create_task'), input: Type.Union([ProjectCreateSchema, MiscCreateSchema]) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('update_task'), input: Type.Object({ taskId: Type.String(), task: TaskInputSchema }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('set_task_name'), input: Type.Object({ taskId: Type.String(), name: Type.String(), expectedName: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('set_task_names'), input: Type.Object({ taskId: Type.String(), fullName: Type.String(), shortName: Type.String(), expectedFullName: Type.String(), expectedShortName: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('set_task_urgency'), input: Type.Object({ taskId: Type.String(), urgency: UrgencySchema, expectedUrgency: UrgencySchema }, { additionalProperties: false }) }, { additionalProperties: false }),
    ...(['complete_task', 'cancel_task', 'restore_task', 'delete_task'] as const).map((command) => Type.Object({ command: Type.Literal(command), input: TaskIdSchema }, { additionalProperties: false })),
    Type.Object({ command: Type.Literal('set_reminders'), input: Type.Object({ taskId: Type.String(), offsets: Type.Array(Type.Integer({ minimum: 1, maximum: 525600 })) }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('set_misc_reminder'), input: Type.Object({ taskId: Type.String(), remindAtUtc: NullableUtc, expectedRemindAtUtc: NullableUtc }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('add_node'), input: Type.Object({ taskId: Type.String(), node: NodeSchema }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('update_node'), input: Type.Object({ nodeId: Type.String(), node: NodeSchema }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('set_node_title'), input: Type.Object({ nodeId: Type.String(), title: Type.String(), expectedTitle: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('set_node_start_time'), input: Type.Object({ nodeId: Type.String(), startUtc: NullableUtc, expectedStartUtc: NullableUtc }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('set_node_status'), input: Type.Object({ nodeId: Type.String(), status: NodeStatusSchema }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('reorder_nodes'), input: Type.Object({ taskId: Type.String(), orderedNodeIds: Type.Array(Type.String()) }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('remove_node'), input: Type.Object({ nodeId: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('add_link'), input: Type.Object({ taskId: Type.String(), link: Type.Object({ kind: Type.Union([Type.Literal('url'), Type.Literal('file')]), title: Type.String(), target: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('remove_link'), input: Type.Object({ linkId: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('save_note'), input: Type.Object({ taskId: Type.String(), body: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('resolve_legacy_misc_deadline'), input: Type.Object({ taskId: Type.String(), action: Type.Union([Type.Literal('convert'), Type.Literal('clear')]), expectedDeadlineUtc: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false }),
    Type.Object({ command: Type.Literal('confirm_legacy_draft'), input: Type.Object({ draftId: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false })
  ]),
  // DeepSeek requires every function parameters schema to declare an object at
  // the top level. Type.Union emits only `anyOf`, which the API reports as
  // `type: null`, while `type` + `anyOf` preserves the discriminated union.
  type: 'object' as const
};

const MemorySchema = Type.Object({
  operation: Type.Union([Type.Literal('add'), Type.Literal('replace'), Type.Literal('remove')]),
  category: Type.Union([Type.Literal('profile'), Type.Literal('work')]), fact: Type.String(),
  evidenceMessageId: Type.String(), targetMemoryId: Type.Optional(Type.String())
}, { additionalProperties: false });
const SearchSessionsSchema = Type.Object({ query: Type.String({ minLength: 1, maxLength: 200 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })) }, { additionalProperties: false });
const SearchArchivedCasesSchema = Type.Object({ query: Type.String({ minLength: 1, maxLength: 200 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })) }, { additionalProperties: false });
const FileLocationSchema = Type.Object({ directoryId: Type.String(), path: Type.String() }, { additionalProperties: false });
const FileListSchema = Type.Object({ directoryId: Type.String(), path: Type.Optional(Type.String()) }, { additionalProperties: false });
const FileWriteSchema = Type.Object({ directoryId: Type.String(), path: Type.String(), content: Type.String() }, { additionalProperties: false });
const FileMoveSchema = Type.Object({ directoryId: Type.String(), from: Type.String(), to: Type.String() }, { additionalProperties: false });

function text(value: unknown, details: ToolDetails = {}): { content: [{ type: 'text'; text: string }]; details: ToolDetails } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], details };
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('操作已取消');
}

export function createAgentTools(
  appSvc: AppService,
  sessionId: string,
  sessions?: AgentSessionService,
  memories?: MemoryService,
  files?: AuthorizedFileService,
  commands = new AppCommandService(appSvc)
): AgentTool[] {
  const list: AgentTool<typeof EmptySchema, ToolDetails> = {
    name: 'list_active_tasks', label: '读取活跃任务', description: '列出活跃项目和杂事及进度，不修改数据', parameters: EmptySchema,
    execute: async (_id, _params, signal) => {
      checkCancelled(signal);
      return text(appSvc.tasks.listActive().map((card) => ({ id: card.task.id, fullName: card.task.fullName, shortName: card.task.shortName, kind: card.task.kind, urgency: card.task.urgency, deadlineUtc: card.task.deadlineUtc, remindAtUtc: card.task.remindAtUtc, workflowTemplateId: card.task.workflowTemplateId, procurementMethod: card.task.procurementMethod, progress: card.progress, overdue: card.overdue })));
    }
  };
  const detail: AgentTool<typeof TaskIdSchema, ToolDetails> = {
    name: 'get_task_detail', label: '读取任务详情', description: '读取任务、节点、提醒、资料标题和备注；不打开资料目标', parameters: TaskIdSchema,
    execute: async (_id, params, signal) => {
      checkCancelled(signal);
      const value = appSvc.tasks.getTaskDetail(params.taskId);
      return text({ task: value.task, nodes: value.nodes, reminders: value.task.kind === 'misc' ? value.miscReminder : appSvc.reminders.offsetsForTask(params.taskId), links: value.links.map((link) => ({ id: link.id, kind: link.kind, title: link.title, target: link.kind === 'url' ? link.target : '[本地文件]' })), note: value.note });
    }
  };
  const commandTool: AgentTool<typeof AppCommandSchema, ToolDetails> = {
    name: 'execute_app_command', label: '操作采办岛', description: '通过统一注册命令创建采购项目及完整计划，或修改、归档、恢复任务，并操作节点、提醒、备注和资料；严格填写 expected 旧值',
    parameters: AppCommandSchema, executionMode: 'sequential',
    execute: async (_id, params, signal) => {
      checkCancelled(signal);
      const result = commands.execute({ name: params.command, input: params.input } as AppCommand);
      return text(result, { commandName: result.command, entityId: result.entityId });
    }
  };
  const archivedCases: AgentTool<typeof SearchArchivedCasesSchema, ToolDetails> = {
    name: 'search_archived_cases', label: '搜索归档案例', description: '只读检索归档任务的有限结构化摘要', parameters: SearchArchivedCasesSchema,
    execute: async (_id, params, signal) => { checkCancelled(signal); return text(appSvc.archive.searchCases(params.query, params.limit ?? 5)); }
  };
  const tools: AgentTool[] = [list, detail, commandTool, archivedCases];
  if (files) {
    tools.push({ name: 'list_authorized_files', label: '列举授权目录', description: '列出用户已授权目录中的文件名、类型和大小', parameters: FileListSchema, execute: async (_id, params, signal) => text(await files.list(params.directoryId, params.path ?? '.', signal)) } as AgentTool<typeof FileListSchema, ToolDetails>);
    tools.push({ name: 'read_authorized_file', label: '读取授权文件', description: '读取授权目录内最多 256KB 的 UTF-8 文本文件', parameters: FileLocationSchema, execute: async (_id, params, signal) => text({ content: await files.read(params.directoryId, params.path, signal) }) } as AgentTool<typeof FileLocationSchema, ToolDetails>);
    tools.push({ name: 'write_authorized_file', label: '写入授权文件', description: '在授权目录内创建或改写 UTF-8 文本文件，可创建分类子目录', parameters: FileWriteSchema, executionMode: 'sequential', execute: async (_id, params, signal) => { await files.write(params.directoryId, params.path, params.content, signal); return text({ status: 'written', path: params.path }, { fileOperation: 'write' }); } } as AgentTool<typeof FileWriteSchema, ToolDetails>);
    tools.push({ name: 'move_authorized_file', label: '移动授权文件', description: '在同一授权目录内重命名或移动文件', parameters: FileMoveSchema, executionMode: 'sequential', execute: async (_id, params) => { await files.move(params.directoryId, params.from, params.to); return text({ status: 'moved', from: params.from, to: params.to }, { fileOperation: 'move' }); } } as AgentTool<typeof FileMoveSchema, ToolDetails>);
    tools.push({ name: 'delete_authorized_file', label: '删除授权文件', description: '删除授权目录内的单个文件，不递归删除目录', parameters: FileLocationSchema, executionMode: 'sequential', execute: async (_id, params) => { await files.delete(params.directoryId, params.path); return text({ status: 'deleted', path: params.path }, { fileOperation: 'delete' }); } } as AgentTool<typeof FileLocationSchema, ToolDetails>);
  }
  if (memories) {
    tools.push({
      name: 'propose_memory', label: '提出长期记忆', description: '提议新增、替换或移除一条长期记忆，需引用当前会话证据', parameters: MemorySchema, executionMode: 'sequential',
      execute: async (_id, params, signal) => {
        checkCancelled(signal);
        const request: MemoryProposalRequest = { operation: params.operation, category: params.category, fact: params.fact, evidenceMessageId: params.evidenceMessageId, targetMemoryId: params.targetMemoryId };
        const proposal = memories.propose(sessionId, request);
        return text({ proposalId: proposal.id, status: 'pending', warning: proposal.capacityWarning }, { memoryProposalId: proposal.id });
      }
    } as AgentTool<typeof MemorySchema, ToolDetails>);
  }
  if (sessions) tools.push({ name: 'search_sessions', label: '搜索历史会话', description: '只读搜索本机会话的用户/Agent 可见消息', parameters: SearchSessionsSchema, execute: async (_id, params, signal) => { checkCancelled(signal); return text(sessions.search(params.query, params.limit ?? 5)); } } as AgentTool<typeof SearchSessionsSchema, ToolDetails>);
  return tools;
}

export const AGENT_TOOL_NAMES = [
  'list_active_tasks', 'get_task_detail', 'execute_app_command', 'search_archived_cases',
  'list_authorized_files', 'read_authorized_file', 'write_authorized_file', 'move_authorized_file', 'delete_authorized_file',
  'propose_memory', 'search_sessions'
] as const;
