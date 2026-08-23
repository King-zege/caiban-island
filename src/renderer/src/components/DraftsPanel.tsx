import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DraftNodeProposal, DraftPayload, DraftRecord, Urgency } from '../../../shared/types';
import { URGENCIES } from '../../../shared/taskContracts';
import { useTaskStore } from '../state/useStore';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';

const URGENCY_LABEL: Record<Urgency, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };

export default function DraftsPanel(): React.JSX.Element {
  const reloadTasks = useTaskStore((state) => state.load);
  const openSection = useWorkspaceStore((state) => state.openSection);
  const notify = useWorkspaceStore((state) => state.notify);
  const scheduleUndo = useWorkspaceStore((state) => state.scheduleUndo);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskNames, setTaskNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState('');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteActionOpen, setDeleteActionOpen] = useState(false);

  const refresh = async (keepSelected = false) => {
    setLoading(true);
    setError(null);
    const result = await window.api.listDrafts();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDrafts(result.data);
    if (!keepSelected) setSelectedId(result.data[0]?.id ?? null);
    else if (selectedId && !result.data.some((draft) => draft.id === selectedId)) setSelectedId(result.data[0]?.id ?? null);
  };

  useEffect(() => {
    void refresh();
    void window.api.getAiStatus().then((result) => {
      if (result.ok) setAiConfigured((result.data as { configured: boolean }).configured);
    });
  }, []);

  useEffect(() => {
    const missing = drafts.filter((draft) => draft.payload.type === 'nodes' && !taskNames[draft.payload.taskId]);
    for (const draft of missing) {
      if (draft.payload.type !== 'nodes') continue;
      const taskId = draft.payload.taskId;
      void window.api.taskDetail(taskId).then((result) => {
        if (result.ok) setTaskNames((current) => ({ ...current, [taskId]: result.data.task.name }));
      });
    }
  }, [drafts, taskNames]);

  const selected = drafts.find((draft) => draft.id === selectedId) ?? null;

  const mutatePayload = (mutate: (payload: DraftPayload) => DraftPayload) => {
    if (!selected) return;
    const next = mutate(structuredClone(selected.payload));
    void window.api.updateDraft(selected.id, next).then((result) => {
      if (result.ok) setDrafts((list) => list.map((draft) => draft.id === selected.id ? result.data : draft));
      else setError(result.error);
    });
  };

  const editNode = (index: number, patch: Partial<DraftNodeProposal>) => {
    mutatePayload((payload) => payload.type === 'action' ? payload : ({ ...payload, nodes: payload.nodes.map((node, nodeIndex) => nodeIndex === index ? { ...node, ...patch } : node) }));
  };

  const moveNode = (index: number, direction: -1 | 1) => {
    mutatePayload((payload) => {
      if (payload.type === 'action') return payload;
      const nodes = [...payload.nodes];
      const target = index + direction;
      if (target < 0 || target >= nodes.length) return payload;
      [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
      return { ...payload, nodes };
    });
  };

  const runAi = async () => {
    setBusy(true);
    setError(null);
    const result = await window.api.aiBreakdown(description);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDescription('');
    await refresh();
    notify('AI 草稿已生成，请逐项审核', 'success');
  };

  const confirmDraft = async () => {
    if (!selected) return;
    if (selected.payload.type === 'action' && selected.payload.action.kind === 'delete_node') {
      setDeleteActionOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await window.api.confirmDraft(selected.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refresh();
    await reloadTasks();
    notify(selected.payload.type === 'task' ? '草稿已创建为正式任务' : selected.payload.type === 'nodes' ? '节点已添加到正式任务' : '轻量操作已应用', 'success');
  };

  const scheduleDeleteAction = () => {
    if (!selected || selected.payload.type !== 'action' || selected.payload.action.kind !== 'delete_node') return;
    const draftId = selected.id;
    const title = selected.payload.action.before.title;
    const scheduled = scheduleUndo({
      id: draftId,
      kind: 'node',
      label: '节点「' + title + '」',
      commit: async () => {
        const result = await window.api.confirmDraft(draftId);
        if (!result.ok) return result.error;
        await reloadTasks();
        await refresh();
        return null;
      }
    });
    setDeleteActionOpen(false);
    if (scheduled) {
      setDrafts((list) => list.filter((draft) => draft.id !== draftId));
      setSelectedId(null);
      notify('节点删除将在 5 秒后应用，可撤销', 'info');
    }
  };

  const discardDraft = async () => {
    if (!selected) return;
    setBusy(true);
    const result = await window.api.discardDraft(selected.id);
    setBusy(false);
    setDiscardOpen(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refresh();
    notify('草稿已丢弃', 'success');
  };

  const titleOf = (draft: DraftRecord) => draft.payload.type === 'task'
    ? draft.payload.taskInput.name || '未命名任务'
    : draft.payload.type === 'nodes'
      ? '为“' + (taskNames[draft.payload.taskId] ?? '当前任务') + '”添加节点'
      : draft.payload.summary;

  return (
    <div className="drafts-panel">
      <div className="standalone-heading">
        <div><span className="eyebrow">AI 草稿</span><h1>审核后再写入正式任务</h1><p>AI 的建议不会自动修改任务，你可以调整每一个节点。</p></div>
      </div>

      {aiConfigured ? (
        <div className="ai-composer">
          <label><span className="ui-field-label">描述采购目标</span><textarea value={description} placeholder="例如：采购 50 台办公电脑，下月 10 日前完成交付" onChange={(event) => setDescription(event.target.value)} /></label>
          <Button icon={Sparkles} variant="primary" disabled={busy || description.trim().length === 0} onClick={() => void runAi()}>{busy ? '正在拆解' : '生成节点草稿'}</Button>
        </div>
      ) : (
        <div className="ai-unconfigured"><span>内置 AI 尚未配置，Qoder 生成的草稿仍会出现在这里。</span><Button variant="ghost" onClick={() => openSection('settings')}>前往设置</Button></div>
      )}

      {error && <AsyncFeedback tone="error" message={error} onRetry={() => void refresh(true)} />}
      {loading ? <p className="loading-state section-loading">正在读取草稿</p> : drafts.length === 0 ? (
        <EmptyState icon={Sparkles} title="没有待审核草稿" description="描述采购目标生成新草稿，或从 Qoder 发送拆分建议。" />
      ) : (
        <div className="drafts-layout">
          <nav className="drafts-list" aria-label="待审核草稿">
            <div className="list-heading"><strong>待审核</strong><span>{drafts.length}</span></div>
            {drafts.map((draft) => (
              <button key={draft.id} className={'draft-item' + (draft.id === selectedId ? ' active' : '')} aria-current={draft.id === selectedId ? 'page' : undefined} onClick={() => setSelectedId(draft.id)}>
                <span className="draft-source">{draft.source === 'mcp' ? 'Qoder' : draft.source === 'pi' ? 'Pi Agent' : '内置 AI'}</span>
                <strong>{titleOf(draft)}</strong>
                <small>{draft.payload.type === 'action' ? '待逐次确认的轻量操作' : draft.payload.nodes.length + ' 个节点'} · {draft.createdAt.slice(5, 16).replace('T', ' ')}</small>
              </button>
            ))}
          </nav>

          {selected && (
            <div className="draft-editor">
              <div className="section-heading"><div><span className="eyebrow">草稿内容</span><h2>{titleOf(selected)}</h2></div></div>
              {selected.payload.type === 'task' && (
                <div className="draft-task-fields">
                  <Field label="任务名称" value={selected.payload.taskInput.name} onChange={(event) => mutatePayload((payload) => payload.type === 'task' ? { ...payload, taskInput: { ...payload.taskInput, name: event.target.value } } : payload)} />
                  <Field label="任务说明" value={selected.payload.taskInput.description} onChange={(event) => mutatePayload((payload) => payload.type === 'task' ? { ...payload, taskInput: { ...payload.taskInput, description: event.target.value } } : payload)} />
                  <label className="ui-field"><span className="ui-field-label">紧急程度</span><span className="segmented-control">{URGENCIES.map((urgency) => <button key={urgency} type="button" className={selected.payload.type === 'task' && selected.payload.taskInput.urgency === urgency ? 'active' : ''} aria-pressed={selected.payload.type === 'task' && selected.payload.taskInput.urgency === urgency} onClick={() => mutatePayload((payload) => payload.type === 'task' ? { ...payload, taskInput: { ...payload.taskInput, urgency } } : payload)}>{URGENCY_LABEL[urgency]}</button>)}</span></label>
                </div>
              )}

              {selected.payload.type === 'action' ? (
                <div className="agent-action-diff" role="status">
                  <strong>具体变更</strong>
                  <p>{selected.payload.summary}</p>
                  <small>确认时会再次核对原值；任务数据已变化则拒绝执行。</small>
                </div>
              ) : <ol className="draft-nodes">
                {selected.payload.nodes.map((node, index) => (
                  <li key={index} className="draft-node-row">
                    <span className="draft-node-idx">{index + 1}</span>
                    <input value={node.title} aria-label={'节点 ' + (index + 1)} placeholder={'节点 ' + (index + 1)} onChange={(event) => editNode(index, { title: event.target.value })} />
                    <span className="row-actions">
                      <IconButton icon={ArrowUp} label="上移节点" disabled={index === 0} onClick={() => moveNode(index, -1)} />
                      <IconButton icon={ArrowDown} label="下移节点" disabled={index === (selected.payload.type === 'action' ? 0 : selected.payload.nodes.length - 1)} onClick={() => moveNode(index, 1)} />
                      <IconButton icon={Trash2} label="删除节点" variant="danger" onClick={() => mutatePayload((payload) => payload.type === 'action' ? payload : ({ ...payload, nodes: payload.nodes.filter((_, nodeIndex) => nodeIndex !== index) }))} />
                    </span>
                  </li>
                ))}
              </ol>}
              {selected.payload.type !== 'action' && <Button icon={Plus} variant="ghost" onClick={() => mutatePayload((payload) => payload.type === 'action' ? payload : ({ ...payload, nodes: [...payload.nodes, { title: '', description: '', startUtc: null, endUtc: null }] }))}>添加节点</Button>}
              {selected.payload.warnings.length > 0 && <div className="draft-warnings"><strong>需要留意</strong><p>{selected.payload.warnings.join('；')}</p></div>}
              <div className="draft-actions">
                <Button variant="danger" disabled={busy} onClick={() => setDiscardOpen(true)}>丢弃草稿</Button>
                <Button variant="primary" disabled={busy || (selected.payload.type !== 'action' && selected.payload.nodes.some((node) => node.title.trim().length === 0)) || (selected.payload.type === 'task' && selected.payload.taskInput.name.trim().length === 0)} onClick={() => void confirmDraft()}>{busy ? '正在应用' : selected.payload.type === 'task' ? '创建正式任务' : selected.payload.type === 'nodes' ? '添加到正式任务' : '确认并应用此操作'}</Button>
              </div>
              <Dialog open={discardOpen} title="丢弃这份草稿？" description="此操作不会影响正式任务。" onClose={() => setDiscardOpen(false)} actions={<><Button variant="ghost" onClick={() => setDiscardOpen(false)}>返回</Button><Button variant="danger" onClick={() => void discardDraft()}>确认丢弃</Button></>}><p>草稿内容将无法恢复。</p></Dialog>
              <Dialog open={deleteActionOpen} title="确认删除这个节点？" description="删除会在 5 秒后执行，期间可以撤销。" onClose={() => setDeleteActionOpen(false)} actions={<><Button variant="ghost" onClick={() => setDeleteActionOpen(false)}>返回</Button><Button variant="danger" onClick={scheduleDeleteAction}>确认并进入撤销倒计时</Button></>}><p>确认时还会核对节点内容与位置，避免覆盖刚发生的修改。</p></Dialog>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
