import { useState } from 'react';
import type { TaskInput, TaskKind, Urgency } from '../../../shared/types';
import { URGENCIES, KINDS } from '../../../shared/taskContracts';
import { useTaskStore } from '../state/useStore';

const URGENCY_LABEL: Record<string, string> = { critical: '紧急', high: '高', normal: '普通', low: '低' };
const KIND_LABEL: Record<string, string> = { task: '任务', misc: '杂事' };

export default function NewTaskForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const create = useTaskStore((s) => s.create);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TaskKind>('task');
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [deadlineText, setDeadlineText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const input: TaskInput = {
      name,
      description: '',
      kind,
      urgency,
      deadlineUtc: deadlineText ? new Date(deadlineText).toISOString() : null,
      tzId: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
    const err = await create(input);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label="新建任务">
        <h2 className="modal-title">新建{kind === 'misc' ? '杂事' : '任务'}</h2>
        <label className="field">
          <span className="field-label">名称</span>
          <input
            className="text-input"
            value={name}
            autoFocus
            placeholder="例如：XX 设备采购"
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          />
        </label>
        <div className="field">
          <span className="field-label">类型</span>
          <div className="chip-group">
            {KINDS.map((k) => (
              <button key={k} className={'chip-btn' + (kind === k ? ' active' : '')} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">紧急程度</span>
          <div className="chip-group">
            {URGENCIES.map((u) => (
              <button key={u} className={'chip-btn urgency-' + u + (urgency === u ? ' active' : '')} onClick={() => setUrgency(u)}>
                {URGENCY_LABEL[u]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">截止时间（可选）</span>
          <input className="text-input" type="datetime-local" value={deadlineText} onChange={(e) => setDeadlineText(e.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={() => void save()} disabled={saving || name.trim().length === 0}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
