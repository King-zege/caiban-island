import { Check, ChevronDown, EyeOff, MessageSquarePlus, Send, Sparkles, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AgentMessageDto, DraftRecord, MemoryProposal } from '../../../shared/types';
import { isAgentRunning, useAgentStore } from '../state/useAgentStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { EmptyState } from './ui/EmptyState';

interface AgentConversationProps {
  compact?: boolean;
  onHide?: () => void;
  onTaskConfirmed?: (taskId: string) => void;
}

const TOOL_LABELS: Record<string, string> = {
  list_active_tasks: '正在读取活跃任务',
  get_task_detail: '正在核对任务详情',
  propose_task_draft: '正在整理任务方案',
  propose_nodes_draft: '正在整理节点方案',
  propose_task_action: '正在生成操作差异',
  search_archived_cases: '正在检索脱敏归档案例',
  propose_memory: '正在整理记忆提案',
  search_sessions: '正在检索历史会话'
};

export default function AgentConversation({ compact = false, onHide, onTaskConfirmed }: AgentConversationProps): React.JSX.Element {
  const sessions = useAgentStore((state) => state.sessions);
  const detail = useAgentStore((state) => state.detail);
  const runState = useAgentStore((state) => state.runState);
  const streaming = useAgentStore((state) => state.streaming);
  const activeToolName = useAgentStore((state) => state.activeToolName);
  const error = useAgentStore((state) => state.error);
  const drafts = useAgentStore((state) => state.drafts);
  const memoryProposals = useAgentStore((state) => state.memoryProposals);
  const attention = useAgentStore((state) => state.attention);
  const openSession = useAgentStore((state) => state.openSession);
  const newConversation = useAgentStore((state) => state.newConversation);
  const send = useAgentStore((state) => state.send);
  const cancel = useAgentStore((state) => state.cancel);
  const confirmDraft = useAgentStore((state) => state.confirmDraft);
  const discardDraft = useAgentStore((state) => state.discardDraft);
  const confirmMemory = useAgentStore((state) => state.confirmMemoryProposal);
  const discardMemory = useAgentStore((state) => state.discardMemoryProposal);
  const notify = useWorkspaceStore((state) => state.notify);
  const scheduleUndo = useWorkspaceStore((state) => state.scheduleUndo);
  const [input, setInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteDraft, setDeleteDraft] = useState<DraftRecord | null>(null);
  const [hiddenDraftIds, setHiddenDraftIds] = useState<Set<string>>(() => new Set());

  const running = isAgentRunning(runState);
  const proposals = useMemo(() => drafts.filter((draft) => !hiddenDraftIds.has(draft.id)), [drafts, hiddenDraftIds]);

  useEffect(() => {
    const targetId = attention?.draftId ?? attention?.memoryProposalId;
    if (!targetId) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-proposal-id="${CSS.escape(targetId)}"]`);
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [attention?.draftId, attention?.memoryProposalId, proposals.length, memoryProposals.length]);

  const submit = async (value = input) => {
    const content = value.trim();
    if (!content || running) return;
    const sendError = await send(content);
    if (!sendError) setInput('');
  };

  const retry = () => {
    const lastUser = [...(detail?.messages ?? [])].reverse().find((message) => message.role === 'user');
    if (lastUser) void submit(lastUser.content);
  };

  const applyDraft = async (draft: DraftRecord) => {
    if (draft.payload.type === 'action' && draft.payload.action.kind === 'delete_node') {
      setDeleteDraft(draft);
      return;
    }
    setBusyId(draft.id);
    const result = await confirmDraft(draft.id);
    setBusyId(null);
    if (typeof result === 'string') return;
    notify(draft.payload.type === 'task' ? '方案已创建为正式任务' : draft.payload.type === 'nodes' ? '节点已添加到正式任务' : '操作已应用', 'success');
    if (draft.payload.type === 'task') onTaskConfirmed?.(result.taskId);
  };

  const removeDraft = async (id: string) => {
    setBusyId(id);
    const result = await discardDraft(id);
    setBusyId(null);
    if (!result) notify('方案已丢弃', 'success');
  };

  const scheduleDelete = () => {
    if (!deleteDraft || deleteDraft.payload.type !== 'action' || deleteDraft.payload.action.kind !== 'delete_node') return;
    const current = deleteDraft;
    const nodeTitle = deleteDraft.payload.action.before.title;
    const scheduled = scheduleUndo({
      id: current.id,
      kind: 'node',
      label: `节点「${nodeTitle}」`,
      commit: async () => {
        const result = await confirmDraft(current.id);
        return typeof result === 'string' ? result : null;
      }
    });
    setDeleteDraft(null);
    if (scheduled) {
      setHiddenDraftIds((ids) => new Set(ids).add(current.id));
      notify('节点删除将在 5 秒后应用，可撤销', 'info');
    }
  };

  const acceptMemory = async (proposal: MemoryProposal) => {
    setBusyId(proposal.id);
    const result = await confirmMemory(proposal.id);
    setBusyId(null);
    if (!result) notify('记忆已确认，将在新建或重新载入会话时生效', 'success');
  };

  return (
    <section className={'agent-conversation' + (compact ? ' compact' : '')} aria-label="Agent 对话" aria-busy={running}>
      <div className="agent-toolbar">
        <div className="agent-session-picker">
          {compact && sessions.length > 0 ? (
            <label>
              <span className="sr-only">最近会话</span>
              <select value={detail?.session.id ?? ''} onChange={(event) => void openSession(event.target.value)}>
                {!detail && <option value="">新对话</option>}
                {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
              </select>
              <ChevronDown aria-hidden="true" size={14} />
            </label>
          ) : <span>{detail?.session.model ?? 'Pi Agent'} · {running ? '后台规划中' : '本地保存'}</span>}
        </div>
        <div>
          <Button icon={MessageSquarePlus} variant="ghost" disabled={running} onClick={newConversation}>新对话</Button>
          {onHide && <Button icon={EyeOff} variant="ghost" onClick={onHide}>{running ? '隐藏并继续' : '收起'}</Button>}
        </div>
      </div>

      <div className="agent-messages" aria-live="polite" aria-relevant="additions text">
        {!detail && !running ? (
          <EmptyState icon={Sparkles} title="说说你现在要完成什么" description="我会结合记忆、历史会话、活跃任务和脱敏归档案例，先给出可确认的方案。" />
        ) : detail?.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        {streaming && <div className="agent-message assistant streaming"><span>Agent</span><p>{streaming}</p></div>}
        {running && !streaming && <p className="agent-working" role="status">{activeToolName ? TOOL_LABELS[activeToolName] ?? '正在使用受限工具' : 'Pi Agent 正在规划，可隐藏到后台继续'}</p>}

        {(proposals.length > 0 || memoryProposals.length > 0) && (
          <section className="agent-proposals" aria-label="待确认方案">
            <div className="agent-proposals-head"><strong>待你确认</strong><span>{proposals.length + memoryProposals.length}</span></div>
            {proposals.map((draft) => (
              <ProposalCard
                key={draft.id}
                draft={draft}
                busy={busyId === draft.id}
                onConfirm={() => void applyDraft(draft)}
                onDiscard={() => void removeDraft(draft.id)}
              />
            ))}
            {memoryProposals.map((proposal) => (
              <article key={proposal.id} className="agent-proposal-card" data-proposal-id={proposal.id} tabIndex={-1}>
                <div><span className="eyebrow">记忆提案 · {proposal.category === 'profile' ? '个人偏好' : '工作信息'}</span><strong>{proposal.operation === 'add' ? '新增记忆' : proposal.operation === 'replace' ? '替换记忆' : '移除记忆'}</strong></div>
                <p>{proposal.fact}</p>
                {proposal.capacityWarning && <small className="memory-warning">{proposal.capacityWarning}</small>}
                <div className="agent-proposal-actions"><Button icon={X} variant="ghost" disabled={busyId === proposal.id} onClick={() => void discardMemory(proposal.id)}>丢弃</Button><Button icon={Check} variant="primary" disabled={busyId === proposal.id} onClick={() => void acceptMemory(proposal)}>确认记忆</Button></div>
              </article>
            ))}
          </section>
        )}
      </div>

      {error && <AsyncFeedback tone="error" message={error} onRetry={detail ? retry : input.trim() ? () => void submit() : undefined} />}
      <div className="agent-composer">
        <textarea
          value={input}
          disabled={running}
          aria-label="发送给 Pi Agent"
          placeholder={proposals.length > 0 ? '继续说明要修改哪份方案，或直接确认…' : '例如：我要完成一个加油站招标项目…'}
          onFocus={() => { if (typeof window.api.interacting === 'function') void window.api.interacting(true); }}
          onBlur={() => { if (typeof window.api.interacting === 'function') void window.api.interacting(false); }}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }}
        />
        {running ? <Button icon={Square} variant="danger" onClick={() => void cancel()}>取消</Button> : <Button icon={Send} variant="primary" disabled={!input.trim()} onClick={() => void submit()}>发送</Button>}
      </div>

      <Dialog
        open={deleteDraft !== null}
        title="确认删除这个节点？"
        description="删除会在 5 秒后执行，期间可以撤销。"
        onClose={() => setDeleteDraft(null)}
        actions={<><Button variant="ghost" onClick={() => setDeleteDraft(null)}>返回</Button><Button variant="danger" onClick={scheduleDelete}>确认并进入撤销倒计时</Button></>}
      ><p>确认时还会核对节点内容与位置，避免覆盖刚发生的修改。</p></Dialog>
    </section>
  );
}

function MessageBubble({ message }: { message: AgentMessageDto }): React.JSX.Element {
  const label = message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : '工具状态';
  return <div className={'agent-message ' + message.role}><span>{label}{message.toolName ? ' · ' + message.toolName : ''}</span><p>{message.content}</p></div>;
}

function ProposalCard({ draft, busy, onConfirm, onDiscard }: { draft: DraftRecord; busy: boolean; onConfirm: () => void; onDiscard: () => void }): React.JSX.Element {
  const payload = draft.payload;
  const title = payload.type === 'task'
    ? payload.taskInput.name || '未命名任务'
    : payload.type === 'nodes'
      ? `新增 ${payload.nodes.length} 个节点`
      : payload.summary;
  const kind = payload.type === 'task' ? (payload.taskInput.kind === 'misc' ? '杂事方案' : '任务方案') : payload.type === 'nodes' ? '节点方案' : '操作差异';
  return (
    <article className="agent-proposal-card" data-proposal-id={draft.id} tabIndex={-1}>
      <div><span className="eyebrow">{kind}</span><strong>{title}</strong></div>
      {payload.type === 'task' && payload.taskInput.kind === 'task' && payload.taskInput.description && <p>{payload.taskInput.description}</p>}
      {payload.type === 'task' && payload.taskInput.kind === 'misc' && payload.taskInput.note && <p>{payload.taskInput.note}</p>}
      {payload.type !== 'action' && payload.nodes.length > 0 && <ol>{payload.nodes.map((node, index) => <li key={`${node.title}-${index}`}>{node.title}</li>)}</ol>}
      {payload.warnings.length > 0 && <small>留意：{payload.warnings.join('；')}</small>}
      <div className="agent-proposal-actions"><Button icon={X} variant="ghost" disabled={busy} onClick={onDiscard}>丢弃</Button><Button icon={Check} variant="primary" disabled={busy} onClick={onConfirm}>{busy ? '正在应用' : payload.type === 'task' ? '创建任务' : '确认应用'}</Button></div>
    </article>
  );
}
