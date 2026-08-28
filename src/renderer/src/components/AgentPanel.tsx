import { Brain, Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { isAgentRunning, useAgentStore } from '../state/useAgentStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import AgentConversation from './AgentConversation';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';

export default function AgentPanel(): React.JSX.Element {
  const sessions = useAgentStore((state) => state.sessions);
  const detail = useAgentStore((state) => state.detail);
  const runState = useAgentStore((state) => state.runState);
  const openSession = useAgentStore((state) => state.openSession);
  const deleteCurrentSession = useAgentStore((state) => state.deleteCurrentSession);
  const clearSessions = useAgentStore((state) => state.clearSessions);
  const openSection = useWorkspaceStore((state) => state.openSection);
  const notify = useWorkspaceStore((state) => state.notify);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const exportSession = async (format: 'json' | 'markdown') => {
    if (!detail) return;
    const result = await window.api.exportAgentSession(detail.session.id, format);
    if (!result.ok) notify(result.error, 'error');
    else notify(format === 'json' ? '会话 JSON 已导出' : '会话 Markdown 已导出', 'success');
  };

  const removeSession = async () => {
    const result = await deleteCurrentSession();
    setDeleteOpen(false);
    if (!result) notify('Agent 会话已删除', 'success');
  };

  const removeAll = async () => {
    const result = await clearSessions();
    setClearOpen(false);
    if (typeof result === 'number') notify(`已清除 ${result} 个 Agent 会话`, 'success');
  };

  return (
    <div className="agent-panel">
      <div className="standalone-heading agent-heading">
        <div><span className="eyebrow">Pi Agent</span><h1>对话规划，确认后执行</h1><p>同一会话会在 L2 与 L3 间延续；离开页面不会中止后台运行。</p></div>
        {detail && <div className="agent-heading-actions"><Button icon={Brain} variant="ghost" onClick={() => openSection('memory')}>审核记忆</Button><IconButton icon={Download} label="导出 JSON" onClick={() => void exportSession('json')} /><IconButton icon={Download} label="导出 Markdown" onClick={() => void exportSession('markdown')} /><IconButton icon={Trash2} label="删除会话" variant="danger" disabled={isAgentRunning(runState)} onClick={() => setDeleteOpen(true)} /></div>}
      </div>
      <div className="agent-layout">
        <aside className="agent-sessions" aria-label="Agent 会话">
          <div className="agent-sessions-head"><strong>本机会话</strong>{sessions.length > 0 && <button type="button" disabled={isAgentRunning(runState)} onClick={() => setClearOpen(true)}>清空</button>}</div>
          {sessions.map((session) => <button key={session.id} className={detail?.session.id === session.id ? 'active' : ''} onClick={() => void openSession(session.id)}><span>{session.title}</span><small>{session.updatedAt.slice(5, 16).replace('T', ' ')}</small></button>)}
          {sessions.length === 0 && <small>还没有历史会话</small>}
        </aside>
        <AgentConversation />
      </div>
      <Dialog open={deleteOpen} title="删除这段 Agent 会话？" description="本机会话消息会永久删除，已确认写入的正式任务不会受影响。" onClose={() => setDeleteOpen(false)} actions={<><Button variant="ghost" onClick={() => setDeleteOpen(false)}>返回</Button><Button variant="danger" onClick={() => void removeSession()}>确认删除</Button></>}><p>如需保留记录，请先导出 Markdown 或 JSON。</p></Dialog>
      <Dialog open={clearOpen} title="清空全部 Agent 会话？" description="所有本机会话消息都会永久删除，正式任务与待审核草稿不受影响。" onClose={() => setClearOpen(false)} actions={<><Button variant="ghost" onClick={() => setClearOpen(false)}>返回</Button><Button variant="danger" onClick={() => void removeAll()}>确认清空</Button></>}><p>此操作无法撤销。</p></Dialog>
    </div>
  );
}
