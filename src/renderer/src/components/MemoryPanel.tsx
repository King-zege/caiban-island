import { Brain, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { MemoryCategory, MemoryProposal, MemoryRecord } from '../../../shared/types';
import { useWorkspaceStore } from '../state/useWorkspaceStore';
import { AsyncFeedback } from './ui/AsyncFeedback';
import { Button, IconButton } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { EmptyState } from './ui/EmptyState';

const LIMITS: Record<MemoryCategory, number> = { profile: 1375, work: 2200 };
const LABELS: Record<MemoryCategory, string> = { profile: '用户画像', work: '工作 / 业务记忆' };

export default function MemoryPanel(): React.JSX.Element {
  const notify = useWorkspaceStore((state) => state.notify);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRecord | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [memoryResult, proposalResult] = await Promise.all([
      window.api.listMemories(), window.api.listMemoryProposals()
    ]);
    setLoading(false);
    if (!memoryResult.ok) { setError(memoryResult.error); return; }
    if (!proposalResult.ok) { setError(proposalResult.error); return; }
    setMemories(memoryResult.data);
    setProposals(proposalResult.data);
    setEdits(Object.fromEntries([
      ...memoryResult.data.map((item) => [item.id, item.fact]),
      ...proposalResult.data.map((item) => [item.id, item.fact])
    ]));
    setError(null);
  };

  useEffect(() => { void load(); }, []);

  const usage = useMemo(() => ({
    profile: memories.filter((item) => item.category === 'profile').reduce((sum, item) => sum + item.fact.length, 0),
    work: memories.filter((item) => item.category === 'work').reduce((sum, item) => sum + item.fact.length, 0)
  }), [memories]);

  const confirm = async (proposal: MemoryProposal) => {
    const result = await window.api.confirmMemoryProposal(proposal.id, proposal.operation === 'remove' ? undefined : edits[proposal.id]);
    if (!result.ok) { setError(result.error); return; }
    notify(proposal.operation === 'remove' ? '记忆已移除' : '记忆已确认', 'success');
    await load();
  };

  const discard = async (id: string) => {
    const result = await window.api.discardMemoryProposal(id);
    if (!result.ok) { setError(result.error); return; }
    notify('记忆提案已拒绝', 'success');
    await load();
  };

  const save = async (memory: MemoryRecord) => {
    const result = await window.api.updateMemory(memory.id, edits[memory.id] ?? memory.fact);
    if (!result.ok) { setError(result.error); return; }
    notify('记忆已更新', 'success');
    await load();
  };

  const remove = async () => {
    if (!deleteTarget) return;
    const result = await window.api.deleteMemory(deleteTarget.id);
    setDeleteTarget(null);
    if (!result.ok) { setError(result.error); return; }
    notify('记忆已删除', 'success');
    await load();
  };

  const clear = async () => {
    const result = await window.api.clearMemories();
    setClearOpen(false);
    if (!result.ok) { setError(result.error); return; }
    notify(`已清除 ${result.data} 条长期记忆`, 'success');
    await load();
  };

  return <div className="memory-panel">
    <div className="standalone-heading memory-heading">
      <div><span className="eyebrow">用户确认的长期记忆</span><h1>让 Agent 逐渐理解你的工作方式</h1><p>提案经你审核后才会进入后续会话；凭据、文件内容和内部推理不会保存。</p></div>
      {memories.length > 0 && <Button variant="danger" onClick={() => setClearOpen(true)}>清空记忆</Button>}
    </div>
    {error && <AsyncFeedback tone="error" message={error} onRetry={() => void load()} />}
    {proposals.length > 0 && <section className="memory-proposals" aria-labelledby="memory-proposals-title">
      <div className="section-heading"><div><span className="eyebrow">等待你决定</span><h2 id="memory-proposals-title">记忆提案</h2></div><span>{proposals.length} 条</span></div>
      <div className="memory-grid">
        {proposals.map((proposal) => <article className="memory-card proposal" key={proposal.id}>
          <div className="memory-card-head"><strong>{proposal.operation === 'add' ? '新增' : proposal.operation === 'replace' ? '替换' : '移除'} · {LABELS[proposal.category]}</strong><small>证据 {proposal.evidenceMessageId.slice(0, 8)}</small></div>
          <textarea aria-label={`编辑记忆提案 ${proposal.id}`} disabled={proposal.operation === 'remove'} value={edits[proposal.id] ?? proposal.fact} onChange={(event) => setEdits((current) => ({ ...current, [proposal.id]: event.target.value }))} />
          {proposal.capacityWarning && <p className="memory-warning" role="status">{proposal.capacityWarning}</p>}
          <div className="memory-actions"><Button variant="ghost" onClick={() => void discard(proposal.id)}>拒绝</Button><Button variant="primary" onClick={() => void confirm(proposal)}>确认记忆</Button></div>
        </article>)}
      </div>
    </section>}
    <section aria-labelledby="confirmed-memory-title">
      <div className="section-heading"><div><span className="eyebrow">仅注入新建或重新载入的会话</span><h2 id="confirmed-memory-title">已确认记忆</h2></div></div>
      {loading ? <p className="loading-state">正在读取记忆</p> : memories.length === 0 ? <EmptyState icon={Brain} title="还没有长期记忆" description="当对话中出现稳定偏好或业务事实时，Agent 可以提出一条待审核记忆。" /> : <div className="memory-columns">
        {(['profile', 'work'] as const).map((category) => {
          const items = memories.filter((item) => item.category === category);
          const ratio = usage[category] / LIMITS[category];
          return <div className="memory-category" key={category}>
            <div className="memory-capacity"><strong>{LABELS[category]}</strong><span>{usage[category]} / {LIMITS[category]} 字符</span></div>
            <div className="memory-meter" aria-label={`${LABELS[category]}容量 ${Math.round(ratio * 100)}%`}><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
            {ratio >= 0.8 && <p className="memory-warning">容量已超过 80%，请合并或删除不再需要的内容。</p>}
            {items.length === 0 ? <small>暂无</small> : items.map((memory) => <article className="memory-card" key={memory.id}>
              <textarea aria-label={`编辑${LABELS[category]} ${memory.id}`} value={edits[memory.id] ?? memory.fact} onChange={(event) => setEdits((current) => ({ ...current, [memory.id]: event.target.value }))} />
              <div className="memory-card-foot"><small>更新于 {memory.updatedAt.slice(0, 10)} · 来源 {memory.sourceMessageId.slice(0, 8)}</small><div><Button variant="ghost" disabled={(edits[memory.id] ?? memory.fact).trim() === memory.fact} onClick={() => void save(memory)}>保存</Button><IconButton icon={Trash2} label="删除记忆" variant="danger" onClick={() => setDeleteTarget(memory)} /></div></div>
            </article>)}
          </div>;
        })}
      </div>}
    </section>
    <Dialog open={Boolean(deleteTarget)} title="删除这条长期记忆？" description="后续新建或重新载入的会话将不再获得它。" onClose={() => setDeleteTarget(null)} actions={<><Button variant="ghost" onClick={() => setDeleteTarget(null)}>返回</Button><Button variant="danger" onClick={() => void remove()}>确认删除</Button></>}><p>{deleteTarget?.fact}</p></Dialog>
    <Dialog open={clearOpen} title="清空全部长期记忆？" description="用户画像和工作记忆都会永久删除。" onClose={() => setClearOpen(false)} actions={<><Button variant="ghost" onClick={() => setClearOpen(false)}>返回</Button><Button variant="danger" onClick={() => void clear()}>确认清空</Button></>}><p>会话历史与正式任务不会受影响。</p></Dialog>
  </div>;
}
