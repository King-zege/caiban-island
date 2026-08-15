import { useEffect, useState } from 'react';
import type { DraftNodeProposal, DraftPayload, DraftRecord, Urgency } from '../../../shared/types';
import { URGENCIES } from '../../../shared/taskContracts';
import { useTaskStore } from '../state/useStore';

const URGENCY_LABEL: Record<string, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };

export default function DraftsPanel(): React.JSX.Element {
  const reloadTasks = useTaskStore((s) => s.load);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskNames, setTaskNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [desc, setDesc] = useState('');
  const [aiStatus, setAiStatus] = useState<{ configured: boolean } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const refresh = async (keepSelected = false) => {
    const r = await window.api.listDrafts();
    if (r.ok) {
      setDrafts(r.data);
      if (!keepSelected) setSelectedId(r.data[0]?.id ?? null);
      else if (selectedId && !r.data.some((d) => d.id === selectedId)) setSelectedId(r.data[0]?.id ?? null);
    }
  };

  useEffect(() => {
    void refresh();
    void window.api.getAiStatus().then((r) => r.ok && setAiStatus(r.data as { configured: boolean }));
  }, []);

  // 收集 nodes 草稿对应的任务名
  useEffect(() => {
    const missing = drafts.filter((d) => d.payload.type === 'nodes' && !taskNames[d.payload.taskId]);
    for (const d of missing) {
      if (d.payload.type !== 'nodes') continue;
      const taskId = d.payload.taskId;
      void window.api.taskDetail(taskId).then((r) => {
        if (r.ok) setTaskNames((p) => ({ ...p, [taskId]: r.data.task.name }));
      });
    }
  }, [drafts, taskNames]);

  const selected = drafts.find((d) => d.id === selectedId) ?? null;

  const mutatePayload = (fn: (p: DraftPayload) => DraftPayload) => {
    if (!selected) return;
    const next = fn(structuredClone(selected.payload));
    void window.api.updateDraft(selected.id, next).then((r) => {
      if (r.ok) {
        setDrafts((list) => list.map((d) => (d.id === selected.id ? r.data : d)));
      } else setError(r.error);
    });
  };

  const editNode = (idx: number, patch: Partial<DraftNodeProposal>) => {
    mutatePayload((p) => ({ ...p, nodes: p.nodes.map((n, i) => (i === idx ? { ...n, ...patch } : n)) }));
  };

  const removeNode = (idx: number) => {
    mutatePayload((p) => ({ ...p, nodes: p.nodes.filter((_, i) => i !== idx) }));
  };

  const moveNode = (idx: number, dir: -1 | 1) => {
    mutatePayload((p) => {
      const nodes = [...p.nodes];
      const t = idx + dir;
      if (t < 0 || t >= nodes.length) return p;
      [nodes[idx], nodes[t]] = [nodes[t], nodes[idx]];
      return { ...p, nodes };
    });
  };

  const addNode = () => {
    mutatePayload((p) => ({ ...p, nodes: [...p.nodes, { title: '', description: '', startUtc: null, endUtc: null }] }));
  };

  const confirmDraft = async () => {
    if (!selected) return;
    setError(null);
    const r = await window.api.confirmDraft(selected.id);
    if (r.ok) {
      await refresh();
      await reloadTasks();
    } else setError(r.error);
  };

  const runAi = async () => {
    setError(null);
    setAiBusy(true);
    const r = await window.api.aiBreakdown(desc);
    setAiBusy(false);
    if (r.ok) {
      setDesc('');
      await refresh();
    } else setError(r.error);
  };

  const titleOf = (d: DraftRecord) => {
    if (d.payload.type === 'task') return d.payload.taskInput.name || '（未命名任务）';
    return '为「' + (taskNames[d.payload.taskId] ?? '…') + '」添加节点';
  };

  return (
    <div className="drafts-panel">
      {aiStatus && aiStatus.configured && (
        <div className="ai-box">
          <textarea
            className="note-textarea"
            value={desc}
            placeholder={'用自然语言描述任务，AI 将拆分为时间轴节点草稿：\n例如：采购 50 台办公电脑，下月 10 号前完成交付'}
            onChange={(e) => setDesc(e.target.value)}
          />
          <button className="btn primary" disabled={aiBusy || desc.trim().length === 0} onClick={() => void runAi()}>
            {aiBusy ? 'AI 拆解中…' : '用 AI 拆解'}
          </button>
        </div>
      )}

      <div className="drafts-layout">
        <div className="drafts-list">
          <h3 className="section-title">待审核草稿（{drafts.length}）</h3>
          {drafts.length === 0 && <p className="detail-empty">暂无草稿 — 在 Qoder 中对话拆分，或使用上方 AI 拆解</p>}
          {drafts.map((d) => (
            <button
              key={d.id}
              className={'draft-item' + (d.id === selectedId ? ' active' : '')}
              onClick={() => setSelectedId(d.id)}
            >
              <span className={'chip ' + (d.source === 'mcp' ? 'kind-misc' : 'deadline')}>{d.source === 'mcp' ? 'Qoder' : 'API'}</span>
              <span className="draft-item-title">{titleOf(d)}</span>
              <span className="draft-item-meta">{d.payload.nodes.length} 节点 · {d.createdAt.slice(5, 16).replace('T', ' ')}</span>
            </button>
          ))}
        </div>

        {selected && (
          <div className="draft-editor">
            {selected.payload.type === 'task' ? (
              <>
                <input
                  className="text-input"
                  value={selected.payload.taskInput.name}
                  placeholder="任务名称"
                  onChange={(e) =>
                    mutatePayload((p) => (p.type === 'task' ? { ...p, taskInput: { ...p.taskInput, name: e.target.value } } : p))
                  }
                />
                <input
                  className="text-input"
                  value={selected.payload.taskInput.description}
                  placeholder="任务说明（可选）"
                  onChange={(e) =>
                    mutatePayload((p) => (p.type === 'task' ? { ...p, taskInput: { ...p.taskInput, description: e.target.value } } : p))
                  }
                />
                <div className="chip-group">
                  {URGENCIES.map((u: Urgency) => (
                    <button
                      key={u}
                      className={'chip-btn' + (selected.payload.type === 'task' && selected.payload.taskInput.urgency === u ? ' active' : '')}
                      onClick={() =>
                        mutatePayload((p) => (p.type === 'task' ? { ...p, taskInput: { ...p.taskInput, urgency: u } } : p))
                      }
                    >
                      {URGENCY_LABEL[u]}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="draft-task-name">为「{taskNames[selected.payload.taskId] ?? '…'}」添加以下节点</p>
            )}

            <div className="draft-nodes">
              {selected.payload.nodes.map((n, i) => (
                <div key={i} className="draft-node-row">
                  <span className="draft-node-idx">{i + 1}</span>
                  <input
                    className="text-input grow"
                    value={n.title}
                    placeholder={'节点 ' + (i + 1)}
                    onChange={(e) => editNode(i, { title: e.target.value })}
                  />
                  <button className="btn small" disabled={i === 0} onClick={() => moveNode(i, -1)} title="上移">
                    ↑
                  </button>
                  <button className="btn small" disabled={i === selected.payload.nodes.length - 1} onClick={() => moveNode(i, 1)} title="下移">
                    ↓
                  </button>
                  <button className="btn small danger-outline" onClick={() => removeNode(i)} title="删除节点">
                    删
                  </button>
                </div>
              ))}
              <button className="btn small" onClick={addNode}>
                + 添加节点
              </button>
            </div>

            {selected.payload.warnings.length > 0 && (
              <p className="detail-empty">提示：{selected.payload.warnings.join('；')}</p>
            )}

            <div className="draft-actions">
              <button className="btn danger-outline" onClick={() => void window.api.discardDraft(selected.id).then(() => refresh())}>
                丢弃
              </button>
              <button
                className="btn primary"
                disabled={selected.payload.nodes.some((n) => n.title.trim().length === 0) || (selected.payload.type === 'task' && selected.payload.taskInput.name.trim().length === 0)}
                onClick={() => void confirmDraft()}
              >
                {selected.payload.type === 'task' ? '确认创建任务' : '确认添加到任务'}
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
