import { Check, ChevronDown, EyeOff, MessageSquarePlus, Send, Sparkles, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AgentMessageDto, AgentProposal, MemoryProposal } from '../../../shared/types';
import { isAgentRunning, useAgentStore } from '../state/useAgentStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';

interface AgentConversationProps {
  compact?: boolean;
  onHide?: () => void;
  onTaskConfirmed?: (taskId: string) => void;
}

const TOOL_LABELS: Record<string, string> = {
  list_active_tasks: '正在读取活跃任务',
  get_task_detail: '正在核对任务详情',
  execute_app_command: '正在应用采办岛操作',
  search_archived_cases: '正在检索脱敏归档案例',
  list_authorized_files: '正在列举授权目录',
  read_authorized_file: '正在读取授权文件',
  write_authorized_file: '正在写入授权文件',
  move_authorized_file: '正在整理授权文件',
  delete_authorized_file: '正在删除授权文件',
  propose_memory: '正在整理记忆提案',
  search_sessions: '正在检索历史会话'
};

export default function AgentConversation({ compact = false, onHide, onTaskConfirmed }: AgentConversationProps): React.JSX.Element {
  const sessions = useAgentStore((state) => state.sessions);
  const detail = useAgentStore((state) => state.detail);
  const runState = useAgentStore((state) => state.runState);
  const runPhase = useAgentStore((state) => state.runPhase);
  const streaming = useAgentStore((state) => state.streaming);
  const activeToolName = useAgentStore((state) => state.activeToolName);
  const error = useAgentStore((state) => state.error);
  const proposals = useAgentStore((state) => state.proposals);
  const memoryProposals = useAgentStore((state) => state.memoryProposals);
  const attention = useAgentStore((state) => state.attention);
  const pendingApproval = useAgentStore((state) => state.pendingApproval);
  const openSession = useAgentStore((state) => state.openSession);
  const newConversation = useAgentStore((state) => state.newConversation);
  const send = useAgentStore((state) => state.send);
  const cancel = useAgentStore((state) => state.cancel);
  const approveProposal = useAgentStore((state) => state.approveProposal);
  const discardProposal = useAgentStore((state) => state.discardProposal);
  const confirmMemory = useAgentStore((state) => state.confirmMemoryProposal);
  const discardMemory = useAgentStore((state) => state.discardMemoryProposal);
  const resolveApproval = useAgentStore((state) => state.resolveApproval);
  const notify = useWorkspaceStore((state) => state.notify);
  const [input, setInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [firstPacketSlow, setFirstPacketSlow] = useState(false);

  const running = isAgentRunning(runState);
  const visibleProposals = useMemo(() => proposals.filter((proposal) => proposal.state === 'pending'), [proposals]);

  useEffect(() => {
    setFirstPacketSlow(false);
    if (runPhase !== 'connecting') return;
    const timer = window.setTimeout(() => setFirstPacketSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [runPhase]);

  useEffect(() => {
    const targetId = attention?.proposalId ?? attention?.memoryProposalId;
    if (!targetId) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-proposal-id="${CSS.escape(targetId)}"]`);
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [attention?.proposalId, attention?.memoryProposalId, visibleProposals.length, memoryProposals.length]);

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

  const applyProposal = async (proposal: AgentProposal) => {
    setBusyId(proposal.id);
    const result = await approveProposal(proposal.id);
    setBusyId(null);
    if (result) return;
    notify('提案中的操作已原子应用', 'success');
    void onTaskConfirmed;
  };

  const removeProposal = async (id: string) => {
    setBusyId(id);
    const result = await discardProposal(id);
    setBusyId(null);
    if (!result) notify('方案已丢弃', 'success');
  };

  const acceptMemory = async (proposal: MemoryProposal) => {
    setBusyId(proposal.id);
    const result = await confirmMemory(proposal.id);
    setBusyId(null);
    if (!result) notify('记忆已确认，将在新建或重新载入会话时生效', 'success');
  };

  const decideApproval = async (decision: 'approve' | 'deny') => {
    if (!pendingApproval || approvalBusy) return;
    setApprovalBusy(true);
    const result = await resolveApproval(pendingApproval.id, decision);
    setApprovalBusy(false);
    if (result) notify(result, 'error');
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
          ) : <span>{detail?.session.model ?? 'Pi Agent'} · {runPhase === 'awaiting_approval' ? '等待确认' : running ? '正在工作' : '本地保存'}</span>}
        </div>
        <div>
          <Button icon={MessageSquarePlus} variant="ghost" disabled={running} onClick={newConversation}>新对话</Button>
          {onHide && <Button icon={EyeOff} variant="ghost" onClick={onHide}>{running ? '隐藏并继续' : '收起'}</Button>}
        </div>
      </div>

      <div className="agent-messages" aria-live="polite" aria-relevant="additions text">
        {!detail && !running ? (
          <EmptyState icon={Sparkles} title="说说你现在要完成什么" description="Agent 可按当前权限操作任务，也能整理你明确授权的目录。" />
        ) : detail?.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        {streaming && <div className="agent-message assistant streaming"><span>Agent</span><p>{streaming}</p></div>}
        {running && !streaming && <p className="agent-working" role="status">{runPhase === 'awaiting_approval' ? '等待你确认后继续当前操作' : activeToolName ? TOOL_LABELS[activeToolName] ?? '正在使用受限工具' : runPhase === 'connecting' ? firstPacketSlow ? '连接响应较慢，仍在等待 DeepSeek；超时后可重试' : '正在连接 DeepSeek' : runPhase === 'applying' ? '正在应用操作结果' : 'Agent 正在处理，可隐藏到后台继续'}</p>}

        {pendingApproval && (
          <article className="agent-approval-card" data-approval-id={pendingApproval.id} tabIndex={-1}>
            <div><strong>{pendingApproval.summary}</strong><span>{pendingApproval.risk === 'high' ? '高风险操作' : '写入操作'}</span></div>
            <dl>{pendingApproval.changes.map((change) => <div key={change.label}><dt>{change.label}</dt><dd><del>{change.before}</del><span aria-hidden="true">→</span><ins>{change.after}</ins></dd></div>)}</dl>
            <p>批准后 Agent 会继续当前工具循环；拒绝会把结果反馈给 Agent。</p>
            <div className="agent-proposal-actions"><Button icon={X} variant="ghost" disabled={approvalBusy} onClick={() => void decideApproval('deny')}>拒绝</Button><Button icon={Check} variant="primary" disabled={approvalBusy} onClick={() => void decideApproval('approve')}>{approvalBusy ? '正在提交' : '批准并继续'}</Button></div>
          </article>
        )}

        {(visibleProposals.length > 0 || memoryProposals.length > 0) && (
          <section className="agent-proposals" aria-label="待确认方案">
            <div className="agent-proposals-head"><strong>待你确认</strong><span>{visibleProposals.length + memoryProposals.length}</span></div>
            {visibleProposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                busy={busyId === proposal.id}
                onConfirm={() => void applyProposal(proposal)}
                onDiscard={() => void removeProposal(proposal.id)}
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
          placeholder={visibleProposals.length > 0 ? '继续说明要修改哪份方案，或直接确认…' : '例如：我要完成一个加油站招标项目…'}
          onFocus={() => { if (typeof window.api.interacting === 'function') void window.api.interacting(true); }}
          onBlur={() => { if (typeof window.api.interacting === 'function') void window.api.interacting(false); }}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }}
        />
        {running ? <Button icon={Square} variant="danger" onClick={() => void cancel()}>取消</Button> : <Button icon={Send} variant="primary" disabled={!input.trim()} onClick={() => void submit()}>发送</Button>}
      </div>

    </section>
  );
}

function MessageBubble({ message }: { message: AgentMessageDto }): React.JSX.Element {
  const label = message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : '工具状态';
  return <div className={'agent-message ' + message.role}><span>{label}{message.toolName ? ' · ' + message.toolName : ''}</span><p>{message.content}</p></div>;
}

function ProposalCard({ proposal, busy, onConfirm, onDiscard }: { proposal: AgentProposal; busy: boolean; onConfirm: () => void; onDiscard: () => void }): React.JSX.Element {
  const payload = proposal.payload;
  return (
    <article className="agent-proposal-card" data-proposal-id={proposal.id} tabIndex={-1}>
      <div><span className="eyebrow">{proposal.kind === 'legacy_draft' ? '迁移提案' : '命令提案'}</span><strong>{proposal.title}</strong></div>
      {proposal.summary && <p>{proposal.summary}</p>}
      <ol>{payload.commands.map((command, index) => <li key={`${command.name}-${index}`}>{command.name}</li>)}</ol>
      {payload.warnings.length > 0 && <small>留意：{payload.warnings.join('；')}</small>}
      <div className="agent-proposal-actions"><Button icon={X} variant="ghost" disabled={busy} onClick={onDiscard}>丢弃</Button><Button icon={Check} variant="primary" disabled={busy || payload.commands.length === 0} onClick={onConfirm}>{busy ? '正在应用' : '确认应用'}</Button></div>
    </article>
  );
}
