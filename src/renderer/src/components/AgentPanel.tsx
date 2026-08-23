import { Download, MessageSquarePlus, Play, Send, Square, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AgentMessageDto, AgentRunState, AgentSessionDetail, AgentSessionSummary } from '../../../shared/types';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { EmptyState } from './ui/EmptyState';

const RUNNING_STATES: AgentRunState[] = ['running', 'cancelling'];

export default function AgentPanel(): React.JSX.Element {
  const openSection = useWorkspaceStore((state) => state.openSection);
  const notify = useWorkspaceStore((state) => state.notify);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [detail, setDetail] = useState<AgentSessionDetail | null>(null);
  const [input, setInput] = useState('');
  const [state, setState] = useState<AgentRunState>('idle');
  const [streaming, setStreaming] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const runningRef = useRef(false);
  const selectedSessionRef = useRef<string | null>(null);
  selectedSessionRef.current = detail?.session.id ?? null;

  const refreshSessions = async () => {
    const result = await window.api.listAgentSessions();
    if (!result.ok) { setError(result.error); return; }
    setSessions(result.data);
    if (!detail && result.data[0]) await openSession(result.data[0].id);
  };

  const openSession = async (id: string) => {
    const result = await window.api.getAgentSession(id);
    if (!result.ok) { setError(result.error); return; }
    setDetail(result.data);
    setStreaming('');
    setError(null);
  };

  useEffect(() => {
    void refreshSessions();
    const off = window.api.onAgentEvent((event) => {
      if (selectedSessionRef.current && event.sessionId !== selectedSessionRef.current) return;
      if (event.type === 'state') {
        setState(event.state);
        runningRef.current = RUNNING_STATES.includes(event.state);
        if (!RUNNING_STATES.includes(event.state)) {
          setStreaming('');
          void window.api.listAgentSessions().then((result) => { if (result.ok) setSessions(result.data); });
          void openSession(event.sessionId);
        }
      } else if (event.type === 'text_delta') {
        setStreaming((current) => current + event.delta);
      } else if (event.type === 'message') {
        setDetail((current) => current && current.session.id === event.sessionId
          ? { ...current, messages: current.messages.some((message) => message.id === event.message.id) ? current.messages : [...current.messages, event.message] }
          : current);
        if (event.message.role === 'assistant') setStreaming('');
      } else if (event.type === 'error') {
        setError(event.message);
      }
    });
    return () => {
      off();
      if (runningRef.current) void window.api.agentCancel();
    };
  }, []);

  const send = async (value = input) => {
    const content = value.trim();
    if (!content || runningRef.current) return;
    setError(null);
    setStreaming('');
    setState('running');
    runningRef.current = true;
    const result = detail
      ? await window.api.agentSend({ sessionId: detail.session.id, input: content })
      : await window.api.agentStart({ input: content });
    if (!result.ok) {
      runningRef.current = false;
      setState('error');
      setError(result.error);
      return;
    }
    setDetail(result.data);
    setInput('');
    await refreshSessions();
  };

  const retry = () => {
    const lastUser = [...(detail?.messages ?? [])].reverse().find((message) => message.role === 'user');
    if (lastUser) void send(lastUser.content);
  };

  const removeSession = async () => {
    if (!detail) return;
    const result = await window.api.deleteAgentSession(detail.session.id);
    setDeleteOpen(false);
    if (!result.ok) { setError(result.error); return; }
    setDetail(null);
    await refreshSessions();
    notify('Agent 会话已删除', 'success');
  };

  const exportSession = async (format: 'json' | 'markdown') => {
    if (!detail) return;
    const result = await window.api.exportAgentSession(detail.session.id, format);
    if (!result.ok) setError(result.error);
    else notify(format === 'json' ? '会话 JSON 已导出' : '会话 Markdown 已导出', 'success');
  };

  const clearSessions = async () => {
    const result = await window.api.clearAgentSessions();
    setClearOpen(false);
    if (!result.ok) { setError(result.error); return; }
    setSessions([]);
    setDetail(null);
    notify(`已清除 ${result.data} 个 Agent 会话`, 'success');
  };

  const isRunning = RUNNING_STATES.includes(state);
  return (
    <div className="agent-panel">
      <div className="standalone-heading agent-heading">
        <div><span className="eyebrow">原生 Pi Agent</span><h1>规划任务，再逐项确认</h1><p>Agent 可读取任务并提出草稿或轻量操作，但不能直接写正式数据。</p></div>
        <Button icon={MessageSquarePlus} onClick={() => { setDetail(null); setState('idle'); setStreaming(''); setError(null); }}>新对话</Button>
      </div>
      <div className="agent-layout">
        <aside className="agent-sessions" aria-label="Agent 会话">
          <div className="agent-sessions-head"><strong>本机会话</strong>{sessions.length > 0 && <button type="button" onClick={() => setClearOpen(true)}>清空</button>}</div>
          {sessions.map((session) => <button key={session.id} className={detail?.session.id === session.id ? 'active' : ''} onClick={() => void openSession(session.id)}><span>{session.title}</span><small>{session.updatedAt.slice(5, 16).replace('T', ' ')}</small></button>)}
          {sessions.length === 0 && <small>还没有历史会话</small>}
        </aside>
        <section className="agent-conversation" aria-label="Agent 对话" aria-busy={isRunning}>
          <div className="agent-toolbar">
            <span>{detail?.session.model ?? 'deepseek-v4-flash'} · {state === 'running' ? '运行中' : state === 'cancelling' ? '正在取消' : '本地保存'}</span>
            {detail && <div><Button variant="ghost" onClick={() => openSection('drafts')}>查看待确认草稿</Button><IconButton icon={Download} label="导出 JSON" onClick={() => void exportSession('json')} /><IconButton icon={Download} label="导出 Markdown" onClick={() => void exportSession('markdown')} /><IconButton icon={Trash2} label="删除会话" variant="danger" onClick={() => setDeleteOpen(true)} /></div>}
          </div>
          <div className="agent-messages" aria-live="polite">
            {!detail && !isRunning ? <EmptyState icon={Play} title="告诉 Agent 你想完成什么" description="例如：查看近期采购任务，规划下一步；或把某个节点改为进行中。" /> : detail?.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            {streaming && <div className="agent-message assistant streaming"><span>Agent</span><p>{streaming}</p></div>}
            {isRunning && !streaming && <p className="agent-working">Pi Agent 正在检查任务与工具…</p>}
          </div>
          {error && <AsyncFeedback tone="error" message={error} onRetry={detail ? retry : undefined} />}
          <div className="agent-composer">
            <textarea value={input} disabled={isRunning} aria-label="发送给 Pi Agent" placeholder="描述目标、询问任务，或提出一个轻量修改…" onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} />
            {isRunning ? <Button icon={Square} variant="danger" onClick={() => void window.api.agentCancel()}>取消</Button> : <Button icon={Send} variant="primary" disabled={!input.trim()} onClick={() => void send()}>发送</Button>}
          </div>
        </section>
      </div>
      <Dialog open={deleteOpen} title="删除这段 Agent 会话？" description="本机会话消息会永久删除，已确认写入的正式任务不会受影响。" onClose={() => setDeleteOpen(false)} actions={<><Button variant="ghost" onClick={() => setDeleteOpen(false)}>返回</Button><Button variant="danger" onClick={() => void removeSession()}>确认删除</Button></>}><p>如需保留记录，请先导出 Markdown 或 JSON。</p></Dialog>
      <Dialog open={clearOpen} title="清空全部 Agent 会话？" description="所有本机会话消息都会永久删除，正式任务与待审核草稿不受影响。" onClose={() => setClearOpen(false)} actions={<><Button variant="ghost" onClick={() => setClearOpen(false)}>返回</Button><Button variant="danger" onClick={() => void clearSessions()}>确认清空</Button></>}><p>此操作无法撤销。</p></Dialog>
    </div>
  );
}

function MessageBubble({ message }: { message: AgentMessageDto }): React.JSX.Element {
  const label = message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : '工具';
  return <div className={'agent-message ' + message.role}><span>{label}{message.toolName ? ' · ' + message.toolName : ''}</span><p>{message.content}</p></div>;
}
