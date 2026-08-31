import { Brain, Download, FolderPlus, ShieldAlert, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentAutomation, AutomationRun, KnowledgeWorkspaceStatus } from '../../../shared/types';
import { isAgentRunning, useAgentStore } from '../state/useAgentStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import AgentConversation from './AgentConversation';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface AgentPanelProps {
  compact?: boolean;
  onHide?: () => void;
  onTaskConfirmed?: (taskId: string) => void;
}

export default function AgentPanel({ compact = false, onHide, onTaskConfirmed }: AgentPanelProps): React.JSX.Element {
  const sessions = useAgentStore((state) => state.sessions);
  const detail = useAgentStore((state) => state.detail);
  const runState = useAgentStore((state) => state.runState);
  const openSession = useAgentStore((state) => state.openSession);
  const deleteCurrentSession = useAgentStore((state) => state.deleteCurrentSession);
  const clearSessions = useAgentStore((state) => state.clearSessions);
  const permissions = useAgentStore((state) => state.permissions);
  const setPermissionMode = useAgentStore((state) => state.setPermissionMode);
  const chooseAuthorizedDirectory = useAgentStore((state) => state.chooseAuthorizedDirectory);
  const refreshPermissions = useAgentStore((state) => state.refreshPermissions);
  const removeAuthorizedDirectory = useAgentStore((state) => state.removeAuthorizedDirectory);
  const openSection = useWorkspaceStore((state) => state.openSection);
  const notify = useWorkspaceStore((state) => state.notify);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [bypassOpen, setBypassOpen] = useState(false);
  const [knowledge, setKnowledge] = useState<KnowledgeWorkspaceStatus | null>(null);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [automations, setAutomations] = useState<{ enabled: boolean; automations: AgentAutomation[]; runs: AutomationRun[] }>({ enabled: true, automations: [], runs: [] });

  const refreshKnowledge = async () => {
    if (typeof window.api.getKnowledgeStatus !== 'function') return;
    const result = await window.api.getKnowledgeStatus();
    if (result.ok) setKnowledge(result.data);
  };

  const refreshAutomations = async () => {
    if (typeof window.api.listAutomations !== 'function') return;
    const result = await window.api.listAutomations(); if (result.ok) setAutomations(result.data);
  };

  useEffect(() => {
    void refreshKnowledge(); void refreshAutomations();
    return typeof window.api.onAutomationEvent === 'function' ? window.api.onAutomationEvent(() => void refreshAutomations()) : undefined;
  }, []);

  const chooseWorkspace = async () => {
    setKnowledgeBusy(true);
    const result = await window.api.choosePrimaryWorkspaceDirectory();
    setKnowledgeBusy(false);
    if (!result.ok) { notify(result.error, 'error'); return; }
    setKnowledge(result.data);
    await refreshPermissions();
    if (result.data.hasPrimaryDirectory) notify('主工作目录已建立并完成索引校对', 'success');
    await refreshAutomations();
  };

  const refreshIndex = async () => {
    setKnowledgeBusy(true);
    const result = await window.api.refreshWorkspaceIndex();
    setKnowledgeBusy(false);
    if (!result.ok) { notify(result.error, 'error'); return; }
    await refreshKnowledge();
    notify(`索引已更新：${result.data.indexedFiles} 个正文来源`, 'success');
  };

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

  const changeMode = async (mode: typeof permissions.mode) => {
    if (mode === 'bypass' && !permissions.bypassWarningAccepted) {
      setBypassOpen(true);
      return;
    }
    const error = await setPermissionMode(mode);
    if (!error) notify('Agent 权限模式已更新', 'success');
  };

  return (
    <div className={'agent-panel' + (compact ? ' compact' : '')}>
      <div className="standalone-heading agent-heading">
        <div><h1>Agent</h1><p>同一工作区会在 L2 与 L3 间延续；正式操作受当前权限与授权目录约束。</p></div>
        {detail && <div className="agent-heading-actions"><Button icon={Brain} variant="ghost" onClick={() => openSection('memory')}>审核记忆</Button><IconButton icon={Download} label="导出 JSON" onClick={() => void exportSession('json')} /><IconButton icon={Download} label="导出 Markdown" onClick={() => void exportSession('markdown')} /><IconButton icon={Trash2} label="删除会话" variant="danger" disabled={isAgentRunning(runState)} onClick={() => setDeleteOpen(true)} /></div>}
      </div>
      <div className={'agent-permission-bar' + (permissions.mode === 'bypass' ? ' bypass' : '')}>
        <label>
          <ShieldAlert aria-hidden="true" size={16} />
          <span>权限</span>
          <select aria-label="Agent 权限模式" value={permissions.mode} onChange={(event) => void changeMode(event.target.value as typeof permissions.mode)}>
            <option value="confirm_all">每次写入确认</option>
            <option value="auto_reversible">低风险自动写入</option>
            <option value="bypass">Bypass</option>
          </select>
        </label>
        {permissions.mode === 'bypass' && <strong role="status">Bypass 已启用</strong>}
        <details className="agent-directory-access">
          <summary>授权目录 {permissions.authorizedDirectories.length}</summary>
          <div>
            <Button icon={FolderPlus} variant="ghost" onClick={() => void chooseAuthorizedDirectory()}>添加目录</Button>
            {permissions.authorizedDirectories.length === 0 ? <small>未授权任何文件目录</small> : permissions.authorizedDirectories.map((directory) => (
              <span key={directory.id}><span title={directory.path}>{directory.label}</span><IconButton icon={X} label={`移除目录 ${directory.label}`} onClick={() => void removeAuthorizedDirectory(directory.id)} /></span>
            ))}
          </div>
        </details>
        <div className="agent-workspace-status" aria-live="polite">
          <span><strong>主工作目录</strong><small>{knowledge?.primaryDirectoryLabel ?? '尚未设置'}</small></span>
          {knowledge?.hasPrimaryDirectory && <small>{knowledge.sourceCount} 个来源 · {knowledge.indexedSourceCount} 个可检索{knowledge.lastScan?.status === 'running' ? ' · 扫描中' : ''}</small>}
          <Button icon={FolderPlus} variant="ghost" disabled={knowledgeBusy} onClick={() => void chooseWorkspace()}>{knowledge?.hasPrimaryDirectory ? '更换' : '选择目录'}</Button>
          {knowledge?.hasPrimaryDirectory && <Button variant="ghost" disabled={knowledgeBusy} onClick={() => void refreshIndex()}>刷新索引</Button>}
        </div>
        {!compact && automations.automations[0] && <div className="agent-automation-status" aria-live="polite">
          <span><strong>{automations.automations[0].name}</strong><small>{automations.automations[0].lastFailure ? `失败：${automations.automations[0].lastFailure}` : automations.automations[0].nextRunAtUtc ? `下次 ${new Date(automations.automations[0].nextRunAtUtc).toLocaleString('zh-CN', { hour12: false })}` : '已暂停'}</small></span>
          <Button variant="ghost" onClick={async () => { const result = await window.api.setAutomationsGlobalEnabled(!automations.enabled); if (result.ok) { await refreshAutomations(); notify(result.data ? 'Agent 自动化已启用' : 'Agent 自动化已暂停', 'success'); } else notify(result.error, 'error'); }}>{automations.enabled ? '全部暂停' : '全部启用'}</Button>
          {automations.runs.find((run) => run.status === 'waiting_approval') && <Button onClick={async () => { const run = automations.runs.find((item) => item.status === 'waiting_approval'); if (!run) return; const result = await window.api.approveAutomationRun(run.id); if (!result.ok) notify(result.error, 'error'); else { notify('已批准生成每日工作清单', 'success'); await refreshAutomations(); } }}>批准生成</Button>}
        </div>}
      </div>
      <div className="agent-layout">
        <aside className="agent-sessions" aria-label="Agent 会话">
          <div className="agent-sessions-head"><strong>本机会话</strong>{sessions.length > 0 && <button type="button" disabled={isAgentRunning(runState)} onClick={() => setClearOpen(true)}>清空</button>}</div>
          {sessions.map((session) => <button key={session.id} className={detail?.session.id === session.id ? 'active' : ''} onClick={() => void openSession(session.id)}><span>{session.title}</span><small>{session.updatedAt.slice(5, 16).replace('T', ' ')}</small></button>)}
          {sessions.length === 0 && <small>还没有历史会话</small>}
        </aside>
        <AgentConversation compact={compact} onHide={onHide} onTaskConfirmed={onTaskConfirmed} />
      </div>
      <Dialog open={deleteOpen} title="删除这段 Agent 会话？" description="本机会话消息会永久删除，已确认写入的正式任务不会受影响。" onClose={() => setDeleteOpen(false)} actions={<><Button variant="ghost" onClick={() => setDeleteOpen(false)}>返回</Button><Button variant="danger" onClick={() => void removeSession()}>确认删除</Button></>}><p>如需保留记录，请先导出 Markdown 或 JSON。</p></Dialog>
      <Dialog open={clearOpen} title="清空全部 Agent 会话？" description="所有本机会话消息都会永久删除，正式任务与待审核草稿不受影响。" onClose={() => setClearOpen(false)} actions={<><Button variant="ghost" onClick={() => setClearOpen(false)}>返回</Button><Button variant="danger" onClick={() => void removeAll()}>确认清空</Button></>}><p>此操作无法撤销。</p></Dialog>
      <Dialog open={bypassOpen} title="启用 Bypass？" description="Agent 将在授权边界内自动执行所有采办岛命令与文件操作，不再逐项等待确认。" onClose={() => setBypassOpen(false)} actions={<><Button variant="ghost" onClick={() => setBypassOpen(false)}>保持当前模式</Button><Button variant="danger" onClick={async () => { const error = await setPermissionMode('bypass', true); if (!error) { setBypassOpen(false); notify('Bypass 已启用', 'success'); } }}>理解风险并启用</Button></>}><p>Bypass 仍不能访问未授权目录、任意 Shell 或任意网络。</p></Dialog>
    </div>
  );
}
